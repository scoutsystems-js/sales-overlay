// Tests for team-analytics.computeTeamAnalytics — B-1 glance-box metrics.
//
// B-1 (2026-07-26) adds two team-glance metrics to the per-rep cards and team
// totals: cash_collected (sum of call_analyses.cash_collected) and close_rate
// per Justin's ruling 1 = closed / (closed + lost), DECIDED calls only —
// follow_up is still-open pipeline, NOT a loss, so it's excluded from the
// denominator (no_show also excluded). Objection handle rate already existed.
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const ta = require('../lib/team-analytics');

// Minimal read-chain fake of the supabase-js client. Every chain method returns
// the same object; awaiting at any terminal (.range/.eq/.in) resolves to the
// seeded rows for that table. Filters (.in/.eq/.gte/.lte) are intentionally
// ignored — the seeded arrays are small and pre-scoped, so each table's full
// set is returned once per query (test data stays <100 ids ⇒ single .in chunk,
// <1000 rows ⇒ single .range page, no double-count).
function fakeAdmin(tables) {
  return {
    from(table) {
      var data = tables[table] || [];
      var chain = {
        select() { return chain; },
        in() { return chain; },
        eq() { return chain; },
        gte() { return chain; },
        lte() { return chain; },
        order() { return chain; },
        range() { return chain; },
        then(resolve) { resolve({ data: data, error: null }); },
      };
      return chain;
    },
  };
}

// Two reps, mixed outcomes. Cash is grader-forced to 0 on non-closed calls, so
// summing across all done analyses == summing the closed ones.
//   A: 1 closed ($5000), 1 lost, 1 follow_up  → close_rate 1/(1+1)=50%, cash 5000
//   B: 2 closed ($3000 + $2000)               → close_rate 2/(2+0)=100%, cash 5000
// Team: closed 3, lost 1, decided 4 → 75% ; cash 10000.
const CALLS = [
  { id: 'a1', user_id: 'A', call_date: '2026-07-20T00:00:00Z' },
  { id: 'a2', user_id: 'A', call_date: '2026-07-20T00:00:00Z' },
  { id: 'a3', user_id: 'A', call_date: '2026-07-20T00:00:00Z' },
  { id: 'b1', user_id: 'B', call_date: '2026-07-20T00:00:00Z' },
  { id: 'b2', user_id: 'B', call_date: '2026-07-20T00:00:00Z' },
];
const ANALYSES = [
  { fathom_call_id: 'a1', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 70, outcome: 'closed', cash_collected: 5000 },
  { fathom_call_id: 'a2', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 40, outcome: 'lost', cash_collected: 0 },
  { fathom_call_id: 'a3', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 55, outcome: 'follow_up', cash_collected: 0 },
  { fathom_call_id: 'b1', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 80, outcome: 'closed', cash_collected: 3000 },
  { fathom_call_id: 'b2', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 75, outcome: 'closed', cash_collected: 2000 },
];

function repOf(out, id) { return out.per_rep.find(function (r) { return r.user_id === id; }); }

test('per-rep cash_collected sums call_analyses.cash_collected', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: [], user_profiles: [] });
  var out = await ta.computeTeamAnalytics(admin, ['A', 'B'], '2026-07-15T00:00:00Z', '2026-07-25T00:00:00Z', { A: 'ava@x.co', B: 'ben@x.co' });
  assert.strictEqual(repOf(out, 'A').cash_collected, 5000);
  assert.strictEqual(repOf(out, 'B').cash_collected, 5000);
});

test('per-rep close_rate = closed/(closed+lost), follow_up excluded', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: [], user_profiles: [] });
  var out = await ta.computeTeamAnalytics(admin, ['A', 'B'], '2026-07-15T00:00:00Z', '2026-07-25T00:00:00Z', {});
  var a = repOf(out, 'A');
  assert.strictEqual(a.close_rate, 50);      // 1 closed / (1 closed + 1 lost); follow_up ignored
  assert.strictEqual(a.close_wins, 1);
  assert.strictEqual(a.close_decided, 2);
  var b = repOf(out, 'B');
  assert.strictEqual(b.close_rate, 100);     // 2 / (2 + 0)
  assert.strictEqual(b.close_decided, 2);
});

test('close_rate is null when a rep has no decided calls', async () => {
  var calls = [{ id: 'c1', user_id: 'C', call_date: '2026-07-20T00:00:00Z' }];
  var analyses = [{ fathom_call_id: 'c1', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 60, outcome: 'follow_up', cash_collected: 0 }];
  var admin = fakeAdmin({ fathom_calls: calls, call_analyses: analyses, call_highlights: [], user_profiles: [] });
  var out = await ta.computeTeamAnalytics(admin, ['C'], '2026-07-15T00:00:00Z', '2026-07-25T00:00:00Z', {});
  var c = repOf(out, 'C');
  assert.strictEqual(c.close_rate, null);
  assert.strictEqual(c.close_decided, 0);
  assert.strictEqual(c.cash_collected, 0);
});

test('team totals: cash_collected summed, close_rate over the whole team', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: [], user_profiles: [] });
  var out = await ta.computeTeamAnalytics(admin, ['A', 'B'], '2026-07-15T00:00:00Z', '2026-07-25T00:00:00Z', {});
  assert.strictEqual(out.totals.cash_collected, 10000);
  assert.strictEqual(out.totals.close_wins, 3);
  assert.strictEqual(out.totals.close_decided, 4);
  assert.strictEqual(out.totals.close_rate, 75); // round(3/4*100)
});

test('cash_collected coerces numeric-as-string (PostgREST numeric) and rounds cents', async () => {
  var calls = [{ id: 'd1', user_id: 'D', call_date: '2026-07-20T00:00:00Z' }, { id: 'd2', user_id: 'D', call_date: '2026-07-20T00:00:00Z' }];
  var analyses = [
    { fathom_call_id: 'd1', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 90, outcome: 'closed', cash_collected: '1200.50' },
    { fathom_call_id: 'd2', analyzed_at: '2026-07-20T01:00:00Z', overall_score: 85, outcome: 'closed', cash_collected: '300.25' },
  ];
  var admin = fakeAdmin({ fathom_calls: calls, call_analyses: analyses, call_highlights: [], user_profiles: [] });
  var out = await ta.computeTeamAnalytics(admin, ['D'], '2026-07-15T00:00:00Z', '2026-07-25T00:00:00Z', {});
  assert.strictEqual(repOf(out, 'D').cash_collected, 1500.75);
});
