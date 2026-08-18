/**
 * SEED EXTENSION — price-drop moments for the demo reps.
 *
 * ⚠ WHY THIS IS NEEDED: the Time to Price graph showed ONLY Josh. Diagnosed
 * 2026-08-18, and BOTH causes are real:
 *   1. the fabricated seed rows (seed-2026-08-16-%) have transcript_stored NULL
 *      — a transcript-scanning detector has nothing to scan (34/39, 36/41,
 *      32/37 per rep);
 *   2. the demo accounts have NO price_pif — the lookup has no figure to find.
 * Either alone is sufficient, which is why the graph is empty for them. The
 * other two graphs populate because they read ANALYSIS rows, which the seed
 * fabricated.
 *
 * ⚠⚠ WHAT THIS MUST NOT DO — MAKE THE GRAPH LOOK BETTER THAN THE METRIC IS.
 * These lines are fiction. Three rules keep them honest:
 *   • values sit inside Josh's REAL measured band (p10 20.1 · median 32.6 ·
 *     p90 46.3), never tighter and never better;
 *   • ~1 in 3 rows is left NULL, matching the real 35% null rate, so the demo
 *     lines break the way real ones do;
 *   • one demo rep gets a WHOLE DAY of nulls, so the graph shows a genuine gap
 *     rather than three smooth lines.
 * A demo that hides the metric's gaps is worse than an empty graph — it sells a
 * reliability the detector does not have.
 *
 * ⚠ DETERMINISTIC — no Math.random. The value is derived from the call id, so a
 * re-run produces identical numbers and the plan can be checked before it runs.
 *
 * SCOPE: only `seed-2026-08-16-%`. Josh's rows and the Zoom reviewer's are never
 * touched. Removal is unchanged — the existing
 *   delete from fathom_calls where fathom_call_id like 'seed-2026-08-16-%';
 * still takes these with it, because they are columns on rows that delete.
 *
 *   node scripts/seed-price-moments-2026-08-18.js --plan
 *   node scripts/seed-price-moments-2026-08-18.js --write
 */
const { createClient } = require('@supabase/supabase-js');

const MARKER = 'seed-2026-08-16-';
const WRITE = process.argv.indexOf('--write') !== -1;

// Josh's real distribution, measured over 119 calls. The seed stays inside it.
const REAL = { p10: 20.1, median: 32.6, p90: 46.3, nullShare: 0.35 };

function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

// Stable hash of the call id → the same row always gets the same value.
function hash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/**
 * ⚠ NULL FIRST, then the value. A third of rows get nothing at all — that is
 * the point of the exercise, not an afterthought.
 */
function priceSecondsFor(externalId, duration) {
  var h = hash(externalId);
  if ((h % 100) < REAL.nullShare * 100) return null;          // ~35% null
  // Spread across p10..p90, centred near the real median.
  // ⚠ >>> NOT >>. `h` is up to 2^32-1; the SIGNED shift turns anything above
  // 2^31 negative, `% 1000` keeps the sign, and f goes negative — which produced
  // a p10 of MINUS 2.6 MINUTES in the first dry run. A negative time-to-price is
  // impossible and would have been visible on the chart as a line below zero.
  var f = ((h >>> 7) % 1000) / 1000;                           // 0..1
  var mins = REAL.p10 + f * (REAL.p90 - REAL.p10);
  // Never past the end of the call — a price drop after the call ended is the
  // kind of impossible number a demo must not contain.
  var cap = (duration ? duration / 60 : 60) - 3;
  if (cap < REAL.p10) return null;
  return Math.round(Math.min(mins, cap) * 60);
}

