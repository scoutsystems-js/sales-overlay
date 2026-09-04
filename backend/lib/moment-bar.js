/**
 * The selectivity bar (H721) — Justin's ruling, 2026-09-04, FORWARD ONLY.
 *
 *   "Most calls will only have a handful of actual moments that are coachable or
 *    applaudable."
 *
 * A MOMENT NEEDS A REASON TO EXIST. The extractor used to fill a quota (asked for
 * 5–8 with a "quality gate", it landed at 6.1 per call in BOTH prompt eras, 714 of
 * 1,555 calls at 7 or 8) and nothing ranked a moment by whether a manager could
 * do anything with it. The largest class it kept — 2,517 buying signals with no
 * evidenced move — is a prospect line that credits the closer with nothing:
 * "useless to a manager" as a class rather than an instance.
 *
 * THE BAR, verbatim from the ruling:
 *   COACHABLE   — a missed opportunity · an objection left partial or unhandled ·
 *                 a risk signal or barrier ignored or deflected.
 *   APPLAUDABLE — a verified closer strong moment · an objection handled · a risk
 *                 signal or barrier addressed · a buying signal with an evidenced
 *                 move (the cause the arc capture verified, H719).
 * Everything else falls: an unevidenced or pre-sold buying signal, a rapport
 * moment, a strong moment that is not provably the closer's, a lone
 * disqualification signal, an objection with no resolution, a risk signal with
 * no handling verdict (absence is not a verdict).
 *
 * WHAT THIS IS NOT. It is not a delete. The bar governs what is CAPTURED on new
 * analyses; every existing moment stays exactly as it is. A bar that hid a rep's
 * history would be a different and much worse change. It is applied AFTER
 * attachArcFields (the buying-signal leg reads the VERIFIED cause) and BEFORE
 * persist, and the no-wipe rule still holds: an empty survivor set preserves the
 * call's existing rows rather than deleting them.
 *
 * Measured prediction on stored rows: 4.24 per call against 6.14; 426 of 1,561
 * calls fall to three or fewer, 8 to zero. THE FIRST REAL CALLS UNDER v42 ARE
 * MEASURED AGAINST THAT NUMBER (H721): if the live figure lands far from 4.2,
 * say so before it becomes the norm.
 *
 * Pure. One rule; the prompt sentence below and the filter read the same table.
 */
'use strict';

function evidencedMove(h) {
  var c = h && h.cause;
  return !!(c && typeof c === 'object' && c.move && c.move !== 'none'
    && Array.isArray(c.evidence) && c.evidence.length >= 2
    && c.evidence.every(function (e) { return e && e.located === true; }));
}

/** @returns {{kind:'coachable'|'applaudable', reason:string}|null} */
function momentReason(h) {
  if (!h || typeof h !== 'object') return null;
  var type = h.type;
  if (type === 'missed_opportunity') return { kind: 'coachable', reason: 'a missed opportunity' };
  if (type === 'objection') {
    if (h.resolution === 'handled') return { kind: 'applaudable', reason: 'an objection handled' };
    if (h.resolution === 'partial' || h.resolution === 'unhandled') return { kind: 'coachable', reason: 'an objection left ' + h.resolution };
    return null;
  }
  if (type === 'risk_signal' || type === 'barrier') {
    var name = type === 'risk_signal' ? 'a risk signal' : 'a barrier';
    if (h.handling === 'addressed') return { kind: 'applaudable', reason: name + ' addressed' };
    if (h.handling === 'ignored' || h.handling === 'deflected') return { kind: 'coachable', reason: name + ' ' + h.handling };
    return null;
  }
  if (type === 'strong_moment') {
    return (h.speaker === 'CLOSER' && h.speaker_verified === true) ? { kind: 'applaudable', reason: 'a verified closer strong moment' } : null;
  }
  if (type === 'buying_signal') {
    return evidencedMove(h) ? { kind: 'applaudable', reason: 'a buying signal the closer earned (' + h.cause.move + ')' } : null;
  }
  return null;   // rapport_moment, disqualify_signal, anything unknown
}

/** Returns NEW arrays: the survivors (reason stamped, re-numbered) and what fell. */
function applyMomentBar(highlights) {
  var kept = [], dropped = [];
  (Array.isArray(highlights) ? highlights : []).forEach(function (h) {
    var r = momentReason(h);
    if (r) kept.push(Object.assign({}, h, { bar_reason: r.reason, sequence_order: kept.length + 1 }));
    else dropped.push(h);
  });
  return { kept: kept, dropped: dropped };
}

/** The ONE sentence the extractor is told — the same table as momentReason. */
function barPromptRule() {
  return [
    'A MOMENT NEEDS A REASON TO EXIST. Return ONLY moments a manager can act on or applaud — most calls have a handful, and an array of 2 honest moments beats 7 padded ones. A moment qualifies when it is:',
    '  COACHABLE:   a missed_opportunity · an objection left partial or unhandled · a risk_signal or barrier the closer ignored or deflected;',
    '  APPLAUDABLE: a strong_moment the CLOSER spoke · an objection handled · a risk_signal or barrier the closer addressed · a buying_signal WITH a real cause (a move from the closed list, evidenced by the closer\'s own lines).',
    'Do NOT return: a buying_signal the closer did nothing to earn (no move, arrived pre-sold), a rapport_moment on its own, or a disqualify_signal on its own. Never pad toward a count.',
  ].join('\n');
}

module.exports = { momentReason: momentReason, applyMomentBar: applyMomentBar, barPromptRule: barPromptRule, evidencedMove: evidencedMove };
