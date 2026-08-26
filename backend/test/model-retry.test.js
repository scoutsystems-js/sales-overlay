/**
 * ⚠⚠ A MODEL-CALL FAILURE MUST NOT PERMANENTLY UNGRADE A CALL.
 *
 * `582acbb` fixed this for the Fathom TRANSCRIPT fetch. The MODEL call did not
 * inherit it: once the SDK's own retries are exhausted, the worker writes
 * status='error' and NOTHING moves that row back to 'pending' — not the sync
 * (which upserts), not /fathom/update-analyses (whose batch is
 * sync_status='pending' ∪ status='done', and an errored row is in neither).
 *
 * ⚠ WHY THIS IS NOT lib/fathom-retry.js REUSED VERBATIM, stated rather than
 * assumed: fathom-retry PARSES an HTTP status out of a message string, because
 * Fathom's raw fetch threw a plain Error carrying only text. The Anthropic SDK
 * throws a structured error with `.status` on it. Parsing our own formatted
 * reason string back out, when the structured value is right there, would be
 * strictly more fragile. Same SHAPE — classify, bound, requeue — different
 * input, so it is a sibling module rather than a second copy of one function.
 *
 * ⚠ THE UNPARSEABLE-OUTPUT CASE IS A 200. The SDK never sees it, so it needs its
 * own branch — and it is the one most worth retrying: measured today, the same
 * call failed on it in production and parsed cleanly hours later, and a live
 * error count fell 2→1 when a loop re-claimed one and it succeeded. It is
 * length-CORRELATED, not length-determined.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const MR = require('../lib/model-retry');

const apiErr = (status) => Object.assign(new Error('boom'), { status: status });

test('THE LIVE RISK: a 429 from the model is temporary', () => {
  assert.strictEqual(MR.classifyModelFailure(apiErr(429)), 'temporary');
  assert.strictEqual(MR.shouldRetryModel(apiErr(429), 0), true);
});

test('529 overloaded and the 5xx family are temporary', () => {
  [500, 502, 503, 504, 529].forEach((s) => {
    assert.strictEqual(MR.classifyModelFailure(apiErr(s)), 'temporary', String(s));
  });
});

test('a connection error or timeout with NO status is temporary', () => {
  /* The SDK throws APIConnectionError / APIConnectionTimeoutError, which carry
     no HTTP status. Treating "no status" as permanent would make every network
     blip a permanent hole — the exact defect this exists to remove. */
  assert.strictEqual(MR.classifyModelFailure(Object.assign(new Error('socket hang up'), { name: 'APIConnectionError' })), 'temporary');
  assert.strictEqual(MR.classifyModelFailure(Object.assign(new Error('timed out'), { name: 'APIConnectionTimeoutError' })), 'temporary');
});

test('⚠ A BAD REQUEST OR AUTH FAILURE IS PERMANENT — retrying those forever hides them', () => {
  [400, 401, 403, 404, 422].forEach((s) => {
    assert.strictEqual(MR.classifyModelFailure(apiErr(s)), 'permanent', String(s));
    assert.strictEqual(MR.shouldRetryModel(apiErr(s), 0), false, String(s));
  });
});

test('⚠ IT IS BOUNDED', () => {
  for (let a = 0; a < MR.MAX_MODEL_ATTEMPTS; a++) {
    assert.strictEqual(MR.shouldRetryModel(apiErr(429), a), true, 'attempt ' + a);
  }
  assert.strictEqual(MR.shouldRetryModel(apiErr(429), MR.MAX_MODEL_ATTEMPTS), false);
  assert.strictEqual(MR.shouldRetryModel(apiErr(429), MR.MAX_MODEL_ATTEMPTS + 3), false);
});

test('an unreadable attempt count fails CLOSED, not open', () => {
  [null, undefined, 'x', -1].forEach((a) => {
    assert.strictEqual(MR.shouldRetryModel(apiErr(429), a), false, String(a));
  });
});

test('UNPARSEABLE OUTPUT retries on its own branch — it is a 200, not an error', () => {
  assert.strictEqual(MR.shouldRetryUnparseable(0), true);
  for (let a = 0; a < MR.MAX_UNPARSEABLE_ATTEMPTS; a++) {
    assert.strictEqual(MR.shouldRetryUnparseable(a), true, 'attempt ' + a);
  }
  assert.strictEqual(MR.shouldRetryUnparseable(MR.MAX_UNPARSEABLE_ATTEMPTS), false,
    'bounded — a call that truly cannot be graded must stop, not loop');
  assert.strictEqual(MR.shouldRetryUnparseable(null), false, 'fails closed');
});

test('the unparseable bound is SMALLER than the transient one, deliberately', () => {
  /* A 429 clears on its own; unusable output is length-correlated, so the same
     call is likelier to fail again. Fewer attempts before giving up. */
  assert.ok(MR.MAX_UNPARSEABLE_ATTEMPTS < MR.MAX_MODEL_ATTEMPTS);
});

test('a null / undefined error is permanent — never retry what you cannot classify', () => {
  [null, undefined, {}].forEach((e) => {
    assert.strictEqual(MR.classifyModelFailure(e), 'permanent', String(JSON.stringify(e)));
  });
});
