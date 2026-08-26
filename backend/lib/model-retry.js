'use strict';
/**
 * A MODEL-CALL FAILURE MUST NOT PERMANENTLY UNGRADE A CALL.
 *
 * `582acbb` fixed this for the Fathom TRANSCRIPT fetch. The MODEL call did not
 * inherit it: once the Anthropic SDK's own retries are exhausted, the worker
 * writes status='error' and NOTHING moves that row back to 'pending' — the sync
 * upserts, and /fathom/update-analyses batches `sync_status='pending'` ∪
 * `status='done'`, so an errored row is in neither set and no control can reach
 * it. Tonight's 153 only cleared because they were flipped in SQL by hand.
 *
 * ⚠⚠ THE SDK ALREADY RETRIES, AND THIS SITS ON TOP OF THAT — NOT INSTEAD OF IT.
 * @anthropic-ai/sdk 0.27.3 defaults to maxRetries 2 with exponential backoff,
 * honouring retry-after, for 408/409/429/5xx and connection errors. So by the
 * time an error reaches us the API has ALREADY been asked three times. This
 * layer exists for the case that survives that: a sustained burst rather than a
 * blip. Do not "add backoff" here — it is already there, one level down.
 *
 * ⚠ WHY THIS IS A SIBLING OF lib/fathom-retry.js RATHER THAN A REUSE OF IT.
 * fathom-retry PARSES an HTTP status out of a message string, because Fathom's
 * raw fetch threw a plain Error carrying only text. The SDK throws a STRUCTURED
 * error with `.status`. Parsing our own formatted reason string back out, when
 * the structured value is right there, would be strictly more fragile. Same
 * shape — classify, bound, requeue — different input.
 */

/**
 * 3 attempts. The SDK has already retried 3× per attempt, so this is 9 requests
 * before a call is abandoned. ⚠ Do not raise it: past this the failure is not a
 * blip, and more attempts only keep the call showing "still analysing" while
 * costing input tokens each time.
 */
var MAX_MODEL_ATTEMPTS = 3;

/**
 * 2 attempts for unusable output — DELIBERATELY FEWER than for a transient API
 * error. A 429 clears on its own; unparseable output is length-CORRELATED, so
 * the same call is likelier to fail again and each attempt costs a full
 * transcript. Measured today: it is not deterministic (a call that failed in
 * production parsed cleanly hours later), so retrying is worth it — twice.
 */
var MAX_UNPARSEABLE_ATTEMPTS = 2;

/** Statuses that will not improve on their own. Everything else with a status
 *  is treated as temporary — including 5xx and 529 overloaded. */
var PERMANENT_STATUSES = [400, 401, 403, 404, 405, 413, 422];

/**
 * 'temporary' | 'permanent', from the SDK error's structured status.
 * ⚠ A missing status means a CONNECTION or TIMEOUT error (APIConnectionError /
 * APIConnectionTimeoutError carry none), which is temporary. But a null/absent
 * error object is not classifiable at all and must be permanent — never retry
 * what you cannot identify.
 */
function classifyModelFailure(err) {
  if (!err || typeof err !== 'object') return 'permanent';
  var status = err.status || err.statusCode;
  if (typeof status === 'number') {
    return PERMANENT_STATUSES.indexOf(status) !== -1 ? 'permanent' : 'temporary';
  }
  // No status: a connection/timeout error carries a recognisable name or message.
  var name = String(err.name || '');
  if (/APIConnection|Timeout|AbortError/i.test(name)) return 'temporary';
  if (/socket|ECONN|ETIMEDOUT|EAI_AGAIN|network|timed out/i.test(String(err.message || ''))) return 'temporary';
  return 'permanent';
}

function usableAttempts(attempts) {
  return (typeof attempts === 'number' && isFinite(attempts) && attempts >= 0) ? attempts : null;
}

/** Requeue this model failure rather than erroring it? Fails CLOSED on an
 *  unreadable counter — without a bound there is no bound. */
function shouldRetryModel(err, attempts) {
  if (classifyModelFailure(err) !== 'temporary') return false;
  var a = usableAttempts(attempts);
  return a !== null && a < MAX_MODEL_ATTEMPTS;
}

/** The 200-with-unusable-output case. No error object exists, so it is bounded
 *  on the counter alone. */
function shouldRetryUnparseable(attempts) {
  var a = usableAttempts(attempts);
  return a !== null && a < MAX_UNPARSEABLE_ATTEMPTS;
}

module.exports = {
  classifyModelFailure: classifyModelFailure,
  shouldRetryModel: shouldRetryModel,
  shouldRetryUnparseable: shouldRetryUnparseable,
  MAX_MODEL_ATTEMPTS: MAX_MODEL_ATTEMPTS,
  MAX_UNPARSEABLE_ATTEMPTS: MAX_UNPARSEABLE_ATTEMPTS,
  PERMANENT_STATUSES: PERMANENT_STATUSES,
};
