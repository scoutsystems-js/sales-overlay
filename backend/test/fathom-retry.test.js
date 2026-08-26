/**
 * ⚠⚠ A TEMPORARY REFUSAL FROM FATHOM MUST NOT PERMANENTLY DESTROY A CALL.
 *
 * `routes/fathom.js` threw on ANY non-OK response — one attempt, no status
 * inspection, no delay — and `analysis-worker.js` called failTranscript(), which
 * writes status='error' on both tables. Nothing moves 'error' back to 'pending':
 * the sync upserts with ignoreDuplicates and no route resets errored rows. So a
 * single HTTP 429 or 502 turned a customer's call into a permanent hole, with no
 * error surfaced to them and nothing retrying it.
 *
 * Observed live: 151 calls on one account destroyed this way in ~3 minutes.
 *
 * ⚠⚠ WHY THIS DIVERGES FROM lib/zoom-retry.js, DELIBERATELY.
 * Zoom bounds its retry by CALL AGE, because "transcript not ready yet" and
 * "transcription was never on" are TEXTUALLY IDENTICAL — age is the only thing
 * that separates them.
 *
 * Fathom's failures are SELF-DESCRIBING: the HTTP status says whether it is
 * temporary. Age is therefore the WRONG bound here — a 429 on a two-year-old
 * call is exactly as temporary as one on today's, and an age bound would
 * permanently fail old calls on a transient blip, which IS the defect. The bound
 * is ATTEMPT COUNT instead.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const FR = require('../lib/fathom-retry');

test('THE LIVE FAILURE: a 429 is temporary and requeues', () => {
  const msg = 'transcript_fetch_failed: HTTP 429 — ';
  assert.strictEqual(FR.classifyTranscriptFailure(msg), 'temporary');
  assert.strictEqual(FR.shouldRequeue(msg, 0), true);
});

test('5xx is temporary too — a bad gateway is not a missing transcript', () => {
  ['HTTP 500', 'HTTP 502', 'HTTP 503', 'HTTP 504'].forEach((s) => {
    const m = 'transcript_fetch_failed: ' + s + ' — upstream';
    assert.strictEqual(FR.classifyTranscriptFailure(m), 'temporary', s);
  });
});

test('408 and 425 are temporary; 4xx generally is not', () => {
  assert.strictEqual(FR.classifyTranscriptFailure('transcript_fetch_failed: HTTP 408 — '), 'temporary');
  assert.strictEqual(FR.classifyTranscriptFailure('transcript_fetch_failed: HTTP 425 — '), 'temporary');
  assert.strictEqual(FR.classifyTranscriptFailure('transcript_fetch_failed: HTTP 400 — '), 'permanent');
});

test('⚠ PERMANENT FAILURES STILL FAIL — retrying those forever hides them', () => {
  [
    'transcript_fetch_failed: HTTP 404 — not found',
    'transcript_fetch_failed: HTTP 401 — bad token',
    'transcript_fetch_failed: HTTP 403 — missing scope',
    'transcript_fetch_failed: response missing transcript array',
    'transcript_fetch_failed: invalid JSON response',
  ].forEach((m) => {
    assert.strictEqual(FR.classifyTranscriptFailure(m), 'permanent', m);
    assert.strictEqual(FR.shouldRequeue(m, 0), false, m);
  });
});

test('⚠ IT IS BOUNDED — a call cannot requeue forever', () => {
  const msg = 'transcript_fetch_failed: HTTP 429 — ';
  for (let a = 0; a < FR.MAX_TRANSCRIPT_ATTEMPTS; a++) {
    assert.strictEqual(FR.shouldRequeue(msg, a), true, 'attempt ' + a + ' should still retry');
  }
  assert.strictEqual(FR.shouldRequeue(msg, FR.MAX_TRANSCRIPT_ATTEMPTS), false,
    'past the cap it must fail permanently, with the reason recorded');
  assert.strictEqual(FR.shouldRequeue(msg, FR.MAX_TRANSCRIPT_ATTEMPTS + 5), false);
});

test('a missing or malformed attempt count is treated as spent, not as zero', () => {
  const msg = 'transcript_fetch_failed: HTTP 429 — ';
  // ⚠ fail CLOSED: an unreadable counter must not buy an unbounded retry.
  assert.strictEqual(FR.shouldRequeue(msg, null), false);
  assert.strictEqual(FR.shouldRequeue(msg, undefined), false);
  assert.strictEqual(FR.shouldRequeue(msg, 'x'), false);
  assert.strictEqual(FR.shouldRequeue(msg, -1), false);
});

test('unknown / empty messages are permanent — never retry what you cannot classify', () => {
  ['', null, undefined, 'something else entirely'].forEach((m) => {
    assert.strictEqual(FR.classifyTranscriptFailure(m), 'permanent', String(m));
  });
});

test('Retry-After is parsed when Fathom sends one', () => {
  assert.strictEqual(FR.retryAfterSeconds('transcript_fetch_failed: HTTP 429 — retry_after=30'), 30);
  assert.strictEqual(FR.retryAfterSeconds('transcript_fetch_failed: HTTP 429 — '), null);
  // absurd values are clamped rather than trusted
  assert.strictEqual(FR.retryAfterSeconds('HTTP 429 — retry_after=99999'), FR.MAX_RETRY_AFTER_SECONDS);
  assert.strictEqual(FR.retryAfterSeconds('HTTP 429 — retry_after=-5'), null);
});
