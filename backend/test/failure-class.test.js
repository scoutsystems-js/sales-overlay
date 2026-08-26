/**
 * ⚠⚠ WHICH FAILED CALLS ARE WORTH PRESSING A BUTTON AT?
 *
 * A count that never reaches zero stops being read. One Zoom call has no
 * transcript at all and will never grade; if it sits inside the retryable count,
 * that number is permanently non-zero and becomes wallpaper.
 *
 * ⚠ THE RULE: PERMANENT means the underlying thing is MISSING OR REJECTED — no
 * transcript exists, the recording is gone (404), the credentials are refused.
 * Pressing retry cannot change any of those. RETRYABLE is everything else,
 * INCLUDING a call that already exhausted its automatic attempts: a person
 * choosing to retry is a different act from an automatic retry, and they get a
 * fresh budget.
 *
 * ⚠ `zoom_no_transcript` is the interesting one and it is NOT decided here on
 * its own — lib/zoom-retry.js already owns that judgement, because "not ready
 * yet" and "was never recorded with transcription" are TEXTUALLY IDENTICAL and
 * only AGE separates them. This reuses that bound rather than inventing a
 * second one that could disagree with it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const FC = require('../lib/failure-class');

const OLD = '2026-08-01T12:00:00Z';   // well past the zoom transcript window
const NEW = new Date(Date.now() - 60 * 60 * 1000).toISOString();  // an hour ago

/* The five real failures on production the day this shipped. */
test('LIVE DATA: a Zoom call with no transcript, long past the window, is PERMANENT', () => {
  const r = 'Zoom transcript fetch failed for meeting LJThQ7HwTwKCVXgdtdbdOg==: zoom_no_transcript: no transcript file for meeting';
  assert.strictEqual(FC.classifyFailure(r, OLD), 'permanent');
});

test('⚠ but the SAME message on a RECENT call is retryable — age is the only difference', () => {
  const r = 'Zoom transcript fetch failed for meeting X: zoom_no_transcript: no transcript file';
  assert.strictEqual(FC.classifyFailure(r, NEW), 'retryable',
    'zoom-retry owns this judgement; a young call may simply not be ready yet');
});

test('LIVE DATA: a Zoom 404 is PERMANENT — the recording is gone', () => {
  assert.strictEqual(FC.classifyFailure('Zoom transcript fetch failed for meeting 0xX66: Zoom API HTTP 404 — {"code":', OLD), 'permanent');
});

test('LIVE DATA: unusable model output is RETRYABLE — proven to parse on a later try', () => {
  const r = 'Section grader returned unparseable JSON: ```json\n{ "intro": {';
  assert.strictEqual(FC.classifyFailure(r, OLD), 'retryable');
  assert.strictEqual(FC.classifyFailure(r, NEW), 'retryable');
});

test('credentials refused is PERMANENT — a retry cannot fix a reconnect', () => {
  ['HTTP 401', 'HTTP 403'].forEach((s) => {
    assert.strictEqual(FC.classifyFailure('Transcript fetch failed for recording_id 1: transcript_fetch_failed: ' + s + ' — ', OLD),
      'permanent', s);
  });
});

test('⚠ AN EXHAUSTED CALL IS STILL RETRYABLE — a person is not an automatic attempt', () => {
  assert.strictEqual(FC.classifyFailure('Anthropic API failure (HTTP 429): rate — temporary but retried 3 times, giving up', OLD), 'retryable');
  assert.strictEqual(FC.classifyFailure('Transcript fetch failed for recording_id 1: transcript_fetch_failed: HTTP 429 —  — temporary but retried 5 times, giving up', OLD), 'retryable');
});

test('a rate limit or a 5xx is retryable', () => {
  assert.strictEqual(FC.classifyFailure('Anthropic API failure (HTTP 429): rate limited', OLD), 'retryable');
  assert.strictEqual(FC.classifyFailure('Anthropic API failure (HTTP 529): overloaded', OLD), 'retryable');
});

test('the explicit permanent marker written by the worker is honoured', () => {
  assert.strictEqual(FC.classifyFailure('Anthropic API failure (HTTP 400): bad — permanent, not retried', OLD), 'permanent');
});

test('⚠ AN UNRECOGNISABLE REASON IS RETRYABLE, NOT PERMANENT', () => {
  /* Failing OPEN here is the safe direction: the cost of offering a retry that
     cannot help is one wasted click, while wrongly calling something permanent
     hides a recoverable call forever. That is the opposite of the retry
     classifiers, and deliberately so — there the cost of guessing wrong is an
     infinite loop, here it is a button press. */
  ['', null, undefined, 'something nobody has seen before'].forEach((r) => {
    assert.strictEqual(FC.classifyFailure(r, OLD), 'retryable', String(r));
  });
});

test('a missing call date does not make something permanent', () => {
  const r = 'Zoom transcript fetch failed: zoom_no_transcript: no transcript file';
  assert.strictEqual(FC.classifyFailure(r, null), 'permanent',
    'with no age, zoom-retry refuses to requeue — so it is not worth a button');
});
