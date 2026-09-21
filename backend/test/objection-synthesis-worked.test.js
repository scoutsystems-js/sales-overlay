const test = require('node:test');
const assert = require('node:assert/strict');
const synthesis = require('../lib/objection-synthesis');

test('fear practice makes the closer isolate before offering a payment solution', () => {
  const prompt = synthesis._buildSynthPrompt(
    ['fear'],
    { fear: { count: 1, handled: 1, examples: [], closedExamples: [{ surface: 'I cannot afford it.', closer_response: 'We can work with that.' }] } },
    {},
  );

  assert.match(prompt, /Fear practice: first isolate whether the stated concern is the real blocker/i);
  assert.match(prompt, /Do not recommend a payment plan, BNPL, price change, or other solution before that isolation/i);
});

test('pattern summaries refuse a list of separate calls when no shared behavior exists', () => {
  const prompt = synthesis._buildSynthPrompt(
    ['fear'],
    { fear: { count: 3, handled: 0, examples: [], missedExamples: [{ closer_response: 'Let me send you options.' }, { closer_response: 'Take some time.' }], closedExamples: [] } },
    {},
  );

  assert.match(prompt, /If the examples do not show one shared behavior, return null/i);
  assert.match(prompt, /Do not list the separate calls with “either\/or” wording/i);
});

test('worked coaching summary is retained only when an explicitly handled example supports it', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: { count: 6, handled: 1, examples: [{ closer_response: 'What specifically are you worried will happen?' }] } },
    { fear: { isolate: 'Clarify the real concern.', what_worked: 'You asked what the prospect was actually worried about before responding.' } },
    { allLossesAreDisqualifications: false },
  );

  assert.equal(result[0].what_worked, 'You asked what the prospect was actually worried about before responding.');
});

test('worked coaching summary is withheld without an explicitly handled example', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: { count: 6, handled: 1, examples: [] } },
    { fear: { isolate: 'Clarify the real concern.', what_worked: 'You asked what the prospect was actually worried about before responding.' } },
    { allLossesAreDisqualifications: false },
  );

  assert.equal(result[0].what_worked, null);
});

test('personal coaching keeps separate supported summaries for what works and what goes unhandled', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: {
      count: 30,
      handled: 6,
      examples: [
        { closer_response: 'Let me make sure that is the only thing holding you back.' },
        { closer_response: 'Other than the money, is there anything else?' },
      ],
      missedExamples: [
        { closer_response: 'We can work with that.' },
        { closer_response: 'Let me send you the payment options.' },
      ],
      closedExamples: [],
    } },
    { fear: {
      when_handled: 'When you handle fear well, you first confirm that money is the only blocker before offering a path.',
      when_not_handled: 'When fear goes unhandled, you move to options before confirming what is really holding the prospect back.',
    } },
    { allLossesAreDisqualifications: false },
  );

  assert.equal(result[0].when_handled, 'When you handle fear well, you first confirm that money is the only blocker before offering a path.');
  assert.equal(result[0].when_not_handled, 'When fear goes unhandled, you move to options before confirming what is really holding the prospect back.');
});

test('personal coaching withholds either pattern summary without two real examples on that side', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: { count: 6, handled: 1, examples: [{ closer_response: 'Is that the only blocker?' }], missedExamples: [{ closer_response: 'Let me send options.' }], closedExamples: [] } },
    { fear: { when_handled: 'Invented pattern.', when_not_handled: 'Invented pattern.' } },
    { allLossesAreDisqualifications: false },
  );

  assert.equal(result[0].when_handled, null);
  assert.equal(result[0].when_not_handled, null);
});

test('personal coaching withholds an either-or list even when both sides have enough examples', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: { count: 6, handled: 2, examples: [{ closer_response: 'Is that the only blocker?' }, { closer_response: 'What else is holding you back?' }], missedExamples: [{ closer_response: 'Let me send options.' }, { closer_response: 'Take some time.' }], closedExamples: [] } },
    { fear: { when_not_handled: 'The closer either sent options or let the concern slide.' } },
    { allLossesAreDisqualifications: false },
  );

  assert.equal(result[0].when_not_handled, null);
});

test('a review call is surfaced only when the objection was explicitly handled and that same call closed', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: {
      count: 6,
      handled: 2,
      examples: [{ closer_response: 'What specifically are you worried will happen?' }],
      closedExamples: [{ call_id: 'closed-fear', prospect_name: 'Jordan Smith', call_date: '2026-09-16T15:00:00.000Z', outcome: 'closed', closer_response: 'What specifically are you worried will happen?' }],
    } },
    { fear: { practice: 'Slow down and identify the real concern before you answer it.' } },
    { allLossesAreDisqualifications: false },
  );

  assert.deepEqual(result[0].review_example, {
    call_id: 'closed-fear', prospect_name: 'Jordan Smith', call_date: '2026-09-16T15:00:00.000Z', outcome: 'closed', closer_response: 'What specifically are you worried will happen?',
  });
  assert.equal(result[0].practice, 'Slow down and identify the real concern before you answer it.');
});

test('a handled objection on an open or lost call is never presented as a model call', () => {
  const result = synthesis._mergeGuidance(
    ['fear'],
    { fear: { count: 6, handled: 1, examples: [{ closer_response: 'What specifically are you worried will happen?' }], closedExamples: [] } },
    { fear: { practice: 'Slow down and identify the real concern before you answer it.' } },
    { allLossesAreDisqualifications: false },
  );

  assert.equal(result[0].review_example, null);
  assert.equal(result[0].practice, null);
});
