/* WHY DID THE HIGHLIGHT EXTRACTION PRODUCE NOTHING?
 *
 * ⚠⚠ THIS EXISTS BECAUSE THE ANSWER WAS UNRECOVERABLE. A highlight failure is
 * NON-FATAL by design — the grades still ship — so its only trace was a
 * `console.warn` carrying no reason and no snippet, in a log that does not
 * survive a restart. What reached the database was a perfectly normal graded
 * call with an empty highlight list and nothing anywhere saying what happened.
 *
 * That is what made the long-Zoom defect undiagnosable: 7 of 9 long Zoom calls
 * had zero highlights, and the mechanism could not be established from stored
 * data at all — it had to be inferred from a version/source cross-tab days
 * later. The cause was the raw-control-character JSON defect (fixed in
 * f4d3832); nothing in the row could have said so.
 *
 * ⚠ FOUR OUTCOMES, KEPT APART BECAUSE THEY MEAN DIFFERENT THINGS:
 *   null            the extraction worked — NOT an error
 *   'empty_response' the model returned no content block at all
 *   'unparseable'   content came back and JSON.parse could not read it
 *   'no_moments'    it parsed CLEANLY and the model chose to emit none
 *
 * ⚠⚠ `no_moments` IS NOT A FAILURE AND MUST NOT READ AS ONE. A short or
 * one-sided call legitimately has nothing worth flagging. Folding it in with
 * the parse failures is the absent-vs-excluded collapse this codebase keeps
 * paying for: it would make a healthy call look broken and put a number in
 * front of someone that never reaches zero.
 */

// How much of the model's own output to keep. Enough to SEE the defect — a raw
// newline, a truncated tail, a refusal — without storing a whole transcript.
var SNIPPET = 300;

function describeHighlightFailure(opts) {
  opts = opts || {};
  var text = opts.text;
  var parsed = opts.parsed;
  var count = opts.count;
  var stopReason = opts.stopReason || null;

  // Parsed and produced moments — nothing to record.
  if (parsed && count > 0) return null;

  // ⚠ ORDER MATTERS: check for NO CONTENT before NO PARSE. An empty string
  // fails to parse too, and reporting it as 'unparseable' would send someone
  // looking at the model's output when there was none.
  if (!text) {
    return 'empty_response: the model returned no content'
      + (stopReason ? ' (stop_reason=' + stopReason + ')' : '');
  }

  if (!parsed) {
    /* ⚠ THE SNIPPET IS THE WHOLE POINT — a bare "unparseable" is what we had
       before and it answered nothing. Include the stop_reason so truncation
       (max_tokens) is distinguishable from malformed content at a glance:
       they look identical in the output and have different fixes. */
    return 'unparseable: JSON.parse could not read the response'
      + (stopReason ? ' (stop_reason=' + stopReason + ')' : '')
      + ' — first ' + SNIPPET + ' chars: ' + String(text).slice(0, SNIPPET);
  }

  // Parsed cleanly, zero moments. A statement about the CALL, not a fault.
  return 'no_moments: the extractor parsed cleanly and returned no moments'
    + (stopReason ? ' (stop_reason=' + stopReason + ')' : '');
}

module.exports = { describeHighlightFailure: describeHighlightFailure, SNIPPET: SNIPPET };
