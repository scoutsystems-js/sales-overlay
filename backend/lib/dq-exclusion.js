/**
 * DISQUALIFIED CALLS — one definition of what a DQ mark excludes (2026-08-30).
 *
 * Justin: "when a call is marked as DQ it should count in calls analyzed but
 * not obj handling % or closing %."
 *
 * ⚠⚠ THE ASYMMETRY IS THE WHOLE POINT, AND IT IS WHY THIS IS NOT
 * `not_a_sales_call`. That flag is filtered in ~25 places and removes a call
 * from EVERYTHING, calls-analyzed included. A DQ call is the opposite shape:
 *
 *     COUNTS      calls analyzed, the call list, its own review page, its
 *                 score, its coaching, its moments — the work happened and how
 *                 it was run is still coachable
 *     EXCLUDED    every RATE with a prospect or objection denominator
 *
 * A disqualified prospect was never closeable, so leaving them in either
 * denominator marks a rep down for a call that could not be won. But hiding the
 * call would hide the work, and this project has already ruled that an excluded
 * item must stay visible and flagged rather than disappear.
 *
 * ⚠ IT IS SET BY A HUMAN ONLY. The grader's own VALID_OUTCOMES
 * (lib/analysis-worker.js) is deliberately NOT widened — see migration 056.
 * Whether a prospect was ever winnable turns on things that are not in the
 * transcript; the closer knows, so the closer says.
 */

var DQ_OUTCOME = 'disqualified';

// Is this call disqualified? Takes the call/analysis row, tolerates either
// shape (the outcome may be inlined or nested under an analysis join).
function isDisqualified(row) {
  if (!row) return false;
  var o = row.outcome;
  if (o == null && row.call_analyses) {
    var a = Array.isArray(row.call_analyses) ? row.call_analyses[0] : row.call_analyses;
    o = a && a.outcome;
  }
  return o === DQ_OUTCOME;
}

/**
 * Drop DQ calls from a list feeding a RATE.
 *
 * ⚠ USE THIS ONLY WHERE A RATE IS COMPUTED. Applying it to a count, a list or a
 * backlog would hide the call, which is the behaviour the ruling explicitly
 * rejects — and it would be indistinguishable from the not_a_sales_call
 * exclusion it was written to avoid becoming.
 */
function ratedCallsOnly(rows) {
  return (Array.isArray(rows) ? rows : []).filter(function (r) { return !isDisqualified(r); });
}

module.exports = {
  DQ_OUTCOME: DQ_OUTCOME,
  isDisqualified: isDisqualified,
  ratedCallsOnly: ratedCallsOnly,
};
