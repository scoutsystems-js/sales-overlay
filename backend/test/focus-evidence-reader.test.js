'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../lib/focus-evidence-reader');

const objectionTurns = [
  { speaker: 'PROSPECT', text: 'I am worried about whether this will work for me.' },
  { speaker: 'CLOSER', text: 'Outside of that concern, is there anything else stopping you?' },
  { speaker: 'PROSPECT', text: 'No, that is the only thing.' },
  { speaker: 'CLOSER', text: 'Then let us look at the support we give you in the first month.' },
];

test('the objection reader turns cited transcript numbers into the existing verified factual sequence', () => {
  const result = reader.verifyCandidate({
    concern_turn: 1,
    check_turn: 2,
    confirmation_turn: 3,
    response_turn: 4,
    response_kind: 'addressed',
  }, { stage: 'objection', category: 'fear' }, objectionTurns);

  assert.deepEqual(result, {
    concern: { quote: objectionTurns[0].text, turn: 1 },
    check: { quote: objectionTurns[1].text, turn: 2 },
    confirmation: { quote: objectionTurns[2].text, turn: 3 },
    response: { quote: objectionTurns[3].text, turn: 4 },
    response_kind: 'addressed',
  });
});

test('the reader withholds wrong-speaker, out-of-order, and incomplete candidates', () => {
  const base = { concern_turn: 1, check_turn: 2, confirmation_turn: 3, response_turn: 4, response_kind: 'addressed' };
  assert.equal(reader.verifyCandidate({ ...base, check_turn: 3 }, { stage: 'objection', category: 'fear' }, objectionTurns), null);
  assert.equal(reader.verifyCandidate({ ...base, confirmation_turn: 1 }, { stage: 'objection', category: 'fear' }, objectionTurns), null);
  assert.equal(reader.verifyCandidate({ concern_turn: 1, check_turn: 2, confirmation_turn: 3 }, { stage: 'objection', category: 'fear' }, objectionTurns), null);
});

test('the stage reader produces only the stage-specific verified exchange', () => {
  const turns = [
    { speaker: 'PROSPECT', text: 'I want more time with my family.' },
    { speaker: 'CLOSER', text: 'What is that costing you right now?' },
    { speaker: 'PROSPECT', text: 'I miss dinner with them most nights.' },
  ];
  const result = reader.verifyCandidate({ prospect_context_turn: 1, closer_probe_turn: 2, prospect_detail_turn: 3 }, { stage: 'discovery' }, turns);
  assert.deepEqual(result, {
    stage: 'discovery',
    prospect_context: { quote: turns[0].text, turn: 1 },
    closer_probe: { quote: turns[1].text, turn: 2 },
    prospect_detail: { quote: turns[2].text, turn: 3 },
  });
});

test('the prompt asks for turn numbers only and scopes the reader to one focus', () => {
  const prompt = reader.buildPrompt({ stage: 'objection', category: 'fear' }, objectionTurns);
  assert.match(prompt, /Fear/);
  assert.match(prompt, /turn numbers only/i);
  assert.doesNotMatch(prompt, /write coaching|summary|why this worked/i);
  assert.match(prompt, /\[1\] PROSPECT:/);
});

test('the response parser treats a fenced null as an honest absence, not malformed evidence', () => {
  assert.equal(reader.parseResponse('```json\nnull\n```'), null);
  assert.deepEqual(reader.parseResponse('```json\n{"concern_turn": 1}\n```'), { concern_turn: 1 });
});
