/**
 * ⚠⚠ A FAILED CALL MUST BE VISIBLE WITHOUT OPENING IT, AND REACHABLE BY THE
 * BUTTON THAT ALREADY EXISTS.
 *
 * Before this: failed calls were in NO count (they are not 'done'), so the only
 * way to know one existed was to open it and see the red banner — and
 * /fathom/update-analyses could not reach one at all, its batch being
 * pending ∪ outdated. There was no button anywhere that retried a failure.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const ROUTE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
function stripComments(src) {
  const noLine = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}
const LIVE = stripComments(HTML);
const RLIVE = stripComments(ROUTE);

test('the two counts render where the ungraded count already is', () => {
  assert.match(LIVE, /oc\.failed_retryable/, 'retryable count must render');
  assert.match(LIVE, /oc\.failed_permanent/, 'permanent count must render');
  const at = LIVE.indexOf("not graded yet — ' + (gradeAllowed()");   // the line branches on the role since 2026-09-02
  assert.ok(at !== -1, 'stale anchor: the ungraded note moved');
  const after = LIVE.slice(at, at + 900);
  assert.match(after, /failed_retryable/, 'the failed counts belong beside the ungraded one, not elsewhere');
});

test('⚠ THE TWO ARE SPLIT AND WORDED DIFFERENTLY — one is an action, one is a fact', () => {
  assert.match(LIVE, /failed \\u2014 can be retried/, 'the retryable one invites a retry');
  assert.match(LIVE, /cannot be graded/, 'the permanent one states a fact');
  assert.ok(!/failed_permanent[^]{0,120}can be retried/.test(LIVE),
    'a permanent failure must never be described as retryable');
});

test('the permanent one explains itself rather than just being a number', () => {
  /* ⚠ The class name appears in the CSS rule FIRST, so indexOf() lands on the
     stylesheet and finds no title attribute. Anchor on the markup occurrence —
     the one carrying the title — not on the first match. */
  const at = LIVE.indexOf('calls-failed-perm" title=');
  assert.ok(at !== -1, 'the permanent count must carry an explanatory title in the MARKUP');
  assert.match(LIVE.slice(at, at + 300), /Retrying will not help/,
    'a count nobody can act on must say why');
});

test('the API returns both counts', () => {
  assert.match(RLIVE, /failed_retryable: failedRetryable/);
  assert.match(RLIVE, /failed_permanent: failedPermanent/);
});

test('⚠ THE EXISTING CONTROL NOW REACHES RETRYABLE FAILURES — and only those', () => {
  assert.match(RLIVE, /eq\('sync_status', 'error'\)/, 'the batch must look at errored rows');
  const at = RLIVE.indexOf('var failedIds = []');
  assert.ok(at !== -1, 'stale anchor: the failed-id lookup is gone');
  const src = RLIVE.slice(at, at + 1400);
  assert.match(src, /classifyFailure\(/, 'it must classify before including');
  assert.match(src, /!== 'permanent'/, 'and exclude the permanent ones');
  assert.match(RLIVE, /orderBatchIds\(pendingIds2\.concat\(failedIds\)/,
    'failed rows ride with the pending block');
});

test('⚠ NO SECOND CONTROL WAS ADDED', () => {
  const dispatches = (RLIVE.match(/router\.post\('\/update-analyses'/g) || []).length;
  assert.strictEqual(dispatches, 1, 'one dispatch route, not two');
  /* ⚠ Count the MOUNT POINTS, not references to the builder: the builder is also
     named in its own definition and in paintGradeBacklog, so a reference count
     is not a control count. Two hosts = Connections + the Calls page. */
  const hosts = (LIVE.match(/class="grade-backlog-host"/g) || []).length;
  assert.strictEqual(hosts, 2, 'expected exactly the two existing mount points, found ' + hosts);
});

test('⚠ A DELIBERATE HUMAN RETRY CLEARS BOTH ATTEMPT COUNTERS', () => {
  /* Otherwise the click is a no-op: the call fails again immediately with
     "giving up", because its automatic budget was already spent. */
  assert.match(RLIVE, /update\(\{ status: 'pending', transcript_attempts: 0, model_attempts: 0 \}\)/);
});

test('the dry run reports the failed count too, so the cost shown includes them', () => {
  assert.match(RLIVE, /failed: failedIds\.length/);
});
