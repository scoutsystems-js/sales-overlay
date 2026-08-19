/**
 * ⚠⚠ A ZOOM TRANSCRIPT THAT ISN'T READY YET MUST NOT ERROR THE CALL FOREVER.
 *
 * Zoom finishes the RECORDING first and the TRANSCRIPT minutes later. Our sync
 * runs on a fixed 2-hour cadence with no knowledge of either, so if a sweep
 * lands in that window the fetch returns 3301 "still being processed" — and
 * before this fix the call was marked `error` permanently:
 *
 *   - the sync could not heal it: /zoom/sync upserts with ignoreDuplicates,
 *     so an existing row is never re-inserted or reset;
 *   - and NO route resets 'error' → 'pending', so it was not recoverable by
 *     any user action. Only a manual database write brought it back.
 *
 * Justin's ruling (2026-08-19): build it before Josh's first call. The usual
 * discipline is to watch a defect on real data first, but NON-RECOVERABILITY
 * breaks the symmetry — the normal reason to wait is that a wrong fix is cheap
 * to correct, and here a missed call is permanently lost.
 *
 * ⚠ THE RETRY IS FREE. The transcript fetch happens BEFORE any Claude call, so
 * a requeued call costs one Zoom API request and no model spend.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  isTranscriptPending,
  withinRetryWindow,
  ZOOM_TRANSCRIPT_RETRY_HOURS,
} = require('../lib/zoom-retry');

test('⚠ the two recoverable Zoom failures are recognised — from their REAL text', () => {
  // both strings below are copied verbatim from live rows, not invented
  assert.strictEqual(isTranscriptPending(
    'Zoom transcript fetch failed for meeting 0xX66/gkRM+HFydjA8zu5g==: Zoom API HTTP 404 — '
    + '{"code":3301,"message":"This recording is still being processed. Please check back later."}'),
    true, '3301 = the transcript is coming; retrying is the whole point');

  assert.strictEqual(isTranscriptPending(
    'Zoom transcript fetch failed for meeting h6Q9U1v5RVmkt9nkT6dFsg==: zoom_no_transcript: '
    + 'no transcript file for meeting h6Q9U1v5RVmkt9nkT6dFsg=='),
    true, 'the file list can lag the recording — retry, bounded by age');
});

test('⚠⚠ a NON-recoverable failure still errors — retrying it forever would be worse', () => {
  [
    'Zoom token unavailable for user abc: refresh rejected',
    'Zoom transcript fetch failed for meeting x: Zoom API HTTP 401 — {"code":124,"message":"Invalid access token"}',
    'Zoom transcript fetch failed for meeting x: Zoom API HTTP 403 — {"code":4711,"message":"missing scope"}',
    'Fathom transcript fetch failed',
    '', null, undefined,
  ].forEach(function (msg) {
    assert.strictEqual(isTranscriptPending(msg), false,
      'must NOT be treated as pending: ' + JSON.stringify(msg));
  });
});

/**
 * ⚠ THE BOUND IS WHAT SEPARATES "not ready yet" FROM "will never exist".
 * A call recorded with transcription switched OFF produces zoom_no_transcript
 * forever — identical text, permanent cause. Age is the only signal that
 * distinguishes them, so the window is the safety valve on an otherwise
 * unbounded loop.
 */
test('⚠⚠ the retry window is bounded by CALL AGE, and the bound is 24h', () => {
  assert.strictEqual(ZOOM_TRANSCRIPT_RETRY_HOURS, 24,
    '24h = 12 attempts at the 2-hour cadence; Zoom transcripts land in minutes, '
    + 'so anything still missing after a day is not coming');

  const now = new Date('2026-08-20T12:00:00Z');
  const at = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();

  assert.strictEqual(withinRetryWindow(at(0.1), now), true, 'minutes old — the common case');
  assert.strictEqual(withinRetryWindow(at(23.9), now), true, 'just inside the bound');
  assert.strictEqual(withinRetryWindow(at(24.1), now), false, 'past the bound — error for real');
  assert.strictEqual(withinRetryWindow(at(500), now), false, 'a historical backlog call never loops');
});

test('⚠ a missing or unparseable call_date does NOT open an unbounded retry', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  [null, undefined, '', 'not-a-date'].forEach(function (d) {
    assert.strictEqual(withinRetryWindow(d, now), false,
      'without a date the age cannot be bounded, so fail closed: ' + JSON.stringify(d));
  });
});

test('⚠ a FUTURE call_date is not treated as infinitely young', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const future = new Date(now.getTime() + 72 * 3600 * 1000).toISOString();
  assert.strictEqual(withinRetryWindow(future, now), true,
    'clock skew of a few hours is normal and should still retry');
  const farFuture = new Date(now.getTime() + 400 * 24 * 3600 * 1000).toISOString();
  assert.strictEqual(withinRetryWindow(farFuture, now), false,
    'a wildly future date is bad data, not a young call — fail closed');
});
