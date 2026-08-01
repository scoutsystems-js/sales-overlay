// Coaching tile metrics (TDD): objection handle-rate (true objections only, with
// counts, no-data → null) + avg-score period-over-period trend (no-prior + div-by-zero).
const test = require('node:test');
const assert = require('node:assert');
const { objectionHandleRate, scoreTrend } = require('../lib/tile-metrics');

// ── objectionHandleRate ──────────────────────────────────────────────────────
test('handle rate sums the true-objection buckets → rate + raw counts', () => {
  const nw = { detail: { buckets: [
    { label: 'Price', total: 20, handled: 8 },
    { label: 'Spouse', total: 11, handled: 4 },
  ] } };
  assert.deepStrictEqual(objectionHandleRate(nw), { rate: 39, handled: 12, total: 31 }); // 12/31 = 38.7 → 39
});

test('handle rate → null when there are zero true objections (division guard) → tile shows "—"', () => {
  assert.strictEqual(objectionHandleRate({ detail: { buckets: [] } }), null);
  assert.strictEqual(objectionHandleRate({ detail: { buckets: [{ label: 'x', total: 0, handled: 0 }] } }), null);
});

test('handle rate → null when the classification is not available (loading / error / missing)', () => {
  assert.strictEqual(objectionHandleRate(null), null);
  assert.strictEqual(objectionHandleRate({}), null);           // needsWork present but no detail (still loading)
  assert.strictEqual(objectionHandleRate({ _error: 'boom' }), null);
  assert.strictEqual(objectionHandleRate({ detail: {} }), null); // detail but no buckets array
});

test('handle rate clamps a bad handled>total to 100%, never over', () => {
  const r = objectionHandleRate({ detail: { buckets: [{ total: 5, handled: 9 }] } });
  assert.strictEqual(r.rate, 100);
  assert.strictEqual(r.handled, 5);
});

test('handle rate 100% and 0% render correctly', () => {
  assert.deepStrictEqual(objectionHandleRate({ detail: { buckets: [{ total: 4, handled: 4 }] } }), { rate: 100, handled: 4, total: 4 });
  assert.deepStrictEqual(objectionHandleRate({ detail: { buckets: [{ total: 4, handled: 0 }] } }), { rate: 0, handled: 0, total: 4 });
});

// ── scoreTrend ───────────────────────────────────────────────────────────────
test('trend up: current above prior → up + positive %', () => {
  assert.deepStrictEqual(scoreTrend(66, 60), { dir: 'up', delta_pct: 10 });
});
test('trend down: current below prior → down + negative %', () => {
  assert.deepStrictEqual(scoreTrend(54, 60), { dir: 'down', delta_pct: -10 });
});
test('trend flat: equal → flat + 0% (a REAL 0, prior data exists)', () => {
  assert.deepStrictEqual(scoreTrend(60, 60), { dir: 'flat', delta_pct: 0 });
});
test('NO prior data (null/undefined) → dir null → tile renders with no arrow (not a misleading 0%)', () => {
  assert.deepStrictEqual(scoreTrend(60, null), { dir: null, delta_pct: null });
  assert.deepStrictEqual(scoreTrend(60, undefined), { dir: null, delta_pct: null });
});
test('prior of 0 → division guard → dir null (no arrow, no Infinity/NaN)', () => {
  assert.deepStrictEqual(scoreTrend(60, 0), { dir: null, delta_pct: null });
});
test('current missing (no calls this window) → dir null', () => {
  assert.deepStrictEqual(scoreTrend(null, 60), { dir: null, delta_pct: null });
});
