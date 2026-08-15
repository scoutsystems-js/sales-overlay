/**
 * 10a — per-rep weekly series for the manager board.
 *
 * Two lines per rep over time: objection handle rate, and closing rate. Pure
 * and deterministic — ZERO model cost. The handle rate deliberately does NOT
 * route through team-needs-work's LLM bucket lane: those buckets exist to GROUP
 * surface phrases for the needs-work card, not to compute a rate, and a weekly
 * series through them would be weeks × reps Claude calls.
 *
 * ⚠ THE CLOSING RATE IS closed PROSPECTS ÷ TOTAL PROSPECTS. computeTeamTrends
 * has a `win_rate` that is wins ÷ DECIDED — the retired per-call definition.
 * Reusing it would silently put the old 90% figure back on a manager's board
 * after the prospect definition corrected it to 40%. There is a guard test.
 */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/rep-series');

// Source with comments stripped — the guards below check CODE, not prose.
const RAW = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'lib', 'rep-series.js'), 'utf8');
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WK1 = '2026-08-03T10:00:00Z';   // Monday
const WK1b = '2026-08-05T10:00:00Z';  // same week
const WK2 = '2026-08-10T10:00:00Z';   // next Monday
const WK3 = '2026-08-17T10:00:00Z';

function build(over) {
  return S.buildRepSeries(Object.assign({
    reps: [{ user_id: 'r1', name: 'Ava' }],
    calls: [], analyses: [], objections: [],
    from: '2026-08-03T00:00:00Z', to: '2026-08-23T00:00:00Z', bucket: 'week',
  }, over));
}

// ─── handle rate ───────────────────────────────────────────────────────────

test('handle rate is handled ÷ objections, per rep per week, with raw counts', () => {
  const out = build({
    calls: [{ id: 'c1', user_id: 'r1', call_date: WK1 }],
    objections: [
      { fathom_call_id: 'c1', resolution: 'handled' },
      { fathom_call_id: 'c1', resolution: 'partial' },
      { fathom_call_id: 'c1', resolution: 'unhandled' },
      { fathom_call_id: 'c1', resolution: 'handled' },
    ],
  });
  const p = out.reps[0].handle[0];
  assert.strictEqual(p.rate, 50);
  assert.strictEqual(p.handled, 2);
  assert.strictEqual(p.total, 4);   // rates always render with their counts
});

test('a week with NO objections is null, never 0 — 0% reads as "handled nothing"', () => {
  const out = build({ calls: [{ id: 'c1', user_id: 'r1', call_date: WK1 }], objections: [] });
  assert.strictEqual(out.reps[0].handle[0].rate, null);
  assert.strictEqual(out.reps[0].handle[0].total, 0);
});

test('a week where every objection went unhandled IS 0 — that is real', () => {
  const out = build({
    calls: [{ id: 'c1', user_id: 'r1', call_date: WK1 }],
    objections: [{ fathom_call_id: 'c1', resolution: 'unhandled' }],
  });
  assert.strictEqual(out.reps[0].handle[0].rate, 0, 'a genuine zero must not be confused with no data');
});

test('the objection SELECTOR filters on objection_category', () => {
  // Ruling: use Scout's existing labelling. There is deliberately no "price" —
  // money-phrased objections stay under `fear` per the standing rule.
  const objections = [
    { fathom_call_id: 'c1', resolution: 'handled', objection_category: 'partner' },
    { fathom_call_id: 'c1', resolution: 'unhandled', objection_category: 'fear' },
    { fathom_call_id: 'c1', resolution: 'unhandled', objection_category: 'fear' },
  ];
  const calls = [{ id: 'c1', user_id: 'r1', call_date: WK1 }];
  assert.strictEqual(build({ calls, objections }).reps[0].handle[0].rate, 33, 'all objections');
  assert.strictEqual(build({ calls, objections, objectionCategory: 'partner' }).reps[0].handle[0].rate, 100);
  assert.strictEqual(build({ calls, objections, objectionCategory: 'fear' }).reps[0].handle[0].rate, 0);
  assert.strictEqual(build({ calls, objections, objectionCategory: 'timing' }).reps[0].handle[0].rate, null, 'none that week');
});

test('the four categories are the selector vocabulary — no invented labels', () => {
  assert.deepStrictEqual(S.OBJECTION_CATEGORIES, ['fear', 'timing', 'logistical', 'partner']);
});

// ─── closing rate ──────────────────────────────────────────────────────────

test('closing rate is closed PROSPECTS ÷ TOTAL prospects, not decided-only', () => {
  // The whole point of the standing definition: open prospects count as
  // not-closed, which is what took the number from 90% to 40%.
  const out = build({
    calls: [
      { id: 'c1', user_id: 'r1', call_date: WK1, prospect_id: 'p1' },
      { id: 'c2', user_id: 'r1', call_date: WK1, prospect_id: 'p2' },
      { id: 'c3', user_id: 'r1', call_date: WK1, prospect_id: 'p3' },
      { id: 'c4', user_id: 'r1', call_date: WK1, prospect_id: 'p4' },
    ],
    analyses: [
      { fathom_call_id: 'c1', outcome: 'closed' },
      { fathom_call_id: 'c2', outcome: 'lost' },
      { fathom_call_id: 'c3', outcome: 'follow_up' },   // OPEN — still in the denominator
      { fathom_call_id: 'c4', outcome: null },          // OPEN
    ],
  });
  const p = out.reps[0].close[0];
  assert.strictEqual(p.total, 4, 'open prospects stay in the denominator');
  assert.strictEqual(p.closed, 1);
  assert.strictEqual(p.rate, 25, 'decided-only would have said 50%');
});

