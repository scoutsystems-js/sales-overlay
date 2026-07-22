// Batch-selection ordering (Justin's scope ruling, 2026-07-22): batches are
// the 20 most-recent calls, not full sweeps — pending still ahead of outdated,
// both newest-first by CALL date (not analyzed_at).
const test = require('node:test');
const assert = require('node:assert');
const fathom = require('../routes/fathom');

test('orderBatchIds: pending block first, each block newest-first by call_date, deduped', () => {
  const dates = { p1: '2026-07-20', p2: '2026-07-22', o1: '2026-07-19', o2: '2026-07-21', o3: '2026-07-18' };
  const out = fathom._orderBatchIds(['p1', 'p2'], ['o1', 'o2', 'o3'], dates);
  // pending newest-first, THEN outdated newest-first — an older pending call
  // still outranks a newer outdated one (pending = explicitly queued work)
  assert.deepStrictEqual(out, ['p2', 'p1', 'o2', 'o1', 'o3']);
});

test('orderBatchIds: ids present in both blocks keep their pending slot only', () => {
  const dates = { a: '2026-07-22', b: '2026-07-21' };
  assert.deepStrictEqual(fathom._orderBatchIds(['a'], ['a', 'b'], dates), ['a', 'b']);
});

test('orderBatchIds: missing dates sort last within their block, never crash', () => {
  const dates = { x: '2026-07-22' };
  assert.deepStrictEqual(fathom._orderBatchIds([], ['nodate', 'x'], dates), ['x', 'nodate']);
});
