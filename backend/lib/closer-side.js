/**
 * THE CLOSER'S SIDE OF A MOMENT — the sentinels, in one place (v29, 2026-08-28).
 *
 * ⚠⚠ WHY SENTINELS AND NOT null. `closer_response` has to express FOUR distinct
 * states and three of them used to collapse into a single null:
 *
 *   a verbatim span   the closer replied and here are his exact words
 *   __no_reply__      he did NOT reply — the prospect spoke and he moved on.
 *                     A RESULT, not missing data. On a missed_opportunity it is
 *                     often the most coachable fact on the call.
 *   __moment_is_closer__  the moment's own quote is ALREADY the closer speaking,
 *                     so his side is not missing — it is the quote.
 *   null              he did reply and we could not produce an exact span.
 *
 * Collapsing any of these into null is the absent-vs-excluded failure: "he said
 * nothing", "he is the one talking" and "we could not find it" are three
 * different facts that a reader cannot tell apart once they share a value.
 *
 * ⚠ __moment_is_closer__ EXISTS BECAUSE OF MEASURED DATA, not symmetry. Of the
 * five types that never carried a reply, strong_moment is 874 CLOSER-spoken vs
 * 58 PROSPECT and missed_opportunity is a near 50/50 split (463/453). Asking for
 * "the closer's reply" on a moment the closer is already speaking invites the
 * model to reach for some other line of his — which is exactly how a quote ends
 * up attached to the wrong exchange.
 *
 * ⚠⚠ AND THEY MUST NEVER REACH THE QUOTE VERIFIER. `closer_response_verified`
 * runs labelForQuote() over the text; a sentinel cannot reconstruct, so it would
 * be recorded as a REJECTED quote — a real finding filed as a verification
 * failure, and counted in the rejection stats that are used to judge the
 * extractor. isSentinel() is the guard.
 */

const NO_REPLY = '__no_reply__';
const MOMENT_IS_CLOSER = '__moment_is_closer__';
const SENTINELS = [NO_REPLY, MOMENT_IS_CLOSER];

// Total: a non-string, null or anything else is simply not a sentinel.
function isSentinel(v) {
  return typeof v === 'string' && SENTINELS.indexOf(v.trim()) !== -1;
}

module.exports = { NO_REPLY, MOMENT_IS_CLOSER, SENTINELS, isSentinel };
