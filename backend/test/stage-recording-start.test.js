'use strict';
/* A RECORDING THAT STARTS LATE IS NOT A REP WHO SKIPPED THE START (Justin, 2026-09-10; H772).
   Mike's recording opens mid-pitch ("They come into a screening, the kinds that we covered…", sixty words
   from the closer at second one) and Scout charged Gabriel Intro expected-but-missed 42 and Discovery
   expected-but-missed 28 for work that almost certainly happened before the recording began. The cut-off
   rule protected only the END (it reads the model's `ending`). The start is DETECTED IN CODE FROM THE
   TRANSCRIPT, never from the model's opinion: no opening exchange in the first eight turns or first two
   minutes (a greeting, a hearing check, a recording notice, an agenda word) AND a first turn that is already
   content — twenty-five words or more — within five seconds. Both together; a model reading for tone cannot
   route around it because it never reads the transcript's shape. When the start is missing, an
   expected_but_missed Intro or Discovery becomes unmeasured; nothing else changes — an evaluated intro stays
   evaluated, a weak opening on a complete recording (an opening exchange IS on the transcript) stays marked.
   Measured on the thirty-day window before building: 660 records, one Intro expected-but-missed, and it has
   no opening exchange; 204 recordings lack a greeting in the first eight turns (no-shows and reconnects), so
   the greeting alone is not the signal — the content-length first turn is the second half. */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-eligibility');

const content = 'They come into a screening, the kinds that we covered, operating since, and when we go into referrals, I can have them reserve a bed, and then it is like knowing the exact placement before anything else happens here.';
function turnsWith(first, opening) {
  const rest = Array.from({ length: 11 }, (_, i) => ({ speaker: i % 2 ? 'PROSPECT' : 'CLOSER', start_seconds: 30 * (i + 2), text: 'Turn ' + (i + 2) + ' of a real conversation about the program.' }));
  const head = opening ? [{ speaker: 'CLOSER', start_seconds: 1, text: 'Hey, can you hear me okay?' }, { speaker: 'CLOSER', start_seconds: 4, text: first }] : [{ speaker: 'CLOSER', start_seconds: 1, text: first }];
  return head.concat(rest).slice(0, 12);
}
const base = {
  sales_conversation: true, call_kind: 'initial', ending: { state: 'completed', evidence_turn_ids: [11, 12] },
  pitch: { occurred: true, evidence_turn_ids: [5] }, price: { occurred: false, evidence_turn_ids: [] },
  prior_presentation: { established: false, evidence_turn_ids: [] }, objection: { occurred: false, evidence_turn_ids: [] },
  finance: { state: 'not_assessed', discovered_stage: null, feasible_financing_ruled_out: null, evidence_turn_ids: [] }, close_due: false,
};
const stage = (stage, state, score, grade, evidence_turn_ids, reason = 'Observed source work.') => ({ stage, state, score, grade, evidence_turn_ids, reason });
function payload(intro, discovery) {
  return { stage_assessment: { context: base, stages: [
    stage('intro', intro, intro === 'not_applicable' ? null : 42, intro === 'not_applicable' ? null : 'F', [1]),
    stage('discovery', discovery, discovery === 'not_applicable' ? null : 28, discovery === 'not_applicable' ? null : 'F', [2, 3]),
    stage('pitch', 'evaluated', 52, 'F', [5, 6]),
    stage('objection_handling', 'not_applicable', null, null, []),
    stage('close', 'not_applicable', null, null, [4]) ] } };
}

test('the start is detected from the transcript: no opening exchange AND a content-length first turn', () => {
  assert.equal(S.recordingStart(turnsWith(content, false)), 'mid_conversation');
  assert.equal(S.recordingStart(turnsWith(content, true)), 'observed', 'a hearing check before the content is an opening');
  assert.equal(S.recordingStart(turnsWith('Alright, so where were we.', false)), 'observed', 'a short first turn is not a late start even with no greeting');
  assert.equal(S.recordingStart([{ speaker: 'CLOSER', start_seconds: 0, text: 'This meeting is being recorded.' }].concat(turnsWith(content, false))), 'observed');
  assert.equal(S.recordingStart(turnsWith('It said, um, to give access to my camera, so I did, and, um, I do not know, I do not even see the camera on here, what do I press, is it the little icon at the bottom of the window.', false)), 'observed', 'a logistics opening about the camera is an opening');
  assert.equal(S.recordingStart([{ speaker: 'PROSPECT', start_seconds: 40, text: content }].concat(turnsWith('x', false).slice(1))), 'observed', 'content that only begins forty seconds in is not a cut start');
});

test('a late start makes an expected-but-missed Intro or Discovery unmeasured, and nothing else moves', () => {
  const late = S.assessProduction(payload('expected_but_missed', 'expected_but_missed'), turnsWith(content, false));
  assert.equal(late.recording_start, 'mid_conversation');
  assert.equal(late.sections.intro.state, 'unmeasured'); assert.match(late.sections.intro.reason, /begins mid-conversation/i);
  assert.equal(late.sections.discovery.state, 'unmeasured');
  assert.equal(late.sections.pitch.state, 'evaluated'); assert.equal(late.sections.pitch.score, 52, 'the pitch that is on the recording is still scored');
  const pitchMissed = S.assessProduction({ stage_assessment: { context: base, stages: payload('evaluated', 'evaluated').stage_assessment.stages.map(r => r.stage === 'pitch' ? { ...r, state: 'expected_but_missed', score: 30, grade: 'F' } : r) } }, turnsWith(content, false));
  assert.equal(pitchMissed.sections.pitch.state, 'expected_but_missed', 'the rule stops at Discovery: a pitch on the recording that was not delivered is still a miss');
  const evaluated = S.assessProduction(payload('evaluated', 'evaluated'), turnsWith(content, false));
  assert.equal(evaluated.sections.intro.state, 'evaluated', 'a located intro on a late-start recording keeps its score');
  assert.equal(evaluated.sections.intro.score, 42);
});

test('a weak opening on a COMPLETE recording is still marked — the opening exchange is on the transcript', () => {
  const complete = S.assessProduction(payload('expected_but_missed', 'expected_but_missed'), turnsWith(content, true));
  assert.equal(complete.recording_start, 'observed');
  assert.equal(complete.sections.intro.state, 'expected_but_missed'); assert.equal(complete.sections.intro.score, 42);
  assert.equal(complete.sections.discovery.state, 'expected_but_missed');
});
