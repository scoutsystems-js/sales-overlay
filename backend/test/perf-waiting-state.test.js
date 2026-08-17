/**
 * Bug 2 — Performance Summary is genuinely slow, and the honest fix.
 *
 * MEASURED, not assumed: a cache MISS is ~35 s of which ~97% is the model
 * generating; a cache HIT is under a second. The slow path is irreducible — it IS
 * the model call — so the fix is to say so, not to pretend otherwise.
 *
 * ⚠ BUT THE COPY IS TIME-GATED. Showing "this will take a minute" on a
 * sub-second cached load would be a lie in the other direction, and would train
 * people to ignore it. It appears only once the wait has actually been long.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// ⚠ fromIndex on BOTH markers, plus a length assertion — see the standing rule.
function slice(startMarker, endMarker, min, max) {
  const at = HTML.indexOf(startMarker);
  assert.notStrictEqual(at, -1, 'start marker missing: ' + startMarker);
  const out = HTML.slice(at, HTML.indexOf(endMarker, at));
  assert.ok(out.length > min && out.length < max, 'slice must cover the target: ' + out.length);
  return out;
}

test("Josh's copy is present, verbatim", () => {
  assert.ok(HTML.indexOf('This will take a minute — go touch some grass') !== -1);
});

test('the long-wait copy is GATED — a fast load never shows it', () => {
  const fn = slice('function renderPerfSummary', 'var work =', 100, 1500);
  assert.ok(/state\.perfWaitLong/.test(fn), 'the copy must be conditional');
  assert.ok(/Generating performance summary/.test(fn), 'and the short-wait copy must survive');
  // The condition, not just the strings: the grass copy sits on the true branch.
  const idxFlag = fn.indexOf('perfWaitLong');
  const idxGrass = fn.indexOf('touch some grass');
  const idxShort = fn.indexOf('Generating performance summary');
  assert.ok(idxFlag < idxGrass && idxGrass < idxShort, 'grass copy on the true branch, default after');
});

test('the gate is ~2 s — long enough that the cached path never flashes it', () => {
  const m = HTML.match(/var PERF_LONG_WAIT_MS = (\d+)/);
  assert.ok(m, 'the threshold must be a named constant');
  const v = Number(m[1]);
  assert.ok(v >= 1500 && v <= 3000, 'measured cache hits are ~0.8 s; got ' + v);
});

test('the timer is CLEARED when the load finishes, and on a re-entry', () => {
  // Otherwise a fast load followed by a slow one, or two loads in a row, leaves
  // a stale timer that flips the copy on after the content has already arrived.
  const fn = slice('async function loadPerfSynthesis', 'function perfInsightHtml', 300, 3000);
  assert.strictEqual((fn.match(/clearTimeout\(perfWaitTimer\)/g) || []).length, 2,
    'cleared on entry AND on completion');
  assert.ok(/state\.perfWaitLong = false/.test(fn), 'and the flag reset');
});

test('the timer does not fire after the load already completed', () => {
  const fn = slice('async function loadPerfSynthesis', 'function perfInsightHtml', 300, 3000);
  assert.ok(/if \(!state\.perfSynthesisLoading\) return;/.test(fn),
    'the callback must re-check that we are still waiting');
});

// ── the backend half: two-phase load around the cache check ───────────────

test('the cache KEY is built from two columns; the eleven load only on a MISS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'performance-synthesis.js'), 'utf8');
  const keyAt = src.indexOf("inChunks('call_analyses', 'fathom_call_id, analyzed_at'");
  const cacheAt = src.indexOf('cacheQ');
  const fullAt = src.indexOf("'fathom_call_id, analyzed_at, status, outcome");
  assert.notStrictEqual(keyAt, -1, 'the light key select must exist');
  assert.notStrictEqual(fullAt, -1, 'the full select must still exist');
  assert.ok(keyAt < cacheAt, 'the key columns are fetched before the cache check');
  assert.ok(cacheAt < fullAt, 'and the ELEVEN columns only after it misses');
});

test('the hash is computed from the key rows, so the cache key is unchanged', () => {
  // The split must not alter what the key means — only when the data is loaded.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'performance-synthesis.js'), 'utf8');
  assert.ok(/hashInput = keyRows\.map/.test(src));
  assert.ok(/\|\|kb:' \+ selling\.kbHash/.test(src), 'and still folds in the KB hash');
});
