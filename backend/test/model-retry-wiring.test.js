/**
 * ⚠⚠ FORCE EACH MODEL FAILURE THROUGH THE REAL BRANCHES AND CONFIRM THE CALL
 * RETURNS TO THE QUEUE RATHER THAN STICKING AT `error`.
 *
 * The classifier is unit-tested next door. That proves the RULE. It does not
 * prove the worker USES it — "the component is correct but the thing that
 * reaches it is broken" is the failure this codebase keeps hitting. So this
 * executes the ACTUAL branches out of lib/analysis-worker.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const modelRetry = require('../lib/model-retry');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');

function sliceBetween(startMark, endMark, lo, hi) {
  const at = SRC.indexOf(startMark);
  assert.ok(at !== -1, 'stale anchor: ' + startMark);
  const end = SRC.indexOf(endMark, at + startMark.length);
  assert.ok(end !== -1, 'stale end marker: ' + endMark);
  const src = SRC.slice(at, end);
  assert.ok(src.length > lo && src.length < hi, startMark + ' slice is ' + src.length + ', want ' + lo + '..' + hi);
  return src;
}

/** The API-failure branch, run with a forced SDK error. */
async function runApiBranch(err, attempts) {
  const calls = { requeue: [], fail: [], updates: [] };
  const body = sliceBetween(
    "      var apiStatus = (apiErr && (apiErr.status || apiErr.statusCode)) || '';",
    'await markFathomCallErrored', 600, 4000);
  const fn = new Function(
    'apiErr', 'modelRetry', 'modelAttempts', 'admin', 'fathomCallId',
    'requeueTranscript', 'setAnalysisStatus', 'userId', 'ANALYSIS_PROMPT_VERSION',
    'return (async function () { ' + body + ' })();');
  await fn(err, modelRetry, attempts,
    { from: () => ({ update: (p) => { calls.updates.push(p); return { eq: () => ({}) }; } }) },
    'call-1',
    async (r, why) => { calls.requeue.push({ r, why }); return { status: 'requeued' }; },
    async (_a, _c, _u, st, payload) => { calls.fail.push({ st, payload }); },
    'u1', 'vTest');
  return calls;
}

test('A 429 FROM THE MODEL REQUEUES — it does not stick at error', async () => {
  const c = await runApiBranch(Object.assign(new Error('rate limit'), { status: 429 }), 0);
  assert.strictEqual(c.fail.length, 0, 'a 429 must not error the call');
  assert.strictEqual(c.requeue.length, 1);
  assert.match(c.requeue[0].r, /temporary, requeued \(attempt 1 of 3\)/);
  assert.strictEqual(c.requeue[0].why, 'model failure');
  assert.deepStrictEqual(c.updates, [{ model_attempts: 1 }]);
});

test('529 overloaded and a connection error requeue too', async () => {
  const a = await runApiBranch(Object.assign(new Error('overloaded'), { status: 529 }), 1);
  assert.strictEqual(a.requeue.length, 1);
  assert.match(a.requeue[0].r, /attempt 2 of 3/);
  const b = await runApiBranch(Object.assign(new Error('socket hang up'), { name: 'APIConnectionError' }), 0);
  assert.strictEqual(b.requeue.length, 1, 'a connection error carries no status and must still requeue');
});

test('⚠ A 401 STILL ERRORS — a permanent failure must not be retried away', async () => {
  const c = await runApiBranch(Object.assign(new Error('bad key'), { status: 401 }), 0);
  assert.strictEqual(c.requeue.length, 0);
  assert.strictEqual(c.fail.length, 1);
  assert.match(c.fail[0].payload.overall_summary, /permanent, not retried/);
});

test('⚠ THE BOUND HOLDS, and the row says which kind of giving-up it was', async () => {
  const c = await runApiBranch(Object.assign(new Error('rate limit'), { status: 429 }), modelRetry.MAX_MODEL_ATTEMPTS);
  assert.strictEqual(c.requeue.length, 0);
  assert.match(c.fail[0].payload.overall_summary, /temporary but retried 3 times, giving up/);
});

/** The unparseable-output branch — a 200, so no error object exists. */
async function runUnparseableBranch(attempts) {
  const calls = { requeue: [], fail: [], updates: [] };
  const body = sliceBetween(
    "      var graderReason = 'Section grader returned unparseable JSON: '",
    'await markFathomCallErrored', 500, 4000);
  const fn = new Function(
    'graderText', 'modelRetry', 'modelAttempts', 'admin', 'fathomCallId',
    'requeueTranscript', 'setAnalysisStatus', 'userId',
    'return (async function () { ' + body + ' })();');
  await fn('```json\n{ broken', modelRetry, attempts,
    { from: () => ({ update: (p) => { calls.updates.push(p); return { eq: () => ({}) }; } }) },
    'call-1',
    async (r, why) => { calls.requeue.push({ r, why }); return { status: 'requeued' }; },
    async (_a, _c, _u, st, payload) => { calls.fail.push({ st, payload }); },
    'u1');
  return calls;
}

test('UNUSABLE MODEL OUTPUT REQUEUES — the case the SDK never sees', async () => {
  const c = await runUnparseableBranch(0);
  assert.strictEqual(c.fail.length, 0);
  assert.strictEqual(c.requeue.length, 1);
  assert.match(c.requeue[0].r, /requeued \(attempt 1 of 2\)/);
  assert.strictEqual(c.requeue[0].why, 'unusable model output');
  assert.deepStrictEqual(c.updates, [{ model_attempts: 1 }]);
});

test('⚠ and it gives up SOONER than a transient error does', async () => {
  const c = await runUnparseableBranch(modelRetry.MAX_UNPARSEABLE_ATTEMPTS);
  assert.strictEqual(c.requeue.length, 0);
  assert.match(c.fail[0].payload.overall_summary, /retried 2 times, giving up/);
});

test('a clean run clears BOTH counters', () => {
  const at = SRC.indexOf("status:              'done',");
  assert.ok(at !== -1, 'stale anchor: the success write moved');
  /* ⚠ WIDENED 2026-08-26 — `highlight_error` and its comment now sit between
     the status line and the counters. The window exists to keep the slice near
     the success write, not to encode how long that block may be. */
  const win = SRC.slice(at, at + 1400);
  assert.match(win, /transcript_attempts: 0/);
  assert.match(win, /model_attempts:\s+0/);
});
