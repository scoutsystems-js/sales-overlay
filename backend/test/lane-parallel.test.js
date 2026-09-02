'use strict';
/* ⚠⚠ THE WARM FLOOR IS ORDINARY ROUND TRIPS RUN ONE AFTER ANOTHER.
   Measured on production 2026-09-02: /team/overview ~6-7s and /me/analytics2
   ~6s with every cache hit — no model call in either. computeTeamAnalytics
   awaited ~12 Supabase queries in sequence; computeCallAnalytics the same
   shape. This drives the REAL entry points with an admin whose every query
   takes a fixed delay and records how many were in flight at once. Sequential
   code peaks at 2 (the one Promise.all it already had); parallel code peaks
   higher and finishes in a fraction of total × delay.
   ⚠ Correctness rides along: the parallel result must equal the delay-0 result
   and the counts must be the counts. */
const test = require('node:test');
const assert = require('node:assert');
const ta = require('../lib/team-analytics');
const sa = require('../lib/session-analytics');

function slowAdmin(tables, delayMs, stats) {
  return {
    from(table) {
      const rows = tables[table] || [];
      const f = { in: [], eq: [] };
      const chain = {
        select() { return chain; }, not() { return chain; }, is() { return chain; },
        gte() { return chain; }, lte() { return chain; }, order() { return chain; },
        range() { return chain; }, limit() { return chain; }, maybeSingle() { return chain; },
        in(col, vals) { f.in.push([col, vals]); return chain; },
        eq(col, val) { f.eq.push([col, val]); return chain; },
        then(resolve, reject) {
          stats.total++; stats.inflight++; stats.max = Math.max(stats.max, stats.inflight);
          setTimeout(function () {
            stats.inflight--;
            let out = rows.slice();
            f.in.forEach(([c, v]) => { out = out.filter((r) => v.indexOf(r[c]) !== -1); });
            f.eq.forEach(([c, v]) => { out = out.filter((r) => r[c] === v); });
            resolve({ data: out, error: null });
          }, delayMs);
        },
      };
      return chain;
    },
  };
}

// 150 calls → two 100-row chunks for analyses AND highlights, per window.
const N = 150;
const CALLS = [], ANALYSES = [], HIGHLIGHTS = [];
for (let i = 1; i <= N; i++) {
  const id = 'c' + i;
  CALLS.push({ id: id, user_id: 'A', fathom_call_id: id, call_date: '2026-08-10T10:00:00Z', duration_seconds: 1800, prospect_id: 'p' + i });
  ANALYSES.push({ fathom_call_id: id, status: 'done', analyzed_at: '2026-08-10T12:00:00Z', overall_score: 70,
    outcome: i <= 30 ? 'closed' : 'lost', intro_score: 60, discovery_score: 60, pitch_score: 60, objection_score: 60, close_score: 60 });
  HIGHLIGHTS.push({ fathom_call_id: id, type: 'objection', resolution: i % 2 ? 'handled' : 'unhandled', objection_category: 'fear', objection_class: 'true_objection' });
}
const TABLES = { fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: HIGHLIGHTS, user_profiles: [{ user_id: 'A', first_name: 'A', active: true }], prospects: [] };
const FROM = '2026-08-01T00:00:00.000Z', TO = '2026-08-31T23:59:59.999Z';
const DELAY = 15;

test('⚠⚠ computeTeamAnalytics runs its round trips IN PARALLEL — the warm floor was 12 in sequence', async () => {
  const stats = { total: 0, inflight: 0, max: 0 };
  const t0 = Date.now();
  const out = await ta.computeTeamAnalytics(slowAdmin(TABLES, DELAY, stats), ['A'], FROM, TO, {});
  const ms = Date.now() - t0;
  assert.ok(stats.total >= 10, 'the fixture must exercise many queries, saw ' + stats.total);
  assert.ok(stats.max >= 4, 'peak in-flight must show real parallelism, saw ' + stats.max + ' of ' + stats.total);
  assert.ok(ms < (stats.total * DELAY) / 2, 'wall time ' + ms + 'ms is not far below sequential ' + (stats.total * DELAY) + 'ms');
  const a = out.per_rep.find((r) => r.user_id === 'A');
  assert.strictEqual(a.calls_analyzed, N, 'every analysis counted exactly once across the chunks');
  assert.strictEqual(a.close_wins, 30);
  const seq = await ta.computeTeamAnalytics(slowAdmin(TABLES, 0, { total: 0, inflight: 0, max: 0 }), ['A'], FROM, TO, {});
  assert.deepStrictEqual(out, seq, 'ordering must not change the answer');
});

test('⚠⚠ computeCallAnalytics (the Coaching lead number) runs its round trips IN PARALLEL', async () => {
  const stats = { total: 0, inflight: 0, max: 0 };
  const t0 = Date.now();
  const out = await sa.computeCallAnalytics(slowAdmin(TABLES, DELAY, stats), 'A', FROM, TO);
  const ms = Date.now() - t0;
  assert.ok(stats.total >= 6, 'the fixture must exercise several queries, saw ' + stats.total);
  assert.ok(stats.max >= 3, 'peak in-flight must show real parallelism, saw ' + stats.max + ' of ' + stats.total);
  assert.ok(ms < (stats.total * DELAY) / 2, 'wall time ' + ms + 'ms is not far below sequential ' + (stats.total * DELAY) + 'ms');
  assert.strictEqual(out.calls.analyzed, N);
  const seq = await sa.computeCallAnalytics(slowAdmin(TABLES, 0, { total: 0, inflight: 0, max: 0 }), 'A', FROM, TO);
  assert.deepStrictEqual(out, seq, 'ordering must not change the answer');
});

/* ⚠ THE OBJECTIONS GRID HAD THE SAME FLOOR: /team/objections measured 3.9–4.5s
   warm with the two fixes above live — its own `inChunks` awaited each 100-id
   chunk in turn. Strict classification is off here (no model call); the
   highlights fetch still runs AFTER the analyses fetch because the DQ filter
   between them decides which ids are fetched — so the peak is per family. */
test('⚠⚠ computeTeamObjections fetches each family\'s chunks at once', async () => {
  const to = require('../lib/team-objections');
  const stats = { total: 0, inflight: 0, max: 0 };
  const t0 = Date.now();
  const out = await to.computeTeamObjections(slowAdmin(TABLES, DELAY, stats), ['A'], FROM, TO, { strict: false, keyId: 'A' });
  const ms = Date.now() - t0;
  assert.ok(stats.total >= 5, 'the fixture must exercise several queries, saw ' + stats.total);
  assert.ok(stats.max >= 2, 'peak in-flight must show the chunks running together, saw ' + stats.max + ' of ' + stats.total);
  assert.ok(ms < (stats.total * DELAY) * 0.8, 'wall time ' + ms + 'ms is not below sequential ' + (stats.total * DELAY) + 'ms');
  assert.strictEqual(out.totals.total, N, 'every objection counted once across the chunks');
  const seq = await to.computeTeamObjections(slowAdmin(TABLES, 0, { total: 0, inflight: 0, max: 0 }), ['A'], FROM, TO, { strict: false, keyId: 'A' });
  assert.deepStrictEqual(out, seq, 'ordering must not change the answer');
});
