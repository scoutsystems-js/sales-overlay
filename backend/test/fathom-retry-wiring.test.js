/**
 * ⚠⚠ FORCE A 429 THROUGH THE REAL BRANCH AND CONFIRM THE CALL GOES BACK TO
 * `pending`, NOT `error`.
 *
 * The classifier is unit-tested in fathom-retry.test.js. That proves the RULE.
 * It does not prove the worker USES it — and "the component is correct but the
 * thing that reaches it is broken" is the failure this codebase has hit
 * repeatedly (a dead call site, a missing select, a no-op parity call).
 *
 * So this executes the ACTUAL catch block out of lib/analysis-worker.js, with
 * only the two writers and the fetch stubbed, and asserts which status is
 * written. A reimplementation of the branch would prove nothing.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const fathomRetry = require('../lib/fathom-retry');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');

/** Pull the real try/catch around the Fathom transcript fetch. */
function branchSource() {
  const start = SRC.indexOf('        transcript = await fathomRoutes._fetchRecordingTranscript(');
  assert.ok(start !== -1, 'stale anchor: the Fathom transcript fetch moved');
  const tryStart = SRC.lastIndexOf('try {', start);
  const end = SRC.indexOf('\n      }', SRC.indexOf('return await failTranscript(reason + why);', start));
  assert.ok(tryStart !== -1 && end > tryStart, 'could not bracket the branch');
  const src = SRC.slice(tryStart, end + '\n      }'.length);
  assert.ok(src.length > 800 && src.length < 4000, 'branch slice is ' + src.length + ' chars — check the anchors');
  assert.ok(src.indexOf('shouldRequeue') !== -1, 'slice does not contain the decision');
  return src;
}

/** Run the real branch with a fetch that throws `err`, at attempt count `attempts`. */
async function runBranch(err, attempts) {
  const calls = { requeue: [], fail: [], updates: [] };
  const admin = {
    from() {
      return { update(payload) { calls.updates.push(payload); return { eq() { return { eq() { return {}; } }; } }; } };
    },
  };
  const fathomRoutes = {
    _fetchRecordingTranscript: async () => { throw err; },
  };
  /* ⚠ EVERY free identifier the branch closes over must be supplied. Omitting
     `accessToken` made the TRY throw a ReferenceError, so every case took the
     permanent branch — and the 404 test PASSED FOR THE WRONG REASON. A harness
     that under-supplies its scope turns a behavioural test into a vacuous one. */
  const fn = new Function(
    'fathomRoutes', 'fathomRetry', 'admin', 'callRow', 'callRow_attempts',
    'fathomCallId', 'accessToken', 'requeueTranscript', 'failTranscript',
    'return (async function () { var transcript; ' + branchSource() + ' })();'
  );
  await fn(
    fathomRoutes, fathomRetry, admin,
    { fathom_call_id: 'rec-1' }, attempts, 'call-1', 'tok',
    async (r) => { calls.requeue.push(r); return { status: 'pending' }; },
    async (r) => { calls.fail.push(r); return { status: 'error' }; }
  );
  return calls;
}

test('the harness supplies the whole scope — a stub error must not masquerade as a verdict', async () => {
  const c = await runBranch(new Error('transcript_fetch_failed: HTTP 429 — '), 0);
  const seen = (c.requeue[0] || c.fail[0] || '');
  assert.ok(!/is not defined/.test(seen),
    'a ReferenceError inside the try would be caught and classified as permanent: ' + seen);
});

test('A 429 REQUEUES — the call returns to pending, not error', async () => {
  const c = await runBranch(new Error('transcript_fetch_failed: HTTP 429 — '), 0);
  assert.strictEqual(c.fail.length, 0, 'a 429 must NOT mark the call errored');
  assert.strictEqual(c.requeue.length, 1, 'it must requeue');
  assert.match(c.requeue[0], /temporary, requeued \(attempt 1 of 5\)/);
  assert.deepStrictEqual(c.updates, [{ transcript_attempts: 1 }], 'and count the attempt');
});

test('a 502 requeues too', async () => {
  const c = await runBranch(new Error('transcript_fetch_failed: HTTP 502 — bad gateway'), 2);
  assert.strictEqual(c.fail.length, 0);
  assert.match(c.requeue[0], /attempt 3 of 5/);
});

test('Retry-After is surfaced in the recorded reason', async () => {
  const c = await runBranch(new Error('transcript_fetch_failed: HTTP 429 —  retry_after=30'), 0);
  assert.match(c.requeue[0], /Fathom asked for 30s/);
});

test('⚠ A 404 STILL FAILS — permanent failures must not be retried away', async () => {
  const c = await runBranch(new Error('transcript_fetch_failed: HTTP 404 — gone'), 0);
  assert.strictEqual(c.requeue.length, 0, 'a 404 must not requeue');
  assert.strictEqual(c.fail.length, 1);
  assert.match(c.fail[0], /permanent, not retried/);
});

test('⚠ THE BOUND HOLDS — a 429 past the cap fails, and says why', async () => {
  const c = await runBranch(new Error('transcript_fetch_failed: HTTP 429 — '), fathomRetry.MAX_TRANSCRIPT_ATTEMPTS);
  assert.strictEqual(c.requeue.length, 0, 'it must stop requeueing at the cap');
  assert.strictEqual(c.fail.length, 1);
  assert.match(c.fail[0], /temporary but retried 5 times, giving up/);
});

test('the reason always names the recording, so a stuck call is legible', async () => {
  const a = await runBranch(new Error('transcript_fetch_failed: HTTP 429 — '), 0);
  const b = await runBranch(new Error('transcript_fetch_failed: HTTP 404 — '), 0);
  assert.match(a.requeue[0], /recording_id rec-1/);
  assert.match(b.fail[0], /recording_id rec-1/);
});
