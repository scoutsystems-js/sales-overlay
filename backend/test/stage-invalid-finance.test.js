'use strict';
/* A CONTRADICTORY FINANCE NOTE MAY NOT ERASE A STAGE THAT STANDS ON ITS OWN EVIDENCE (Justin, 2026-09-10; H771).
   Twelve calls in the thirty-day window had pitch, objection and close withheld because the grader wrote
   `genuine_dq` beside `feasible_financing_ruled_out: false` — an invalid finance fact — while the pitch and
   the price were plainly on the transcript (Tola: pitch at turn 178, price at 347, all three blank). CLAUDE.md §6:
   a technicality unrelated to the truth of a grade may never erase that grade. The invalid fact is still
   RECORDED in context_invalid_fields — this changes what it costs, never whether it is noticed — and the stages
   score on their own located evidence. Under H768 the valid-DQ rule reads a VALID finance fact; an invalid one is
   dropped (recorded as null), so nothing downstream reads it. Every other dependency in the map is read by the
   rule it gates and still withholds when invalid: the objection rule reads pitch, price, prior presentation and
   objection; the close reads close_due; every scored stage reads sales_conversation; the cut-off rule reads ending. */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-eligibility');

const turns = Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? 'PROSPECT' : 'CLOSER', start_seconds: 10 * (i + 1), text: 'Turn ' + (i + 1) + ' of a real conversation about the program.' }));
const base = {
  sales_conversation: true, call_kind: 'initial',
  ending: { state: 'completed', evidence_turn_ids: [11, 12] },
  pitch: { occurred: true, evidence_turn_ids: [5] }, price: { occurred: true, evidence_turn_ids: [6] },
  prior_presentation: { established: false, evidence_turn_ids: [] }, objection: { occurred: true, evidence_turn_ids: [7] },
  finance: { state: 'not_assessed', discovered_stage: null, feasible_financing_ruled_out: null, evidence_turn_ids: [] }, close_due: true,
};
const stage = (stage, state, score, grade, evidence_turn_ids, reason = 'Observed source work.') => ({ stage, state, score, grade, evidence_turn_ids, reason });
const payload = (context) => ({ stage_assessment: { context, stages: [
  stage('intro', 'evaluated', 82, 'B', [1]), stage('discovery', 'evaluated', 70, 'C', [2, 3]), stage('pitch', 'evaluated', 84, 'B', [5, 6]),
  stage('objection_handling', 'evaluated', 71, 'C', [7, 8]), stage('close', 'evaluated', 66, 'D', [9, 10]) ] } });
const states = r => Object.fromEntries(S.SECTIONS.map(k => [k, r.sections[k].state + (r.sections[k].score === null ? '' : ':' + r.sections[k].score)]));

test('an invalid finance fact (a DQ claim with financing not ruled out) is recorded and dropped; pitch, objection and close score on their own evidence', () => {
  for (const discovered of ['discovery', 'late', null]) {
    const r = S.assessProduction(payload({ ...base, finance: { state: 'genuine_dq', discovered_stage: discovered, feasible_financing_ruled_out: false, evidence_turn_ids: [3] } }), turns);
    assert.deepEqual(r.context_invalid_fields, ['finance'], 'the fact is still noticed (' + discovered + ')');
    assert.equal(r.context.finance, null, 'and dropped');
    assert.deepEqual(states(r), { intro: 'evaluated:82', discovery: 'evaluated:70', pitch: 'evaluated:84', objection: 'evaluated:71', close: 'evaluated:66' }, 'discovered_stage=' + discovered);
  }
});

test('a VALID genuine DQ still makes Objection and Close not applicable (H768 unaffected)', () => {
  const r = S.assessProduction(payload({ ...base, finance: { state: 'genuine_dq', discovered_stage: 'late', feasible_financing_ruled_out: true, evidence_turn_ids: [3, 9] } }), turns);
  assert.equal(r.context_invalid_fields, undefined);
  assert.deepEqual(states(r), { intro: 'evaluated:82', discovery: 'evaluated:70', pitch: 'evaluated:84', objection: 'not_applicable', close: 'not_applicable' });
});

test('the other fields still withhold exactly the stage whose rule reads them', () => {
  const badPrice = S.assessProduction(payload({ ...base, price: { occurred: 'yes', evidence_turn_ids: [6] } }), turns);
  assert.deepEqual(badPrice.context_invalid_fields, ['price']);
  assert.equal(badPrice.sections.objection.state, 'unmeasured', 'the objection rule reads the price fact');
  assert.equal(badPrice.sections.close.state, 'evaluated'); assert.equal(badPrice.sections.pitch.state, 'evaluated');
  const badCloseDue = S.assessProduction(payload({ ...base, close_due: 'maybe' }), turns);
  assert.equal(badCloseDue.sections.close.state, 'unmeasured'); assert.equal(badCloseDue.sections.objection.state, 'evaluated');
  assert.deepEqual(S.CONTEXT_DEPENDENCIES.finance, [], 'finance gates nothing; the DQ rule reads it only when valid');
  assert.equal(S.CONTEXT_GATES.finance, undefined);
});
