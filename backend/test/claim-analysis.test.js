// Tests for the atomic per-call analysis claim (analysis-worker._claimAnalysisRun).
//
// Root cause being guarded (2026-07-22): the three dispatch loops (/sync,
// /reanalyze, /update-analyses) share no lock, so two overlapping dispatches
// could both run analyzeCall for the SAME call — double Claude spend, and the
// non-atomic delete+insert persisted both highlight sets (the Jeremiah
// Thompson Jul 14 duplicate-objections bug). The claim makes analyzeCall a
// single-winner race: one conditional UPDATE (atomic at the row level) or,
// when no call_analyses row exists yet, an INSERT that loses cleanly on the
// fathom_call_id unique index.
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const CALL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER = '11111111-2222-3333-4444-555555555555';
const NOW = '2026-07-22T12:00:00.000Z';

// Minimal fake of the supabase-js chain used by the claim:
//   update(payload).eq(...).or(...).select(...)  and  insert(payload).select(...)
// handlers.update / handlers.insert receive the captured call and return {data, error}.
function fakeAdmin(handlers) {
  const calls = { update: [], insert: [] };
  const admin = {
    from(table) {
      return {
        update(payload) {
          const cap = { table, payload, eq: [], or: [] };
          const chain = {
            eq(col, val) { cap.eq.push([col, val]); return chain; },
            or(expr) { cap.or.push(expr); return chain; },
            select() { calls.update.push(cap); return Promise.resolve(handlers.update(cap)); },
          };
          return chain;
        },
        insert(payload) {
          const cap = { table, payload };
          return {
            select() { calls.insert.push(cap); return Promise.resolve(handlers.insert(cap)); },
          };
        },
      };
    },
  };
  return { admin, calls };
}

test('exports: _claimAnalysisRun and _CLAIM_STALE_MS', () => {
  assert.strictEqual(typeof worker._claimAnalysisRun, 'function');
  assert.strictEqual(typeof worker._CLAIM_STALE_MS, 'number');
  // 10 minutes — sized from real drain data (2026-07: p50 50s, p95 64s, max
  // 247s per call). Must stay comfortably above the longest real analysis.
  assert.strictEqual(worker._CLAIM_STALE_MS, 10 * 60 * 1000);
});

test('claims when the row is not processing (conditional UPDATE wins)', async () => {
  const { admin, calls } = fakeAdmin({
    update: () => ({ data: [{ id: 'row1' }], error: null }),
    insert: () => { throw new Error('insert must not run when update claims'); },
  });
  const got = await worker._claimAnalysisRun(admin, CALL, USER, NOW);
  assert.strictEqual(got, true);

  const u = calls.update[0];
  assert.strictEqual(u.table, 'call_analyses');
  assert.strictEqual(u.payload.status, 'processing');
  // Claim timestamp: analyzed_at doubles as the claim time while processing.
  assert.strictEqual(u.payload.analyzed_at, NOW);
  assert.deepStrictEqual(u.eq, [['fathom_call_id', CALL]]);

  // NULL-discipline (CLAUDE.md: 2nd silent-null bug of 2026-07): the OR filter
  // must explicitly include the NULL branches, and the staleness cutoff must be
  // exactly now - CLAIM_STALE_MS.
  const orExpr = u.or[0];
  const cutoffIso = new Date(new Date(NOW).getTime() - worker._CLAIM_STALE_MS).toISOString();
  assert.ok(orExpr.includes('status.neq.processing'), 'or must claim non-processing rows');
  assert.ok(orExpr.includes('status.is.null'), 'or must claim NULL-status rows');
  assert.ok(orExpr.includes('analyzed_at.is.null'), 'or must reclaim processing rows with no claim stamp');
  assert.ok(orExpr.includes('analyzed_at.lt.' + cutoffIso), 'or must reclaim stale claims at exactly now - window');
});

test('loses quietly when another run holds a fresh claim (UPDATE 0 rows, INSERT conflicts)', async () => {
  const { admin } = fakeAdmin({
    update: () => ({ data: [], error: null }),
    insert: () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
  });
  const got = await worker._claimAnalysisRun(admin, CALL, USER, NOW);
  assert.strictEqual(got, false);
});

test('claims via INSERT when no call_analyses row exists yet (first analysis)', async () => {
  const { admin, calls } = fakeAdmin({
    update: () => ({ data: [], error: null }),
    insert: () => ({ data: [{ id: 'new-row' }], error: null }),
  });
  const got = await worker._claimAnalysisRun(admin, CALL, USER, NOW);
  assert.strictEqual(got, true);
  const ins = calls.insert[0];
  assert.strictEqual(ins.table, 'call_analyses');
  assert.strictEqual(ins.payload.fathom_call_id, CALL);
  assert.strictEqual(ins.payload.user_id, USER);
  assert.strictEqual(ins.payload.status, 'processing');
  assert.strictEqual(ins.payload.analyzed_at, NOW);
});

test('fails closed on a non-conflict INSERT error (not treated as a lost race)', async () => {
  const { admin } = fakeAdmin({
    update: () => ({ data: [], error: null }),
    insert: () => ({ data: null, error: { code: '23503', message: 'foreign key violation' } }),
  });
  const got = await worker._claimAnalysisRun(admin, CALL, USER, NOW);
  assert.strictEqual(got, false);
});

test('fails closed when the claim UPDATE itself errors (call rides the next batch)', async () => {
  const { admin } = fakeAdmin({
    update: () => ({ data: null, error: { message: 'network hiccup' } }),
    insert: () => { throw new Error('insert must not run after update error'); },
  });
  const got = await worker._claimAnalysisRun(admin, CALL, USER, NOW);
  assert.strictEqual(got, false);
});
