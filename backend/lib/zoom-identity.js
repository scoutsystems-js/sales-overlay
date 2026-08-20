/**
 * ZOOM SPEAKER IDENTITY — byte-identical display-name match, with a
 * collision detector (Justin, 2026-08-20).
 *
 * ⚠⚠ WHY THIS IS NOT THE NAME MATCH WE REFUSED FOR FATHOM, AND THE
 * DISTINCTION IS THE WHOLE FEATURE. The refused Fathom fallback asked
 * "does this transcript label LOOK LIKE the recorded-by name?" — a
 * similarity judgement against an open world, which recorded the CLOSER as
 * the PROSPECT on 6 of 83 calls. This asks a different question:
 *
 *     is this transcript label BYTE-IDENTICAL to the display name Zoom
 *     itself has on file for the account that recorded this call,
 *     inside a CLOSED SET of two or three people?
 *
 * Zoom generates a VTT label from the participant's own account profile,
 * so both sides of the comparison come from the same Zoom field. It is an
 * equality test, not a resemblance test.
 *
 * ⚠ MEASURED ON THE REAL CALL BEFORE BUILDING (2026-08-20): GET /users/me
 * returns display_name "Josh"; the 1012-turn Zoom transcript carries
 * ["Josh", "Justin Schmidt", "Peter Singh"]; exactly one label matched, with
 * NOTHING differing — no case, no spacing, no middle initial. So there is no
 * near-miss class to normalise, which is the point of refusing to normalise:
 *
 * ⚠⚠ NO NORMALISATION, EVER. Not case-folding, not trimming, not
 * initials. A near-miss is precisely where guessing creeps back in — the
 * moment "Josh" is allowed to match "josh " or "Josh P.", this stops being
 * an equality test and becomes the resemblance test we refused. If a real
 * mismatch ever appears, that is a REPORT, not a reason to loosen this.
 *
 * ⚠ THE RESIDUAL RISK, NAMED RATHER THAN HIDDEN: this depends on the HOST
 * BEING THE CONNECTED ACCOUNT. If a manager hosts, or a prospect starts the
 * meeting, the connected account's display name is not the closer's and the
 * match is confidently wrong with nothing on screen to say so. The
 * participants scope (dashboard_meetings:read:admin) resolves identity
 * WITHIN the meeting and does not care who hosted — it remains the real fix
 * and this is a faster path to it, not a replacement.
 */
'use strict';

/**
 * ⚠⚠ THE COLLISION DETECTOR — ONE CALL DEGRADES INSTEAD OF THE WHOLE
 * PROVIDER, which is the trade Justin ruled for.
 *
 * When two participants share a display name, Zoom's VTT gives them the SAME
 * label and there is nothing in the file to separate them. Scout cannot see
 * the participant list without the admin scope — but it CAN see that a
 * conversation came back with only one distinct voice.
 *
 * A real sales call has at least two speakers. So exactly one distinct label
 * means either a collision or a monologue, and BOTH are reasons to stay
 * quiet. That is checkable with no extra API call and no scope change.
 *
 * ⚠ ITS LIMIT, STATED HERE SO IT IS NOT MISTAKEN FOR COMPLETE: a
 * THREE-person call where two of the three collide shows two labels and is
 * UNDETECTABLE by this rule. That residue is real and accepted — measured
 * collision rate on the closer's own corpus is 0.51% (1 call in 196), and
 * the exchange is a 7% SILENT error (the closer recorded as the prospect)
 * for a sub-1% HONEST silence. If 3-person calls ever become common, this
 * ruling needs re-making rather than quietly widening.
 */
function hasLabelCollision(distinctLabels) {
  var labels = Array.isArray(distinctLabels) ? distinctLabels.filter(Boolean) : [];
  return labels.length < 2;
}

/**
 * Resolve the closer from a Zoom display name.
 *
 * Returns { closerName, reason } — closerName is non-null ONLY when the match
 * is proven. `reason` always explains the outcome, because a silent null is
 * the failure mode this whole module exists to avoid.
 *
 * @param {string|null} closerDisplayName  Zoom's display_name for the connected account
 * @param {string[]}    distinctLabels     distinct speaker labels in the transcript
 */
function resolveZoomCloser(closerDisplayName, distinctLabels) {
  var labels = Array.isArray(distinctLabels) ? distinctLabels.filter(Boolean) : [];

  if (typeof closerDisplayName !== 'string' || !closerDisplayName) {
    return { closerName: null, reason: 'no_display_name' };
  }
  if (!labels.length) {
    return { closerName: null, reason: 'no_labels' };
  }
  // ⚠ COLLISION CHECKED BEFORE THE MATCH, DELIBERATELY. On a collided
  // two-person call the closer's name DOES appear — it is just also the
  // prospect's. Matching first would return a confident, wrong answer on
  // exactly the call this detector exists to catch.
  if (hasLabelCollision(labels)) {
    return { closerName: null, reason: 'label_collision' };
  }

  // BYTE-IDENTICAL. `===` and nothing else.
  var exact = labels.filter(function (l) { return l === closerDisplayName; });
  if (exact.length === 1) {
    return { closerName: exact[0], reason: 'exact_match' };
  }
  if (exact.length > 1) {
    // Cannot happen for a true distinct set, but a caller passing duplicates
    // must not be silently resolved — ambiguity is a refusal, never a pick.
    return { closerName: null, reason: 'ambiguous' };
  }
  return { closerName: null, reason: 'no_match' };
}

module.exports = {
  hasLabelCollision: hasLabelCollision,
  resolveZoomCloser: resolveZoomCloser,
};
