'use strict';
/* BLOCK 006 (SCOUT-BUILD-SESSION.md) — JUSTIN'S AUTHORITATIVE STAGE DEFINITIONS, CANONICAL IN ONE PLACE.
   Intro = the opening, the connection check and above all the frame/agenda (the team's own frame, never a universal
   script). Discovery = the information-gathering due, six areas. Pitch = the offer explained against what was found,
   the price/investment presented, and the FIRST ask for the sale — judged on relevance, clarity and concision, never
   length. Objection Handling = specific resistance to purchasing after the pitch and the price, INCLUDING the re-asks
   inside the loop. Close = obtaining the commitment and driving the purchase through once the rep is completing the
   sale — not the end of the call, not the follow-up booking, not "did it sell". Stages are behavioural and may
   interleave. The production grader and the offline prompt read the SAME constant; the validator enforces what is
   deterministic about them on seven real flows (A–G). */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const S = require('../lib/stage-eligibility');
const W = require('../lib/analysis-worker');

test('the five definitions exist once, in Justin\'s words, and carry the boundary rules', () => {
  assert.deepEqual(Object.keys(S.STAGE_DEFINITIONS), ['intro', 'discovery', 'pitch', 'objection', 'close']);
  const d = S.STAGE_DEFINITIONS;
  assert.match(d.intro, /frame|agenda/i); assert.match(d.intro, /team|manager/i, 'the frame is the team\'s own, not a universal script');
  assert.match(d.discovery, /PAIN|GOALS|CURRENT SITUATION|DECISION MAKERS|WHY NOW|FINANCIAL RESOURCES/, 'the six areas stay');
  assert.match(d.pitch, /price|investment/i); assert.match(d.pitch, /FIRST ask/i); assert.match(d.pitch, /concis|clarity|relevan/i); assert.match(d.pitch, /length|monologue|long/i);
  assert.match(d.objection, /resistance/i); assert.match(d.objection, /ask/i, 'the re-asks inside the loop belong here');
  assert.match(d.close, /commitment/i); assert.doesNotMatch(d.close, /price presented|assumptive/i, 'price and the first ask are Pitch, not Close');
  assert.match(d.close, /not the end of the (call|recording)/i); assert.match(d.close, /follow-up|continuation|next (call|meeting)/i);
  assert.match(S.STAGE_BOUNDARIES, /interleave|overlap|chronolog/i, 'stages are behavioural, not five slices');
  assert.match(S.STAGE_BOUNDARIES, /FIRST ask/i); assert.match(S.STAGE_BOUNDARIES, /Objection Handling/); assert.match(S.STAGE_BOUNDARIES, /sold|outcome/i, 'outcome is evidence, not the rubric');
});
test('the production grader prompt and the offline stage prompt carry the canonical definitions verbatim, and the old Close rubric is gone', () => {
  const normalized = { turns: [{ speaker: 'CLOSER', display_name: 'A', text: 'hello', start_seconds: 1 }], highlights: [], closer_name: 'A', speaker_confidence: 'matched' };
  const production = W._buildSectionGraderPrompt(normalized, 600, '', [], {});
  const offline = S.promptInstructions('');
  for (const key of Object.keys(S.STAGE_DEFINITIONS)) {
    assert.ok(production.includes(S.STAGE_DEFINITIONS[key]), 'production prompt carries the ' + key + ' definition');
    assert.ok(offline.includes(S.STAGE_DEFINITIONS[key]), 'offline prompt carries the ' + key + ' definition');
  }
  assert.ok(production.includes(S.STAGE_BOUNDARIES)); assert.ok(offline.includes(S.STAGE_BOUNDARIES));
  assert.doesNotMatch(production, /was price presented confidently|were final objections handled before the call ended|handling resistance via isolation \+ framework rebuttal/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'), /ANALYSIS_PROMPT_VERSION = 'v62-2026-09-11'/, 'a prompt change ships with its version');
});

/* THE VALIDATOR ON SEVEN REAL FLOWS. The grader segments; code enforces what is deterministic: no objection → Objection
   Handling is never scored; no purchase decision due → Close is never scored; a genuine DQ makes Objection Handling and
   Close not applicable whenever found; a follow-up grades only what was due. Scores are the grader's; outcome never is. */
const T = [
  ['CLOSER', 'Thanks for hopping on. Here is what we will cover today.'],          // 1 intro
  ['PROSPECT', 'I want to get to twenty clients; I am at ten.'],                    // 2 discovery
  ['CLOSER', 'What is keeping you at ten, and what happens if that stays?'],         // 3 discovery
  ['PROSPECT', 'No repeatable way to find clients. I have thirty thousand saved.'],  // 4 discovery / finance
  ['CLOSER', 'The program builds that client system around your goal.'],            // 5 pitch
  ['CLOSER', 'The investment is nine thousand eight hundred.'],                      // 6 price
  ['CLOSER', 'Shall we get you started today?'],                                     // 7 FIRST ask
  ['PROSPECT', 'I need to check with my wife first.'],                               // 8 objection 1
  ['CLOSER', 'Aside from that, is anything else holding you back?'],                 // 9 handling
  ['CLOSER', 'If she is on board, are you ready to start?'],                         // 10 re-ask
  ['PROSPECT', 'Money is tight this month.'],                                        // 11 objection 2
  ['CLOSER', 'We can split it into two payments. Does that work?'],                  // 12 handling + re-ask
  ['PROSPECT', 'Yes, let us do it.'],                                                // 13 commitment
  ['CLOSER', 'I have the first payment processed. Welcome aboard.'],                 // 14 completion
];
const turns = T.map((t, i) => ({ speaker: t[0], text: t[1], start_seconds: (i + 1) * 30 }));
const base = { sales_conversation: true, call_kind: 'initial', ending: { state: 'completed', evidence_turn_ids: [13, 14] }, pitch: { occurred: true, evidence_turn_ids: [5] }, price: { occurred: true, evidence_turn_ids: [6] }, prior_presentation: { established: false, evidence_turn_ids: [] }, objection: { occurred: true, evidence_turn_ids: [8, 11] }, finance: { state: 'qualified', discovered_stage: 'discovery', feasible_financing_ruled_out: null, evidence_turn_ids: [4] }, close_due: true };
const row = (stage, state, score, ids, reason = 'Observed work.') => ({ stage, state, score, grade: score === null ? null : S.canonicalGrade(score), evidence_turn_ids: ids, reason });
const assess = (context, stages) => S.assessProduction({ stage_assessment: { context, stages } }, turns);
const states = r => Object.fromEntries(S.SECTIONS.map(k => [k, r.sections[k].state + (r.sections[k].score === null ? '' : ':' + r.sections[k].score)]));

test('A. clean one-call close: Pitch holds the offer, price and first ask; Close holds the commitment; Objection Handling is N/A and cannot be scored', () => {
  const ctx = { ...base, objection: { occurred: false, evidence_turn_ids: [] } };
  const r = assess(ctx, [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 88, [2, 3, 4]), row('pitch', 'evaluated', 92, [5, 6, 7]), row('objection_handling', 'not_applicable', null, [], 'No objection.'), row('close', 'evaluated', 96, [13, 14])]);
  assert.deepEqual(states(r), { intro: 'evaluated:90', discovery: 'evaluated:88', pitch: 'evaluated:92', objection: 'not_applicable', close: 'evaluated:96' });
  assert.deepEqual(r.sections.pitch.evidence.map(e => e.quote), [T[4][1], T[5][1], T[6][1]], 'the first ask is cited inside Pitch');
  const scored = assess(ctx, [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 88, [2]), row('pitch', 'evaluated', 92, [5]), row('objection_handling', 'evaluated', 70, [7]), row('close', 'evaluated', 96, [13])]);
  assert.equal(scored.sections.objection.state, 'unmeasured', 'a scored Objection Handling with no objection on record is withheld, never kept');
});
test('B. the objection loop: first ask in Pitch, the loop with its re-asks in Objection Handling, the final commitment in Close — all three scorable together', () => {
  const r = assess(base, [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 85, [2, 3, 4]), row('pitch', 'evaluated', 90, [5, 6, 7]), row('objection_handling', 'evaluated', 82, [8, 9, 10, 11, 12]), row('close', 'evaluated', 94, [13, 14])]);
  assert.deepEqual(states(r), { intro: 'evaluated:90', discovery: 'evaluated:85', pitch: 'evaluated:90', objection: 'evaluated:82', close: 'evaluated:94' });
  assert.ok(r.sections.objection.evidence.some(e => e.quote === T[9][1]), 'the re-ask inside the loop sits in Objection Handling evidence');
  assert.ok(!r.sections.close.evidence.some(e => e.quote === T[6][1]), 'the first ask is not Close evidence');
});
test('C. lost after the loop: Objection Handling grades; Close grades closing behaviour when a decision was due; the lost outcome is not in the validator at all', () => {
  const lostTurns = turns.slice(0, 12).concat([{ speaker: 'PROSPECT', text: 'No, I am going to pass.', start_seconds: 390 }]);
  const ctx = { ...base, ending: { state: 'completed', evidence_turn_ids: [13] } };
  const r = S.assessProduction({ stage_assessment: { context: ctx, stages: [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 85, [2]), row('pitch', 'evaluated', 88, [5, 6, 7]), row('objection_handling', 'evaluated', 78, [8, 9, 10, 11, 12]), row('close', 'evaluated', 86, [12, 13])] } }, lostTurns);
  assert.equal(r.sections.objection.state, 'evaluated'); assert.equal(r.sections.close.state, 'evaluated'); assert.equal(r.sections.close.score, 86, 'a lost deal does not lower a graded Close');
  const undue = S.assessProduction({ stage_assessment: { context: { ...ctx, close_due: false }, stages: [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 85, [2]), row('pitch', 'evaluated', 88, [5]), row('objection_handling', 'evaluated', 78, [8]), row('close', 'evaluated', 40, [13])] } }, lostTurns);
  assert.equal(undue.sections.close.state, 'not_applicable', 'no purchase decision due → a low Close is never kept');
});
test('D. early financial DQ: Discovery grades the qualification; Pitch, Objection Handling and Close are not due', () => {
  const ctx = { ...base, finance: { state: 'genuine_dq', discovered_stage: 'discovery', feasible_financing_ruled_out: true, evidence_turn_ids: [4] }, close_due: false };
  const r = assess(ctx, [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 91, [2, 3, 4]), row('pitch', 'evaluated', 60, [5]), row('objection_handling', 'evaluated', 50, [8]), row('close', 'evaluated', 30, [13])]);
  assert.deepEqual(states(r), { intro: 'evaluated:90', discovery: 'evaluated:91', pitch: 'not_applicable', objection: 'not_applicable', close: 'not_applicable' });
});
test('E. late financial discovery: an evidenced Discovery miss can score; inability to buy is never a bad Close or a bad Objection Handling', () => {
  const ctx = { ...base, finance: { state: 'genuine_dq', discovered_stage: 'late', feasible_financing_ruled_out: true, evidence_turn_ids: [11] } };
  const r = assess(ctx, [row('intro', 'evaluated', 90, [1]), row('discovery', 'expected_but_missed', 45, [2, 3, 11]), row('pitch', 'evaluated', 85, [5, 6, 7]), row('objection_handling', 'evaluated', 40, [11, 12]), row('close', 'evaluated', 35, [13])]);
  assert.deepEqual(states(r), { intro: 'evaluated:90', discovery: 'expected_but_missed:45', pitch: 'evaluated:85', objection: 'not_applicable', close: 'not_applicable' });
});
test('F. a correct continuation: paused before a decision was due → the later stages are not due, no fake Close failure', () => {
  const ctx = { ...base, ending: { state: 'appropriate_continuation', evidence_turn_ids: [4] }, pitch: { occurred: false, evidence_turn_ids: [] }, price: { occurred: false, evidence_turn_ids: [] }, objection: { occurred: false, evidence_turn_ids: [] }, close_due: false };
  const r = assess(ctx, [row('intro', 'evaluated', 90, [1]), row('discovery', 'evaluated', 84, [2, 3, 4]), row('pitch', 'not_applicable', null, [], 'Paused before the pitch.'), row('objection_handling', 'not_applicable', null, [], 'No presentation.'), row('close', 'expected_but_missed', 20, [4])]);
  assert.deepEqual(states(r), { intro: 'evaluated:90', discovery: 'evaluated:84', pitch: 'not_applicable', objection: 'not_applicable', close: 'not_applicable' });
});
test('G. a follow-up call: the earlier presentation stands, Discovery and Pitch are not repeated, the objection and the close due on THIS call grade', () => {
  const ctx = { ...base, call_kind: 'follow_up', pitch: { occurred: false, evidence_turn_ids: [] }, price: { occurred: false, evidence_turn_ids: [] }, prior_presentation: { established: true, evidence_turn_ids: [8] } };
  const r = assess(ctx, [row('intro', 'evaluated', 88, [1]), row('discovery', 'not_applicable', null, [], 'Completed on the earlier call.'), row('pitch', 'not_applicable', null, [], 'Presented on the earlier call.'), row('objection_handling', 'evaluated', 80, [8, 9, 10]), row('close', 'evaluated', 90, [13, 14])]);
  assert.deepEqual(states(r), { intro: 'evaluated:88', discovery: 'not_applicable', pitch: 'not_applicable', objection: 'evaluated:80', close: 'evaluated:90' });
});
