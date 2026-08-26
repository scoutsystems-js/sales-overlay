'use strict';
/**
 * A TEMPORARY REFUSAL FROM FATHOM MUST NOT PERMANENTLY DESTROY A CALL.
 *
 * Before this, `routes/fathom.js` threw on ANY non-OK response — one attempt, no
 * status inspection, no delay — and the worker called failTranscript(), writing
 * status='error' on both tables. Nothing moves 'error' back to 'pending' (the
 * sync upserts with ignoreDuplicates; no route resets errored rows), so a single
 * HTTP 429 or 502 turned a customer's call into a PERMANENT hole, silently.
 * Observed live: 151 calls on one account destroyed that way in ~3 minutes.
 *
 * ⚠⚠ THIS DELIBERATELY DIVERGES FROM lib/zoom-retry.js, AND THE REASON MATTERS.
 * Zoom bounds by CALL AGE because its two cases are textually identical —
 * "transcript not ready yet" and "transcription was never on" produce the same
 * string, so age is the only discriminator available.
 *
 * Fathom's failures are SELF-DESCRIBING: the HTTP status says whether it is
 * temporary. Age is therefore the WRONG bound here — a 429 on a two-year-old
 * call is exactly as temporary as one on today's, and an age bound would
 * permanently fail old calls on a transient blip, which is the defect itself.
 * The bound is ATTEMPT COUNT (call_analyses.transcript_attempts).
 *
 * ⚠ Everything not positively recognised as temporary is PERMANENT. Retrying an
 * unclassifiable failure forever hides it, which is the failure mode zoom-retry
 * warns about in its own header.
 */

/**
 * 5 attempts. Sized against the incident: Fathom's limit cleared within minutes
 * once concurrency dropped, and at six loops the observed 429 rate was ZERO — so
 * a handful of spaced attempts is ample for a real rate limit, while still
 * bounding a call that is failing for a reason we have misclassified.
 * ⚠ DO NOT RAISE THIS "to be safe". A higher cap does not fix a genuine outage;
 * it just keeps a call in "still analysing" for longer while re-fetching.
 */
var MAX_TRANSCRIPT_ATTEMPTS = 5;

/** Sanity ceiling on a server-supplied Retry-After, so a bad header cannot park a call. */
var MAX_RETRY_AFTER_SECONDS = 300;

/** HTTP statuses that mean "ask again later", not "this will never work". */
var TEMPORARY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

/**
 * 'temporary' | 'permanent' — read off the HTTP status the fetch recorded.
 * ⚠ Fails to 'permanent' on anything unrecognised, including empty input.
 */
function classifyTranscriptFailure(message) {
  if (typeof message !== 'string' || !message) return 'permanent';
  var m = /HTTP (\d{3})/.exec(message);
  if (!m) return 'permanent';           // shape errors (missing array, bad JSON) are real
  var status = parseInt(m[1], 10);
  return TEMPORARY_STATUSES.indexOf(status) !== -1 ? 'temporary' : 'permanent';
}

/**
 * Seconds Fathom asked us to wait, or null. Clamped; a negative or absurd value
 * is not trusted.
 */
function retryAfterSeconds(message) {
  if (typeof message !== 'string' || !message) return null;
  var m = /retry_after=(\d+)/.exec(message);
  if (!m) return null;
  var secs = parseInt(m[1], 10);
  if (!isFinite(secs) || secs <= 0) return null;
  return Math.min(secs, MAX_RETRY_AFTER_SECONDS);
}

/**
 * Requeue this failure rather than erroring it?
 * ⚠ FAILS CLOSED on a missing/unparseable attempt count — without a readable
 * counter there is no bound, and an unbounded retry is what this prevents.
 */
function shouldRequeue(message, attempts) {
  if (classifyTranscriptFailure(message) !== 'temporary') return false;
  if (typeof attempts !== 'number' || !isFinite(attempts) || attempts < 0) return false;
  return attempts < MAX_TRANSCRIPT_ATTEMPTS;
}

module.exports = {
  classifyTranscriptFailure: classifyTranscriptFailure,
  retryAfterSeconds: retryAfterSeconds,
  shouldRequeue: shouldRequeue,
  MAX_TRANSCRIPT_ATTEMPTS: MAX_TRANSCRIPT_ATTEMPTS,
  MAX_RETRY_AFTER_SECONDS: MAX_RETRY_AFTER_SECONDS,
  TEMPORARY_STATUSES: TEMPORARY_STATUSES,
};
