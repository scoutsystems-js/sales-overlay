// Tests for computeCallAnalytics cash + close-rate (A-1 glance tiles).
//
// A-1 (2026-07-27) adds two cheap, no-LLM fields to /me/analytics2 so the
// collapsed coaching overview can show Cash + Close-rate glance tiles matching
// the team glance boxes (B-1): cash_collected (sum of call_analyses.cash_collected
// over DONE analyses) and close_rate = closed / (closed + lost) — decided calls
// only per ruling 1 (follow_up = open pipeline, no_show excluded).
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const sa = require('../lib/session-analytics');

// Universal read-chain fake (same as team-analytics.test.js): every chain method
// returns the same object; awaiting any terminal resolves to the table's seeded
// rows. Filters ignored — seed pre-scoped small arrays (<100 ids ⇒ single .in
// chunk, <1000 ⇒ single .range page ⇒ no double count).
function fakeAdmin(tables) {
  return {
    from(table) {
      var data = tables[table] || [];
      var chain = {
        select() { return chain; }, in() { return chain; }, eq() { return chain; },
        gte() { return chain; }, lte() { return chain; }, order() { return chain; },
        range() { return chain; }, then(resolve) { resolve({ data: data, error: null }); },
      };
      return chain;
    },
  };
}

const FROM = '2026-07-01T00:00:00Z', TO = '2026-07-31T00:00:00Z';
const CALLS = [
  { id: 'c1', call_date: '2026-07-10T00:00:00Z', title: 'A' },
  { id: 'c2', call_date: '2026-07-11T00:00:00Z', title: 'B' },
  { id: 'c3', call_date: '2026-07-12T00:00:00Z', title: 'C' },
  { id: 'c4', call_date: '2026-07-13T00:00:00Z', title: 'D' },
];
// 2 closed ($5000 + $3000), 1 lost, 1 follow_up. cash 8000; decided = 2+1 = 3;
// close_rate = round(2/3*100) = 67; follow_up excluded.
const ANALYSES = [
  { fathom_call_id: 'c1', status: 'done', outcome: 'closed', overall_score: 70, cash_collected: 5000 },
  { fathom_call_id: 'c2', status: 'done', outcome: 'closed', overall_score: 80, cash_collected: 3000 },
  { fathom_call_id: 'c3', status: 'done', outcome: 'lost', overall_score: 40, cash_collected: 0 },
  { fathom_call_id: 'c4', status: 'done', outcome: 'follow_up', overall_score: 55, cash_collected: 0 },
];

test('computeCallAnalytics adds cash_collected (sum over done analyses)', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: [] });
  var out = await sa.computeCallAnalytics(admin, 'U', FROM, TO);
  assert.strictEqual(out.cash_collected, 8000);
});

test('computeCallAnalytics close_rate = closed/(closed+lost), follow_up excluded', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: [] });
  var out = await sa.computeCallAnalytics(admin, 'U', FROM, TO);
  assert.strictEqual(out.close_wins, 2);
  assert.strictEqual(out.close_decided, 3);
  assert.strictEqual(out.close_rate, 67);
});

test('cash only counts DONE analyses; held/processing excluded', async () => {
  var mixed = ANALYSES.concat([
    { fathom_call_id: 'c5', status: 'synced_unanalyzed', outcome: 'closed', overall_score: 90, cash_collected: 9999 },
  ]);
  var calls = CALLS.concat([{ id: 'c5', call_date: '2026-07-14T00:00:00Z', title: 'E' }]);
  var admin = fakeAdmin({ fathom_calls: calls, call_analyses: mixed, call_highlights: [] });
  var out = await sa.computeCallAnalytics(admin, 'U', FROM, TO);
  assert.strictEqual(out.cash_collected, 8000); // c5's 9999 excluded (not done)
  assert.strictEqual(out.close_decided, 3);      // c5's closed excluded from decided
});

test('cash coerces numeric-as-string and rounds cents; close_rate null when no decided', async () => {
  var calls = [{ id: 'd1', call_date: '2026-07-10T00:00:00Z', title: 'X' }, { id: 'd2', call_date: '2026-07-11T00:00:00Z', title: 'Y' }];
  var analyses = [
    { fathom_call_id: 'd1', status: 'done', outcome: 'follow_up', overall_score: 60, cash_collected: '0' },
    { fathom_call_id: 'd2', status: 'done', outcome: 'follow_up', overall_score: 65, cash_collected: '12.50' },
  ];
  var admin = fakeAdmin({ fathom_calls: calls, call_analyses: analyses, call_highlights: [] });
  var out = await sa.computeCallAnalytics(admin, 'U', FROM, TO);
  assert.strictEqual(out.cash_collected, 12.5);
  assert.strictEqual(out.close_rate, null); // 0 decided calls
  assert.strictEqual(out.close_decided, 0);
});

test('empty range → cash_collected 0, close_rate null', async () => {
  var admin = fakeAdmin({ fathom_calls: [], call_analyses: [], call_highlights: [] });
  var out = await sa.computeCallAnalytics(admin, 'U', FROM, TO);
  assert.strictEqual(out.cash_collected, 0);
  assert.strictEqual(out.close_rate, null);
});
