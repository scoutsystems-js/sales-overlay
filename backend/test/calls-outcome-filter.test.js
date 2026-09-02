/**
 * (q) — separating CLOSING from NON-CLOSING calls on the Calls view.
 *
 * ⚠ THE EXISTING OUTCOME, NOT A NEW PREDICATE. A call is closed iff
 * call_analyses.outcome = 'closed'. No second definition is introduced, so this
 * filter can never disagree with the close rate, the gauges, or the EOD report.
 *
 * ⚠ THE THIRD GROUP IS THE POINT. Measured live, 46% of calls have NO analysis
 * row and therefore no outcome. They belong to NEITHER side: folding them into
 * "not closed" would assert a result for a call nobody has graded. The view
 * states the count instead of hiding it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROUTE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the API accepts the two new filters and rejects anything else', () => {
  const at = ROUTE.indexOf('function parseCallListOpts');
  const src = ROUTE.slice(at, ROUTE.indexOf('\n}', at) + 2);
  assert.ok(src.length > 200 && src.length < 3000, 'slice must cover the parser: ' + src.length);
  const fn = new Function('req', src + '; return parseCallListOpts(req);');
  ['closed', 'not_closed', 'analyzed', 'objections'].forEach(function (f) {
    assert.strictEqual(fn({ query: { filter: f } }).filter, f);
  });
  ['won', 'lost', 'CLOSED', '', 'closed;drop', undefined].forEach(function (f) {
    assert.strictEqual(fn({ query: { filter: f } }).filter, null, String(f) + ' must not pass');
  });
});

test('⚠ CLOSED USES outcome = closed — the existing definition, not a new one', () => {
  const at = ROUTE.indexOf("opts.filter === 'closed'");
  const src = ROUTE.slice(at, at + 400);
  assert.ok(/\.eq\('outcome', 'closed'\)/.test(src), 'must key on the stored outcome');
  assert.ok(/\.eq\('status', 'done'\)/.test(src), 'and only on a completed analysis');
});

test('⚠ NOT CLOSED EXCLUDES UNGRADED CALLS, it does not sweep them in', () => {
  const at = ROUTE.indexOf("opts.filter === 'not_closed'");
  const src = ROUTE.slice(at, at + 700);
  assert.ok(/\.not\('outcome', 'is', null\)/.test(src),
    'a call with no outcome must be excluded — asserting a result nobody graded');
  assert.ok(/\.neq\('outcome', 'closed'\)/.test(src));
});

test('the window counts describe the RANGE and carry the ungraded group', () => {
  const at = ROUTE.indexOf('async function windowOutcomeCounts');
  const src = ROUTE.slice(at, ROUTE.indexOf('\n}', at) + 2);
  assert.ok(src.length > 400, 'slice must cover the counter: ' + src.length);
  assert.ok(/ungraded: ids\.length - graded/.test(src), 'ungraded is total minus graded');
  assert.ok(/if \(a\.outcome == null\) return;/.test(src),
    'a graded row with a null outcome counts as neither side');
});

test('⚠ CLEAR TOUCHES THE FILTER ONLY — not the dates, not the rep', () => {
  const at = LIVE.indexOf('function clearCallsFilter');
  assert.ok(at !== -1, 'clearCallsFilter must exist');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(src.length > 100 && src.length < 1200, 'slice must cover it: ' + src.length);
  ['callLibraryRange', 'dateRange', 'viewingUserId', 'setCallLibraryRange'].forEach(function (forbidden) {
    assert.strictEqual(src.indexOf(forbidden), -1,
      'Clear must not touch ' + forbidden + ' — it resets the FILTER only');
  });
  assert.ok(/state\.callLibraryFilter = null/.test(src));
});

test('the control toggles off when the active option is clicked again', () => {
  const at = LIVE.indexOf('function setCallsOutcome');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(/state\.callLibraryFilter === key\) \? null : key/.test(src),
    'clicking the active filter must clear it, so the control is always undoable');
});

test('labels are Title Case and counts render with raw numbers', () => {
  assert.ok(/>Closed</.test(LIVE) || /'Closed'/.test(LIVE));
  assert.ok(/'Not Closed'/.test(LIVE));
  assert.ok(/calls-outcome-n/.test(LIVE), 'each option shows its own count');
  /* The line branches on the role since 2026-09-02: an owner reads "in neither
     group" beside the control; everyone else reads who handles grading. */
  assert.ok(/not graded yet — ' \+ \(gradeAllowed\(\) \? 'in neither group' : gradingHandledByText\(\)\)/.test(LIVE),
    'the ungraded count must be stated, not hidden — and say who handles it');
});
