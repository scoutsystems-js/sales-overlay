/**
 * WHEN A ZOOM TRANSCRIPT ISN'T READY YET, REQUEUE — DON'T ERROR.
 *
 * Zoom finishes the RECORDING first and the TRANSCRIPT minutes later. The sync
 * runs on a fixed 2-hour cadence and knows about neither, so a sweep landing in
 * that window used to mark the call `error` PERMANENTLY:
 *   - /zoom/sync upserts with ignoreDuplicates, so a later sweep never resets it;
 *   - and no route moves 'error' → 'pending', so no user action could retry it.
 * A call lost that way was lost for good. That non-recoverability is why this
 * shipped ahead of seeing it on real traffic (Justin, 2026-08-19).
 *
 * ⚠ THE RETRY IS FREE. The transcript fetch runs BEFORE any Claude call, so a
 * requeued call costs one Zoom API request and no model spend.
 *
 * ⚠ AND THE BOUND IS LOAD-BEARING, because the two cases are TEXTUALLY
 * IDENTICAL: a call recorded with transcription switched OFF reports
 * `zoom_no_transcript` forever, exactly like one whose file list is merely
 * lagging. Nothing in the message distinguishes "not ready yet" from "will
 * never exist" — only AGE does. Without the window this is an unbounded loop.
 */

/**
 * 24h = 12 attempts at the 2-hour sync cadence. Zoom transcripts land within
 * minutes, so anything still absent after a day is not coming.
 *
 * ⚠⚠ DO NOT RAISE THIS TO "BE SAFE". IT IS NOT A TIMEOUT, IT IS THE ONLY THING
 * SEPARATING TWO CASES THAT ARE TEXTUALLY IDENTICAL.
 *   transcript still processing  → zoom_no_transcript / 3301 → resolves in minutes
 *   transcription was never ON   → zoom_no_transcript        → NEVER resolves
 * The messages are the same string. Nothing in the payload distinguishes them.
 * So this bound is not "how long to be patient" — it is the entire mechanism by
 * which a retry worth making is told apart from an infinite one.
 *
 * Raising it does not buy safety; it buys a longer silent loop on calls whose
 * transcript does not exist, each one re-fetching on every sweep forever-ish and
 * showing the user "still analysing" the whole time. If a real transcript is
 * ever observed arriving later than 24h, RAISE IT FOR THAT EVIDENCE and say so
 * here — not on the intuition that a bigger number is more forgiving.
 */
const ZOOM_TRANSCRIPT_RETRY_HOURS = 24;

// A future call_date is normal clock skew up to a point; beyond it the row is
// bad data rather than a young call, and must not buy an unbounded retry.
const MAX_FUTURE_SKEW_HOURS = 24 * 7;

/**
 * Is this failure the transcript simply not being available YET?
 * Matched on the two signatures produced by lib/zoom-client.js:
 *   - Zoom API code 3301, "This recording is still being processed"
 *   - our own 'zoom_no_transcript' when the file list holds no transcript
 * ⚠ Everything else — bad token, missing scope, revoked grant — is a real
 * failure and must keep erroring. Retrying those forever hides them.
 */
function isTranscriptPending(message) {
  if (typeof message !== 'string' || !message) return false;
  if (message.indexOf('zoom_no_transcript') !== -1) return true;
  if (/\bcode"?\s*:?\s*3301\b/.test(message)) return true;
  if (/still being processed/i.test(message)) return true;
  return false;
}

/**
 * Is the call young enough to be worth another look?
 * ⚠ FAILS CLOSED on a missing or unparseable date — without an age there is no
 * bound, and an unbounded retry is the thing this function exists to prevent.
 */
function withinRetryWindow(callDate, now, hours) {
  var limit = typeof hours === 'number' ? hours : ZOOM_TRANSCRIPT_RETRY_HOURS;
  if (!callDate) return false;
  var t = new Date(callDate).getTime();
  if (!isFinite(t)) return false;
  var ref = (now instanceof Date ? now.getTime() : Date.now());
  var ageHours = (ref - t) / 3600000;
  if (ageHours < 0) return -ageHours <= MAX_FUTURE_SKEW_HOURS;  // clock skew, bounded
  return ageHours <= limit;
}

/** Should this failed Zoom transcript fetch be requeued rather than errored? */
function shouldRequeue(message, callDate, now) {
  return isTranscriptPending(message) && withinRetryWindow(callDate, now);
}

module.exports = {
  isTranscriptPending: isTranscriptPending,
  withinRetryWindow: withinRetryWindow,
  shouldRequeue: shouldRequeue,
  ZOOM_TRANSCRIPT_RETRY_HOURS: ZOOM_TRANSCRIPT_RETRY_HOURS,
};
