// v35 — the two-question DQ boundary. Guards the RULE, not a phrasing:
// the WANT question must precede the ABILITY question, the discriminator must be a
// STATED REASON (never the words "I don't need it"), and the default on an
// unpointable no-need must remain the OBJECTION. Proven non-vacuous by rewording.
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker.js');

function prompt() {
  return worker._buildHighlightExtractorPrompt({
    turns: [{ text: 'hello', speaker: 'CLOSER', start_seconds: 0 }],
    highlights: [], speaker_confidence: 'matched', closer_name: null,
  });
}

test('v35: the WANT question is asked BEFORE the ability question', () => {
  const p = prompt();
  const want = p.indexOf('TEST 1 — DO THEY WANT IT AT ALL');
  const able = p.indexOf('TEST 2 — ONLY IF THEY WANT IT');
  assert.ok(want !== -1, 'TEST 1 (want) missing from the extractor prompt');
  assert.ok(able !== -1, 'TEST 2 (ability) missing from the extractor prompt');
  assert.ok(want < able,
    'ORDER IS THE RULE: a prospect who CAN buy but does not WANT it answers yes to the ' +
    'ability question and lands in `fear` by construction. Want must be asked first.');
});

test('v35: the discriminator is a STATED REASON, explicitly not the words', () => {
  const p = prompt();
  assert.ok(/STATED REASON THE OFFER DOES NOT APPLY/.test(p), 'discriminator wording gone');
  assert.ok(/NOT THE WORDS/.test(p),
    'the prompt must say the WORDS "I don\'t need it" are not the test — both kinds of ' +
    'prospect say them, so the words alone cannot separate a DQ from a stall.');
});

test('v35: an unpointable no-need DEFAULTS to the objection, not the DQ', () => {
  const p = prompt();
  assert.ok(/STALL WEARING A NO-NEED COSTUME/.test(p), 'the stall example is gone');
  assert.ok(/Default to the objection/.test(p),
    'FAILING OPEN TO THE OBJECTION IS THE SAFETY PROPERTY: `fear` is the only coachable ' +
    'category, so routing a genuine objection to DQ hides real coaching. When no reason ' +
    'can be pointed at, it must stay an objection.');
});

test('v35: disqualify_signal is defined to include NO NEED', () => {
  const p = prompt();
  const line = p.split('\n').find(l => l.indexOf('"disqualify_signal"') !== -1 && l.indexOf('not a real fit') !== -1);
  assert.ok(line, 'the disqualify_signal type definition is missing');
  assert.ok(/OR NO NEED/.test(line),
    'v27 defined the type as no budget / no authority / wrong stage only — with no NO NEED ' +
    'door, the want question has nowhere to route to.');
});

test('v35: the version is stamped (new calls only — nothing re-grades)', () => {
  assert.ok(/^v38-/.test(worker.ANALYSIS_PROMPT_VERSION),
    'a prompt change and its version bump are ONE atomic change');
});
