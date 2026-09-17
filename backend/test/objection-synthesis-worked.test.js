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
