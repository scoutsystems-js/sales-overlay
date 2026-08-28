/* WHICH KIND OF MOMENT MAY BACK WHICH KIND OF CLAIM.
 *
 * ⚠⚠ MEASURED FAULT, 2026-08-27: of 414 what-to-improve evidence quotes, 61%
 * were a POSITIVE moment cited for a claim that was not about missing one —
 * "Payment successful." offered as the biggest gap on loss calls, and a prospect
 * asking how to pay shown as proof of the team's weakest section.
 *
 * ⚠⚠ AND THE FIRST DIAGNOSIS WAS WRONG, WHICH IS WHY THIS FILE EXISTS RATHER
 * THAN A DATA CHANGE. I reported that the synthesis threw the type away before
 * the prompt. It does not — `c.type` has been on every candidate line since the
 * first cached synthesis in July, so ALL 414 were generated with the type
 * visible. The model was told and cited anyway.
 *
 * So the missing thing was never the information. It was the RULE. Nothing in
 * either prompt said which class of moment can evidence which class of claim.
 *
 * ⚠ THIS IS A PROMPT RULE, NOT A SERVER-SIDE FILTER, and that is deliberate: a
 * suppression pass would hide the remaining failures instead of revealing them,
 * and we would never learn whether the real fix worked. The model still chooses;
 * mismatches stay visible and countable.
 *
 * ⚠ STATED AS AN OPERATION, NOT AN ADJECTIVE. "Cite appropriate evidence" is
 * something a model can agree with and still misapply — the lesson this codebase
 * has now paid for three times (v14 copy-a-span, v17 decide-your-way-out, v18
 * engage-with-the-substance). This names the types and the one exception.
 */

// Moments where something went wrong. These can evidence a gap directly.
var NEGATIVE_TYPES = ['objection', 'missed_opportunity', 'risk_signal', 'barrier', 'disqualify_signal'];
// Moments where something went right. These can evidence a STRENGTH — or a gap
// ONLY when the gap is that the moment was missed or not acted on.
var POSITIVE_TYPES = ['buying_signal', 'strong_moment', 'rapport_moment'];

var EVIDENCE_RULE = [
  'EVIDENCE RULE — which moment may back which claim:',
  '  · A STRENGTH must cite a moment where something went right: ' + POSITIVE_TYPES.join(', ') + '.',
  '  · A GAP must cite a moment where something went wrong: ' + NEGATIVE_TYPES.join(', ') + '.',
  '  · THE ONE EXCEPTION: a gap MAY cite ' + POSITIVE_TYPES.join('/') + ' when the gap is that the',
  '    closer MISSED it or did not act on it — and then the claim must say so explicitly.',
  '  · Never cite a completed sale, a payment confirmation or a prospect agreeing to buy as',
  '    proof of a failure. If the only moments left are positive and the claim is not about',
  '    missing one, choose a different claim.',
].join('\n');

module.exports = {
  EVIDENCE_RULE: EVIDENCE_RULE,
  NEGATIVE_TYPES: NEGATIVE_TYPES,
  POSITIVE_TYPES: POSITIVE_TYPES,
  // ⚠ Folded into BOTH synthesis cache keys. Without it the cached wrong quotes
  // serve indefinitely and the fix looks shipped while changing nothing on
  // screen — the exact trap NEEDS_WORK_LANE_VERSION was added for.
  EVIDENCE_RULE_VERSION: 'v1-evidence-rule-2026-08-28',
};
