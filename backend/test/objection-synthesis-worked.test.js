const test = require('node:test');
const assert = require('node:assert/strict');
const synthesis = require('../lib/objection-synthesis');

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
