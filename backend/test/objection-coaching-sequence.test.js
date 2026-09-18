'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/objection-coaching-sequence');
const W = require('../lib/analysis-worker');

const turns = [
  { speaker: 'PROSPECT', text: 'I did not think it would cost that much.' },
  { speaker: 'CLOSER', text: 'Outside the cost, is this one hundred percent what you want?' },
  { speaker: 'PROSPECT', text: 'Yes, it is what I want.' },
  { speaker: 'CLOSER', text: 'So the decision is made and we can map the money.' },
];
const locate = (all, quote) => { const index = all.findIndex((turn) => turn.text.includes(quote)); return index < 0 ? null : { index: index + 1, speaker: all[index].speaker }; };
const raw = { concern: { quote: turns[0].text }, check: { quote: turns[1].text }, confirmation: { quote: turns[2].text }, response: { quote: turns[3].text }, response_kind: 'reframed' };

test('stores only an exact, ordered, speaker-correct isolation sequence', () => {
  const out = S.verify(raw, turns, locate);
  assert.equal(out.response_kind, 'reframed');
  assert.deepEqual([out.concern.turn, out.check.turn, out.confirmation.turn, out.response.turn], [1, 2, 3, 4]);
});

test('withholds a changed subject masquerading as confirmation', () => {
  const bad = structuredClone(raw);
  bad.confirmation.quote = 'What payment plans do you offer?';
  assert.equal(S.verify(bad, turns.concat({ speaker: 'PROSPECT', text: bad.confirmation.quote }), locate), null);
});

test('the worker persists one sequence only after transcript verification', () => {
  const highlights = W._sanitizeHighlights([{
    timestamp_seconds: 1, speaker: 'PROSPECT', quote: turns[0].text, observation: 'The prospect raises a concern.', type: 'objection', section: 'objection', resolution: 'handled', coaching_sequence: raw,
  }, {
    timestamp_seconds: 2, speaker: 'PROSPECT', quote: turns[0].text, observation: 'A duplicate candidate.', type: 'objection', section: 'objection', resolution: 'handled', coaching_sequence: raw,
  }], 600);
  const verified = W._attachArcFields(highlights, turns, 'matched');
  assert.equal(verified[0].coaching_sequence.confirmation.turn, 3);
  assert.equal(verified[1].coaching_sequence, null);
  const broken = structuredClone(highlights);
  broken[0].coaching_sequence.confirmation.quote = 'Invented confirmation.';
  assert.equal(W._attachArcFields(broken, turns, 'matched')[0].coaching_sequence, null);
});
