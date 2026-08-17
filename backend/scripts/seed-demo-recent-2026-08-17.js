/**
 * SEED THE LAST 7 DAYS so the speedometer panel has populated dials.
 *
 * ⚠ WHY THIS EXISTS: the 2026-08-16 seed spread 72 calls over SIX WEEKS, and the
 * gauge panel reads a FIXED LAST-7-DAYS window. All three demo dials therefore
 * read "Not enough to judge" (2, 0 and 2 objections) — the threshold working
 * correctly on data that simply is not there.
 *
 * ⚠ SAME MARKER as the original seed (`seed-2026-08-16-`) and the same
 * `Seed %` prospect naming, ON PURPOSE: the documented two-line removal must keep
 * sweeping EVERYTHING. A new marker would leave rows behind that nobody knows to
 * look for.
 *
 *     delete from fathom_calls where fathom_call_id like 'seed-2026-08-16-%';
 *     delete from prospects     where display_name  like 'Seed %';
 *
 * ⚠ THE RATES ARE ENGINEERED, NOT RANDOM — one rep per band, so the banding is
 * legible at a glance:
 *
 *   objection target 35  → green ≥35 · yellow 21–35 · red <21
 *   closing   target 25  → green ≥25 · yellow 15–25 · red <15
 *
 * ⚠⚠ WHERE A SEEDED OBJECTION SITS SILENTLY DETERMINES ITS RATE. Under the
 * 2026-08-17 ruling an objection on a CLOSED call is credited as handled
 * WHATEVER its resolution — so the same row, moved from one call to another,
 * changes the number on the dial without changing anything you can see in the
 * row itself. A seed whose whole job is to demonstrate BANDS must therefore
 * place its objections where the credit rule DOES NOT FIRE, or it will quietly
 * demonstrate the wrong band and look entirely correct doing it.
 *
 * Hence: objections go only on NON-CLOSED calls. That makes handled ==
 * resolution exactly, and the arithmetic in PLAN below is then the truth.
 *
 * The general form, for any future seed: when a metric's definition depends on
 * a row's CONTEXT and not only its own fields, seeding that metric means
 * controlling the context too.
 *
 * Usage:  node scripts/seed-demo-recent-2026-08-17.js            (plan only)
 *         node scripts/seed-demo-recent-2026-08-17.js --insert
 */
