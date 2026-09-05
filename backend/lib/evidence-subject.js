/**
 * THE EVIDENCE SUBJECT CHECK AND THE CANDIDATE BAR — ONE MODULE FOR EVERY CITING LANE (H724, H725, H728).
 * A quote must prove the claim it sits under (subject: type, objection category, section — stored on every
 * moment, no model call); a moment becomes evidence only if it passes the selectivity bar. The
 * recommendations lane and the performance lane import these; a new citing lane does too.
 */
'use strict';
const { momentReason } = require('./moment-bar');

/* ⚠⚠ NO UNEARNED QUOTES (Justin, 2026-09-04, H724). The rep binding below checks WHOSE quote it
   is; NOTHING checked what the quote was ABOUT — the live defect was a partner-objection claim
   ("handled 5 of 177, surfaced too late, Nathan and Nick") carrying a prospect saying they felt
   comfortable buying. Nick was named, so it passed. The moment's own type, objection category
   and section are STORED, so the check is exact and needs no model call: the lane declares each
   claim's subject and the cited moment must agree. A claim built on COUNTS ("5 of 177") stands
   alone and carries no quote. Where it cannot be checked — no subject, an unknown kind — the
   quote is dropped and the claim kept: absent beats wrong. */
var SUBJECT_KINDS = ['buying_signal', 'objection', 'risk_signal', 'barrier', 'missed_opportunity', 'strong_moment', 'rapport_moment', 'disqualify_signal', 'section', 'count'];
/** null when the evidence proves the claim's subject; a reason string when the quote must go. */
function evidenceSubjectMismatch(subject, ev) {
  if (!ev) return null;
  var kind = subject && typeof subject.kind === 'string' ? subject.kind.trim().toLowerCase() : null;
  if (!kind || SUBJECT_KINDS.indexOf(kind) === -1) return 'no checkable subject declared (' + String(kind) + ') — the quote cannot be proven to earn its place';
  if (kind === 'count') return 'a claim built on counts carries no quote';
  if (kind === 'section') {
    var sec = subject.section ? String(subject.section).toLowerCase() : null;
    if (!sec) return 'a section claim named no section';
    return (ev.section === sec) ? null : 'a claim about ' + sec + ' cites a moment from ' + (ev.section || 'no section');
  }
  if (ev.type !== kind) return 'a claim about ' + kind.replace(/_/g, ' ') + ' cites a ' + String(ev.type || 'untyped') + ' moment';
  if (kind === 'objection' && subject.category) {
    var cat = String(subject.category).toLowerCase();
    if (ev.objection_category !== cat) return 'a claim about the ' + cat + ' objection cites a ' + (ev.objection_category || 'uncategorised') + ' one';
  }
  return null;
}

/* ⚠⚠ H725 — A MOMENT BECOMES EVIDENCE ONLY IF IT PASSES THE SELECTIVITY BAR. Justin, live on the
   coaching page: a claim that reps "convert live resistance into live decisions" carried the quote
   "It says payment complete." — the moment the money landed, not the move that earned it. The
   subject check passed it (a buying signal is the right KIND). Under Justin's own filter — did this
   move the call forward, or cost it — a payment confirmation moved nothing; it recorded that
   everything already had. So the bar that governs capture (lib/moment-bar.js) also governs what may
   be cited: a buying signal with no earned move, a rapport moment, a lone disqualification, a
   leaving — none is evidence. The claim keeps its numbers and loses the quote. */
function candidateEligible(r) {
  if (!r || r.type === 'prospect_left') return false;
  return momentReason(r) !== null;
}


function subjectPromptRule() {
  return 'A QUOTE MUST PROVE THE CLAIM IT SITS UNDER. For each item declare its subject: {"kind": one of buying_signal | objection | risk_signal | barrier | missed_opportunity | strong_moment | rapport_moment | disqualify_signal | section | count, "category": the objection category when kind is objection (fear | timing | partner | logistical | other) or null, "section": the section when kind is section, else null}. Cite ONLY a moment of that kind (and category); a claim built on counts is kind "count" with evidence_id null — it needs no quote. A quote that does not prove its claim is discarded downstream.';
}

module.exports = { evidenceSubjectMismatch: evidenceSubjectMismatch, candidateEligible: candidateEligible, SUBJECT_KINDS: SUBJECT_KINDS, subjectPromptRule: subjectPromptRule };