test('a prospect spanning weeks is counted ONCE, in the week of their FIRST call', () => {
  const out = build({
    calls: [
      { id: 'c1', user_id: 'r1', call_date: WK1, prospect_id: 'p1' },
      { id: 'c2', user_id: 'r1', call_date: WK2, prospect_id: 'p1' },  // follow-up
      { id: 'c3', user_id: 'r1', call_date: WK3, prospect_id: 'p1' },  // closed here
    ],
    analyses: [
      { fathom_call_id: 'c1', outcome: 'follow_up' },
      { fathom_call_id: 'c2', outcome: 'follow_up' },
      { fathom_call_id: 'c3', outcome: 'closed' },
    ],
  });
  assert.strictEqual(out.reps[0].close[0].total, 1, 'counted in week 1');
  assert.strictEqual(out.reps[0].close[0].closed, 1, 'ANY close wins the prospect');
  assert.strictEqual(out.reps[0].close[1].total, 0, 'not re-counted in week 2');
  assert.strictEqual(out.reps[0].close[1].rate, null);
});

test('a week with no prospects is null, not 0', () => {
  const out = build({ calls: [{ id: 'c1', user_id: 'r1', call_date: WK2, prospect_id: 'p1' }], analyses: [] });
  assert.strictEqual(out.reps[0].close[0].rate, null, 'week 1 had nobody');
});

test('calls with no prospect_id are ignored rather than counted as a prospect', () => {
  const out = build({
    calls: [{ id: 'c1', user_id: 'r1', call_date: WK1, prospect_id: null }],
    analyses: [{ fathom_call_id: 'c1', outcome: 'closed' }],
  });
  assert.strictEqual(out.reps[0].close[0].rate, null);
});

// ─── the team line ─────────────────────────────────────────────────────────

test('team average is a real average ACROSS REPS, skipping reps with no data', () => {
  const out = S.buildRepSeries({
    reps: [{ user_id: 'r1', name: 'A' }, { user_id: 'r2', name: 'B' }, { user_id: 'r3', name: 'C' }],
    calls: [
      { id: 'c1', user_id: 'r1', call_date: WK1 },
      { id: 'c2', user_id: 'r2', call_date: WK1 },
    ],
    objections: [
      { fathom_call_id: 'c1', resolution: 'handled' },                 // r1 = 100%
      { fathom_call_id: 'c2', resolution: 'unhandled' },               // r2 = 0%
    ],
    analyses: [], from: '2026-08-03T00:00:00Z', to: '2026-08-16T00:00:00Z', bucket: 'week',
  });
  // r3 had nothing that week and must not drag the average to 33.
  assert.strictEqual(out.team.handle[0].rate, 50);
  assert.strictEqual(out.team.handle[0].reps_counted, 2);
});

test('a week where NO rep has data leaves the team line broken too', () => {
  const out = build({ calls: [], objections: [] });
  assert.strictEqual(out.team.handle[0].rate, null);
});

// ─── shape + robustness ────────────────────────────────────────────────────

test('every rep gets a point for every bucket, so the x axis lines up', () => {
  const out = build({ calls: [{ id: 'c1', user_id: 'r1', call_date: WK1 }] });
  assert.strictEqual(out.buckets.length, out.reps[0].handle.length);
  assert.strictEqual(out.buckets.length, out.reps[0].close.length);
  assert.strictEqual(out.buckets.length, out.team.handle.length);
});

test('buckets carry a human label for the axis', () => {
  const out = build({ calls: [{ id: 'c1', user_id: 'r1', call_date: WK1 }] });
  assert.ok(out.buckets[0].label && typeof out.buckets[0].label === 'string');
  assert.ok(out.buckets[0].from);
});

test('malformed input degrades to an empty series, never throws', () => {
  [null, undefined, {}, { reps: null }].forEach((junk) => {
    const out = S.buildRepSeries(junk);
    assert.ok(Array.isArray(out.reps));
    assert.ok(Array.isArray(out.buckets));
  });
});

// ─── the guard that matters ────────────────────────────────────────────────

test('GUARD: the retired wins ÷ decided definition is never used here', () => {
  // computeTeamTrends.win_rate is wins/decided. Putting it on a manager's board
  // would silently reinstate ~90% after the prospect definition corrected it to
  // ~40%. This must fail loudly if anyone wires it in.
  //
  // Checks CODE, not prose: the header comment names these deliberately, to
  // explain why they are absent. Banning the words would fail on the
  // explanation — the same false positive the selling-context guard hit.
  assert.ok(!/win_rate/.test(CODE), 'rep-series must not reference win_rate in code');
  assert.ok(!/computeTeamTrends/.test(CODE), 'and must not import the trends lane');
  assert.ok(!/\bdecided\b/.test(CODE), 'no decided-only arithmetic');
});

test('GUARD: the handle rate does not route through the LLM bucket lane', () => {
  assert.ok(!/team-needs-work/.test(CODE), 'zero model cost — buckets group phrases, they do not compute the rate');
  assert.ok(!/Anthropic|CLAUDE_MODEL/.test(CODE));
  // And prove the guard is non-vacuous: the file really does import the two
  // things it SHOULD, so an empty CODE string could not pass silently.
  assert.ok(/require\('\.\/team-analytics'\)/.test(CODE), 'bucketing is reused');
  assert.ok(/require\('\.\/prospect-entity'\)/.test(CODE), 'the prospect definition is reused');
});