const fs = require('fs');
const REPO = '/Users/justinschmidt/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay';
const K = fs.readFileSync(REPO + '/API Keys.md', 'utf8');
const v = (n) => K.match(new RegExp('^' + n + '=(.+)$', 'm'))[1].trim();
const { createClient } = require(REPO + '/backend/node_modules/@supabase/supabase-js');
const admin = createClient(v('SUPABASE_URL'), v('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const MARK = 'seed-2026-08-16-';          // ⚠ unchanged, so one removal sweeps all
const TAG = 'w7';                          // distinguishes THESE rows within the marker
const JOSH = '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1';

// ⚠ REAL ids, and re-verified against user_profiles before a single write.
const REPS = [
  { id: '49711e7d-0dc0-4c6d-959d-f2a5bfe9a20a', name: 'demo-ava' },
  { id: '8bda1aac-6404-46a8-a353-de83606b298f', name: 'demo-ben' },
  { id: 'e3ae475c-e788-45d6-a2ba-c40ca7f20a2d', name: 'demo-cara' },
];

// prospects: one call each, first call inside the window (rep-series buckets a
// prospect by their FIRST call, so an earlier first call would drop them out).
// objections: spread across that rep's NON-CLOSED calls only.
const PLAN = [
  { rep: 0, prospects: 10, closed: 1, objections: 12, handled: 2,
    band: 'RED    — 17% handled · 10% closing' },
  { rep: 1, prospects: 10, closed: 2, objections: 12, handled: 3,
    band: 'YELLOW — 25% handled · 20% closing' },
  { rep: 2, prospects: 10, closed: 4, objections: 12, handled: 6,
    band: 'GREEN  — 50% handled · 40% closing' },
];

let _s = 20260817;
function rnd() { _s = (_s * 1103515245 + 12345) % 2147483648; return _s / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

async function counts(userId) {
  const c = await admin.from('fathom_calls').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const a = await admin.from('call_analyses').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const p = await admin.from('prospects').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return { calls: c.count, analyses: a.count, prospects: p.count };
}
async function markerCount() {
  const r = await admin.from('fathom_calls').select('id', { count: 'exact', head: true }).like('fathom_call_id', MARK + '%');
  return r.count;
}

async function main() {
  const insert = process.argv[2] === '--insert';
  console.log('=== RECENT-WINDOW SEED — marker "' + MARK + '" · tag "' + TAG + '" ===\n');

  PLAN.forEach(function (p) {
    const r = REPS[p.rep];
    console.log('  ' + r.name.padEnd(11) + p.band);
    console.log('             ' + p.objections + ' objections (' + p.handled + ' handled = '
      + pct(p.handled, p.objections) + '%) · ' + p.prospects + ' prospects ('
      + p.closed + ' closed = ' + pct(p.closed, p.prospects) + '%)');
    console.log('             clears both floors: ' + p.objections + ' ≥ 6 objections, '
      + p.prospects + ' ≥ 6 prospects');
  });
  const totalCalls = PLAN.reduce((a, p) => a + p.prospects, 0);
  console.log('\n  ' + totalCalls + ' calls, ' + PLAN.reduce((a, p) => a + p.prospects, 0)
    + ' prospects, ' + PLAN.reduce((a, p) => a + p.objections, 0) + ' objections. ZERO model calls.');
  console.log('  All dated within the last 6 days, so they sit inside the fixed gauge window.');
  console.log('\n  REMOVAL (unchanged — this seed uses the SAME marker):');
  console.log("    delete from fathom_calls where fathom_call_id like '" + MARK + "%';");
  console.log("    delete from prospects     where display_name  like 'Seed %';");

  const joshBefore = await counts(JOSH);
  const markBefore = await markerCount();
  console.log('\n=== BEFORE ===');
  console.log('  JOSH   calls=' + joshBefore.calls + '  analyses=' + joshBefore.analyses + '  prospects=' + joshBefore.prospects);
  console.log('  marker rows (' + MARK + '%): ' + markBefore);

  const check = await admin.from('user_profiles').select('user_id').in('user_id', REPS.map((r) => r.id));
  const found = (check.data || []).map((r) => r.user_id);
  console.log('\n=== TARGET IDS VERIFIED ===');
  REPS.forEach((r) => console.log('  ' + r.name.padEnd(11) + (found.indexOf(r.id) !== -1 ? 'exists' : '*** NOT FOUND ***')));
  if (found.length !== REPS.length) { console.error('\nABORT: a target user_id does not exist.'); return; }

  if (!insert) { console.log('\n[plan only — nothing written. re-run with --insert]'); return; }

  console.log('\n=== INSERTING ===');
  const now = Date.now();
  for (const p of PLAN) {
    const rep = REPS[p.rep];
    // Spread the objections over this rep's NON-closed calls, front-loading the
    // handled ones so the counts are exact rather than probabilistic.
    const openCalls = p.prospects - p.closed;
    let objLeft = p.objections, handledLeft = p.handled, made = 0, madeHandled = 0;

    for (let i = 0; i < p.prospects; i++) {
      const isClosed = i < p.closed;
      // days 1..6 back — never day 0 (partial day) and never day 7 (outside).
      const dayBack = 1 + (i % 6);
      const callDate = new Date(now - dayBack * 86400000 + (i * 137000)).toISOString();

      const nm = 'Seed ' + rep.name.replace('demo-', '') + ' W7 Prospect ' + (i + 1);
      const pr = await admin.from('prospects').insert({
        user_id: rep.id, display_name: nm,
        name_key: nm.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      }).select('id').single();
      if (pr.error) { console.error('  prospect insert failed: ' + pr.error.message); return; }

      const c = await admin.from('fathom_calls').insert({
        user_id: rep.id, fathom_call_id: MARK + rep.name + '-' + TAG + '-' + i,
        title: 'Seed recent call ' + (i + 1) + ' | ' + rep.name, call_date: callDate,
        duration_seconds: 1800 + Math.floor(rnd() * 1500), sync_status: 'processed',
        source: 'fathom', prospect_id: pr.data.id,
      }).select('id').single();
      if (c.error) { console.error('  call insert failed: ' + c.error.message); return; }

      const a = await admin.from('call_analyses').insert({
        fathom_call_id: c.data.id, user_id: rep.id, status: 'done',
        prompt_version: 'seed-2026-08-16', analyzed_at: callDate,
        overall_score: 45 + Math.floor(rnd() * 30),
        intro_score: 50 + Math.floor(rnd() * 25), discovery_score: 40 + Math.floor(rnd() * 25),
        pitch_score: 55 + Math.floor(rnd() * 25), objection_score: 45 + Math.floor(rnd() * 25),
        close_score: isClosed ? 100 : 45 + Math.floor(rnd() * 25),
        close_score_earned: 40 + Math.floor(rnd() * 30),
        outcome: isClosed ? 'closed' : pick(['follow_up', 'lost', 'follow_up']),
        outcome_source: 'inferred', cash_collected: isClosed ? 2500 : 0,
        overall_summary: 'Seeded demo call (recent window).',
      });
      if (a.error) { console.error('  analysis insert failed: ' + a.error.message); return; }

      // ⚠ NOT on closed calls — a closed call credits every objection on it.
      if (isClosed) continue;
      const openIdx = i - p.closed;
      const remainingOpen = openCalls - openIdx;
      const thisCall = Math.ceil(objLeft / remainingOpen);
      for (let k = 0; k < thisCall; k++) {
        const handled = madeHandled < handledLeft;
        if (handled) madeHandled++;
        const h = await admin.from('call_highlights').insert({
          fathom_call_id: c.data.id, user_id: rep.id, type: 'objection',
          timestamp_seconds: 600 + Math.floor(rnd() * 1200), speaker: 'PROSPECT',
          quote: 'Seeded recent objection quote.', observation: 'Seeded observation.',
          objection_category: pick(['fear', 'timing', 'logistical', 'partner']),
          resolution: handled ? 'handled' : pick(['partial', 'unhandled']),
          section: 'objection', sequence_order: k,
        });
        if (h.error) { console.error('  highlight insert failed: ' + h.error.message); return; }
        made++; objLeft--;
      }
    }
    console.log('  ' + rep.name.padEnd(11) + made + ' objections (' + madeHandled + ' handled = '
      + pct(madeHandled, made) + '%) · ' + p.prospects + ' prospects (' + p.closed + ' closed = '
      + pct(p.closed, p.prospects) + '%)');
  }

  const joshAfter = await counts(JOSH);
  const markAfter = await markerCount();
  console.log('\n=== AFTER ===');
  console.log('  JOSH   calls=' + joshAfter.calls + '  analyses=' + joshAfter.analyses + '  prospects=' + joshAfter.prospects);
  console.log('  marker rows (' + MARK + '%): ' + markAfter + '  (was ' + markBefore + ')');
  const untouched = joshAfter.calls === joshBefore.calls && joshAfter.analyses === joshBefore.analyses
    && joshAfter.prospects === joshBefore.prospects;
  console.log('\n  JOSH UNTOUCHED: ' + (untouched ? 'YES' : '*** NO — INVESTIGATE ***'));
}

main().catch((e) => { console.error(e); process.exit(1); });