(async function main() {
  const client = db();

  let calls = [], from = 0;
  for (;;) {
    const q = await client.from('fathom_calls')
      .select('id, user_id, fathom_call_id, call_date, duration_seconds')
      .like('fathom_call_id', MARKER + '%').range(from, from + 499);
    if (q.error) throw new Error('fathom_calls: ' + q.error.message);
    calls = calls.concat(q.data || []);
    if (!q.data || q.data.length < 500) break;
    from += 500;
  }
  console.log('seeded calls matching ' + MARKER + '% : ' + calls.length);
  if (!calls.length) { console.log('nothing to do'); return; }

  // ⚠ VERIFY EVERY TARGET EXISTS before planning a write to it — the standing
  // data-op rule. A plausible-looking id is not an id.
  const byId = {};
  const ids = calls.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 50) {
    const q = await client.from('call_analyses')
      .select('fathom_call_id, outcome, price_stated_at_seconds')
      .in('fathom_call_id', ids.slice(i, i + 50)).eq('status', 'done');
    if (q.error) throw new Error('call_analyses: ' + q.error.message);
    (q.data || []).forEach((a) => { byId[a.fathom_call_id] = a; });
  }

  // ⚠ ONE REP GETS A WHOLE NULL DAY. Chosen deterministically: the rep with the
  // most calls, on their busiest day, so the gap is visible rather than hidden
  // in a thin corner of the chart.
  const perRep = {};
  calls.forEach((c) => { perRep[c.user_id] = (perRep[c.user_id] || 0) + 1; });
  const nullRep = Object.keys(perRep).sort((a, b) => perRep[b] - perRep[a])[0];
  const dayCount = {};
  calls.filter((c) => c.user_id === nullRep)
    .forEach((c) => { const d = String(c.call_date).slice(0, 10); dayCount[d] = (dayCount[d] || 0) + 1; });
  const nullDay = Object.keys(dayCount).sort((a, b) => dayCount[b] - dayCount[a])[0];
  console.log('deliberate NULL DAY: rep ' + String(nullRep).slice(0, 8) + ' on ' + nullDay
    + ' (' + dayCount[nullDay] + ' calls)');

  const plan = [];
  let missing = 0;
  calls.forEach((c) => {
    if (!byId[c.id]) { missing++; return; }
    const inNullDay = (c.user_id === nullRep && String(c.call_date).slice(0, 10) === nullDay);
    const secs = inNullDay ? null : priceSecondsFor(c.fathom_call_id, c.duration_seconds);
    plan.push({ id: c.id, ext: c.fathom_call_id, secs: secs, outcome: byId[c.id].outcome });
  });

  const withVal = plan.filter((p) => p.secs !== null);
  const mins = withVal.map((p) => p.secs / 60).sort((a, b) => a - b);
  const at = (q) => (mins.length ? mins[Math.floor(q * (mins.length - 1))].toFixed(1) : '-');
  console.log('\nanalyses found      ' + plan.length + (missing ? '   (⚠ ' + missing + ' calls had no done analysis)' : ''));
  console.log('will get a moment   ' + withVal.length);
  console.log('will stay NULL      ' + (plan.length - withVal.length)
    + '   (' + Math.round(100 * (plan.length - withVal.length) / plan.length) + '% — real is '
    + Math.round(REAL.nullShare * 100) + '%)');
  console.log('\nseeded distribution   p10 ' + at(0.1) + '  median ' + at(0.5) + '  p90 ' + at(0.9));
  console.log("Josh's REAL           p10 " + REAL.p10 + '  median ' + REAL.median + '  p90 ' + REAL.p90);

  /**
   * ⚠ THE PLAN ASSERTS ITS OWN OUTPUT. The first dry run produced a p10 of -2.6
   * minutes from a signed-shift bug; it was caught by READING the printed
   * distribution, which is luck rather than process. This makes the check
   * mechanical: a demo value outside the real band, or below zero, aborts.
   */
  var lo = mins.length ? mins[0] : null, hi = mins.length ? mins[mins.length - 1] : null;
  if (lo !== null && (lo < 1 || hi > REAL.p90 + 1)) {
    console.error('\n⚠ ABORT — seeded values fall outside the real band: min ' + lo.toFixed(1)
      + ' max ' + hi.toFixed(1) + ' against p10 ' + REAL.p10 + ' / p90 ' + REAL.p90
      + '. The demo must never look better OR more impossible than the metric.');
    process.exitCode = 1; return;
  }

  if (!WRITE) { console.log('\nPLAN ONLY — nothing written. Re-run with --write.'); return; }

  let wrote = 0, failed = 0;
  for (const p of plan) {
    const up = await client.from('call_analyses')
      .update({ price_stated_at_seconds: p.secs, price_quote: p.secs === null ? null : '(seeded demo value — not a real quote)' })
      .eq('fathom_call_id', p.id);
    if (up.error) { failed++; console.error('  FAILED ' + p.ext + ': ' + up.error.message); continue; }
    wrote++;
  }
  console.log('\nwrote ' + wrote + ' · failed ' + failed);

  const rc = await client.from('call_analyses').select('fathom_call_id', { count: 'exact', head: true })
    .not('price_stated_at_seconds', 'is', null);
  console.log('RECOUNT — rows with a price moment (all users): ' + rc.count);
  if (failed) { console.error('⚠ NOT CLEAN'); process.exitCode = 1; }
})().catch((e) => { console.error(e.message); process.exit(1); });
