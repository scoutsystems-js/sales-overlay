'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-coaching-evidence');
const W = require('../lib/analysis-worker');

const turns = [
  { speaker: 'PROSPECT', text: 'I want more time with my family.' },
  { speaker: 'CLOSER', text: 'What is that costing you today?' },
  { speaker: 'PROSPECT', text: 'I miss dinner with them most nights.' },
];
const locate = (all, quote) => { const index = all.findIndex((turn) => turn.text.includes(quote)); return index < 0 ? null : { index: index + 1, speaker: all[index].speaker }; };

test('Discovery evidence requires prospect context, a closer probe, and prospect detail in order', () => {
  const evidence = { prospect_context: { quote: turns[0].text }, closer_probe: { quote: turns[1].text }, prospect_detail: { quote: turns[2].text } };
  assert.deepEqual(S.verify(evidence, 'discovery', turns, locate).stage, 'discovery');
  assert.equal(S.verify({ ...evidence, closer_probe: { quote: turns[2].text } }, 'discovery', turns, locate), null);
});

test('the stage contract does not let an objection borrow Discovery evidence', () => {
  assert.equal(S.sanitize({ prospect_context: { quote: 'x' } }, 'objection'), null);
});

test('the worker persists one stage exchange only after its transcript proof passes', () => {
  const raw = { prospect_context: { quote: turns[0].text }, closer_probe: { quote: turns[1].text }, prospect_detail: { quote: turns[2].text } };
  const highlights = W._sanitizeHighlights([{ timestamp_seconds: 1, speaker: 'PROSPECT', quote: turns[0].text, observation: 'The prospect gives context.', type: 'strong_moment', section: 'discovery', coaching_evidence: raw }, { timestamp_seconds: 2, speaker: 'PROSPECT', quote: turns[0].text, observation: 'A duplicate candidate.', type: 'strong_moment', section: 'discovery', coaching_evidence: raw }], 600);
  const verified = W._attachArcFields(highlights, turns, 'matched');
  assert.equal(verified[0].coaching_evidence.prospect_detail.turn, 3);
  assert.equal(verified[1].coaching_evidence, null);
});
