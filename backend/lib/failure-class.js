'use strict';
/**
 * ⚠⚠ IS THIS FAILED CALL WORTH PRESSING A BUTTON AT?
 *
 * A count that never reaches zero stops being read. One Zoom call on production
 * has no transcript at all and will never grade; if it sits inside the
 * "retryable" count, that number is permanently non-zero and becomes wallpaper —
 * which is worse than not showing it, because it teaches people to ignore the
 * one place failures are reported.
 *
 * THE RULE: **PERMANENT means the underlying thing is MISSING OR REJECTED** — no
 * transcript exists, the recording is gone (404), the credentials are refused.
 * A retry cannot change any of those. **RETRYABLE is everything else**, including
 * a call that has already exhausted its AUTOMATIC attempts: a person choosing to
 * retry is a different act, and they get a fresh budget.
 *
 * ⚠ THIS FAILS OPEN — an unrecognised reason is RETRYABLE — AND THAT IS THE
 * OPPOSITE OF lib/model-retry.js AND lib/fathom-retry.js ON PURPOSE. Those fail
 * CLOSED because guessing wrong there costs an unbounded automatic loop. Here
 * guessing wrong costs ONE WASTED CLICK, whereas wrongly declaring something
 * permanent hides a recoverable call forever. **The failure direction follows
 * the consequence, not the shape.**
 *
 * ⚠ `zoom_no_transcript` IS NOT DECIDED HERE. lib/zoom-retry.js already owns it,
 * because "not ready yet" and "was never recorded with transcription" are
 * TEXTUALLY IDENTICAL and only AGE separates them. Reusing that bound keeps one
 * judgement in one place; a second rule here could disagree with the worker.
 */

var zoomRetry = require('./zoom-retry');

/** Statuses meaning the thing is gone or we are not allowed to have it. */
var PERMANENT_HTTP = [401, 403, 404, 410];

/**
 * 'permanent' | 'retryable'
 * @param {string} reason      call_analyses.overall_summary on an errored row
 * @param {string} callDate    fathom_calls.call_date — only used for the Zoom window
 */
function classifyFailure(reason, callDate) {
  var r = (typeof reason === 'string') ? reason : '';

  // The worker writes this explicitly when it declined to retry.
  if (/— permanent, not retried/.test(r)) return 'permanent';

  /* ⚠ A Zoom transcript that is merely LATE is retryable; one past the window is
     not. zoom-retry makes that call, not us. */
  if (zoomRetry.isTranscriptPending(r)) {
    return zoomRetry.withinRetryWindow(callDate, new Date()) ? 'retryable' : 'permanent';
  }

  var m = /HTTP (\d{3})/.exec(r);
  if (m && PERMANENT_HTTP.indexOf(parseInt(m[1], 10)) !== -1) return 'permanent';

  /* Everything else — rate limits, 5xx, unusable model output, exhausted
     automatic attempts, and anything unrecognised — is worth one human press. */
  return 'retryable';
}

module.exports = { classifyFailure: classifyFailure, PERMANENT_HTTP: PERMANENT_HTTP };
