// pickNewestForAnalysis — the first-sync analysis cap (Justin's ruling 2026-07-31,
// Option B). On any sync, only the NEWEST N newly-synced calls are auto-analyzed;
// the rest sync (sync_status='pending') and wait for the user to backfill via
// Update-analyses. Unbounded auto-analysis would fire hundreds of Claude calls for
// a customer with years of history on connect. Pure — this is the selection logic.
const test = require('node:test');
const assert = require('node:assert');
const fathom = require('../routes/fathom');
const zoomRoute = require('../routes/zoom');
const pick = fathom._pickNewestForAnalysis;
const idsToAnalyze = fathom._callIdsToAnalyze;

test('caps to the newest N by call_date, descending', () => {
  const rows = [
    { id: 'a', call_date: '2026-07-10' },
    { id: 'b', call_date: '2026-07-30' },
    { id: 'c', call_date: '2026-07-20' },
    { id: 'd', call_date: '2026-07-25' },
  ];
  assert.deepStrictEqual(pick(rows, 2), ['b', 'd']);       // two newest
  assert.deepStrictEqual(pick(rows, 3), ['b', 'd', 'c']);  // three newest, in order
});

test('returns all when there are fewer than the cap', () => {
  const rows = [{ id: 'x', call_date: '2026-01-01' }, { id: 'y', call_date: '2026-02-01' }];
  assert.deepStrictEqual(pick(rows, 20), ['y', 'x']);
});

test('exposes the cap constant as 20', () => {
  assert.strictEqual(fathom._FIRST_SYNC_ANALYZE_CAP, 20);
});

test('rows with missing/null call_date sort LAST (analyzed only if room remains)', () => {
  const rows = [
    { id: 'dated', call_date: '2026-07-01' },
    { id: 'nodate', call_date: null },
    { id: 'newer', call_date: '2026-07-15' },
  ];
  assert.deepStrictEqual(pick(rows, 2), ['newer', 'dated']); // the two dated ones win
  assert.deepStrictEqual(pick(rows, 3), ['newer', 'dated', 'nodate']); // nodate last
});

test('does not mutate the input array', () => {
  const rows = [{ id: 'a', call_date: '2026-01-01' }, { id: 'b', call_date: '2026-02-01' }];
  const copy = rows.slice();
  pick(rows, 1);
  assert.deepStrictEqual(rows, copy);
});

test('empty / missing input → empty', () => {
  assert.deepStrictEqual(pick([], 20), []);
  assert.deepStrictEqual(pick(null, 20), []);
  assert.deepStrictEqual(pick(undefined, 20), []);
});

// ── callIdsToAnalyze: the cap is FIRST-SYNC ONLY, not per-run ─────────────────
// The bug this guards against: capping every run would silently leave a busy day's
// calls past #20 ungraded. First sync (no last_sync_at) = backlog on connect → cap.
// Steady-state (last_sync_at set) = only new-since-last-sync calls → grade them ALL.
function rowsN(n) {
  var r = [];
  for (var i = 0; i < n; i++) r.push({ id: 'id-' + i, call_date: '2026-07-' + String(i + 1).padStart(2, '0') });
  return r;
}

test('FIRST sync (no last_sync_at) caps a >20 backlog to the newest 20', () => {
  var out = idsToAnalyze(rowsN(25), null, 20);
  assert.strictEqual(out.length, 20);
  assert.strictEqual(out[0], 'id-24');            // newest first
  assert.ok(out.indexOf('id-0') === -1);          // oldest 5 dropped (backfill later)
});

test('STEADY-STATE (last_sync_at set) analyzes EVERY new call, even past 20', () => {
  var out = idsToAnalyze(rowsN(25), '2026-07-20T00:00:00Z', 20);
  assert.strictEqual(out.length, 25);             // no per-run cap — nothing dropped
  assert.strictEqual(out[0], 'id-24');            // still newest-first ordered
});

test('STEADY-STATE with a small batch returns all of them', () => {
  assert.strictEqual(idsToAnalyze(rowsN(3), '2026-07-20T00:00:00Z', 20).length, 3);
});

test('empty batch → empty regardless of sync state', () => {
  assert.deepStrictEqual(idsToAnalyze([], null, 20), []);
  assert.deepStrictEqual(idsToAnalyze([], '2026-07-20T00:00:00Z', 20), []);
});

test('Zoom reuses the exact same first-sync-only selector', () => {
  assert.strictEqual(zoomRoute._callIdsToAnalyze, fathom._callIdsToAnalyze);
});
