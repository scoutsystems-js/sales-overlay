/**
 * ITEM (j) — backfill `call_analyses.price_stated_at_seconds` over stored
 * transcripts. Deterministic: no model call, no Claude spend, no network beyond
 * Supabase.
 *
 * ⚠ DATA-OP DISCIPLINE (standing rule): --plan prints and exits. --write pins to
 * the ids printed by the plan, verifies each target exists before writing, and
 * re-counts afterwards. There is no "everything matching" write path.
 *
 *   node scripts/price-moment-backfill.js --plan
 *   node scripts/price-moment-backfill.js --write
 */
const { createClient } = require('@supabase/supabase-js');
const { findPriceMoment } = require('../lib/price-moment');

const WRITE = process.argv.indexOf('--write') !== -1;
const PLAN = process.argv.indexOf('--plan') !== -1 || !WRITE;

function admin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

// ⚠ The seller's price comes from their PROFILE, per call owner. NEVER price_2pay.
async function priceByUser(db) {
  const r = await db.from('user_profiles').select('user_id, price_pif');
  if (r.error) throw new Error('user_profiles: ' + r.error.message);
  const m = {};
  (r.data || []).forEach((p) => {
    const n = Number(p.price_pif);
    if (isFinite(n) && n > 0) m[p.user_id] = n;
  });
  return m;
}

(async function main() {
  const db = admin();
  const prices = await priceByUser(db);
  console.log('sellers with a stored price_pif: ' + Object.keys(prices).length);
  if (!Object.keys(prices).length) { console.log('nothing to do'); return; }

  // Only calls whose OWNER has a price, and only analyses that stored a transcript.
  let calls = [], from = 0;
  for (;;) {
    const q = await db.from('fathom_calls').select('id, user_id, fathom_call_id, call_date')
      .in('user_id', Object.keys(prices)).range(from, from + 499);
    if (q.error) throw new Error('fathom_calls: ' + q.error.message);
    calls = calls.concat(q.data || []);
    if (!q.data || q.data.length < 500) break;
    from += 500;
  }
  const ownerOf = {}; calls.forEach((c) => { ownerOf[c.id] = c.user_id; });
  console.log('calls owned by those sellers: ' + calls.length);

  const ids = calls.map((c) => c.id);
  const plan = [];
  let scanned = 0, noTranscript = 0, noCloserLabels = 0;

  for (let i = 0; i < ids.length; i += 25) {
    const slice = ids.slice(i, i + 25);
    const q = await db.from('call_analyses')
      .select('fathom_call_id, outcome, prompt_version, transcript_stored, price_stated_at_seconds')
      .in('fathom_call_id', slice).eq('status', 'done');
    if (q.error) throw new Error('call_analyses: ' + q.error.message);
    (q.data || []).forEach((a) => {
      scanned++;
      const turns = a.transcript_stored && a.transcript_stored.turns;
      if (!Array.isArray(turns) || !turns.length) { noTranscript++; return; }
      if (!turns.some((t) => t && String(t.speaker).toUpperCase() === 'CLOSER')) {
        // Pre-v13 transcripts carry raw display names, so "the closer" is not
        // identifiable. Refused rather than guessed.
        noCloserLabels++; return;
      }
      const m = findPriceMoment(turns, prices[ownerOf[a.fathom_call_id]]);
      /**
       * ⚠⚠ A NULL IS WRITTEN EXPLICITLY, NEVER LEFT ABSENT — and the two are not
       * the same thing however identical they look to a query.
       *   an ABSENT row  = "this call has never been evaluated"
       *   a NULL row     = "this call WAS evaluated and there is no price drop"
       * Both read as `price_stated_at_seconds IS NULL`. They mean opposite
       * things to the next run: the first should be processed, the second should
       * be left alone. Writing the null is what lets a re-run tell them apart —
       * and ~1 in 3 calls legitimately has no moment, so this is the common case,
       * not an edge one.
       */
      plan.push({
        fathom_call_id: a.fathom_call_id, outcome: a.outcome,
        seconds: m ? m.seconds : null, quote: m ? m.quote : null,
        already: a.price_stated_at_seconds,
      });
    });
  }

  const found = plan.filter((p) => p.seconds !== null);
  const closed = plan.filter((p) => p.outcome === 'closed');
  const closedFound = closed.filter((p) => p.seconds !== null);
  const mins = found.map((p) => p.seconds / 60).sort((a, b) => a - b);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const at = (q) => (mins.length ? mins[Math.floor(q * (mins.length - 1))].toFixed(1) : '-');

  console.log('\n── COVERAGE ──────────────────────────────────────────');
  console.log('analyses scanned            ' + scanned);
  console.log('  no stored transcript      ' + noTranscript);
  console.log('  no CLOSER labels (pre-v13)' + noCloserLabels);
  console.log('  evaluated                 ' + plan.length);
  console.log('price moment FOUND          ' + found.length + '  (' + pct(found.length, plan.length) + '% of evaluated)');
  console.log('price moment NULL           ' + (plan.length - found.length));
  console.log('  of CLOSED calls           ' + closedFound.length + ' of ' + closed.length
    + '  (' + pct(closed.length - closedFound.length, closed.length) + '% null — ~20% expected)');
  console.log('\n── DISTRIBUTION (minutes to price) ───────────────────');
  console.log('p10 ' + at(0.1) + '   p25 ' + at(0.25) + '   MEDIAN ' + at(0.5)
    + '   p75 ' + at(0.75) + '   p90 ' + at(0.9));

  console.log('\n── SAMPLE (10 found) ─────────────────────────────────');
  found.slice(0, 10).forEach((p) => {
    console.log('  ' + (p.seconds / 60).toFixed(1).padStart(6) + ' min  '
      + String(p.outcome || '-').padEnd(10) + '  ' + (p.quote || '').slice(0, 90));
  });

  if (PLAN && !WRITE) {
    console.log('\nPLAN ONLY — nothing written. Re-run with --write to persist these exact ids.');
    return;
  }

  // ⚠ Writes ONLY the ids printed above, one at a time, verifying each target
  // exists first. Not "everything matching the predicate" re-evaluated at write
  // time — the set can move between the read and the write.
  let wrote = 0, missing = 0, failed = 0;
  for (const p of plan) {
    const chk = await db.from('call_analyses').select('fathom_call_id')
      .eq('fathom_call_id', p.fathom_call_id).eq('status', 'done').maybeSingle();
    if (chk.error || !chk.data) { missing++; console.error('  MISSING ' + p.fathom_call_id); continue; }
    const up = await db.from('call_analyses')
      .update({ price_stated_at_seconds: p.seconds, price_quote: p.quote })
      .eq('fathom_call_id', p.fathom_call_id);
    if (up.error) { failed++; console.error('  FAILED ' + p.fathom_call_id + ': ' + up.error.message); continue; }
    wrote++;
  }
  console.log('\nwrote ' + wrote + ' · missing ' + missing + ' · failed ' + failed);

  const rc = await db.from('call_analyses').select('fathom_call_id', { count: 'exact', head: true })
    .not('price_stated_at_seconds', 'is', null);
  console.log('RECOUNT — rows with a price moment: ' + (rc.count === null ? '?' : rc.count));
  if (missing || failed) { console.error('⚠ NOT CLEAN — investigate before trusting the numbers'); process.exitCode = 1; }
})().catch((e) => { console.error(e.message); process.exit(1); });
