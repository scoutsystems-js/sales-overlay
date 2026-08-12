/**
 * The speaker-anchoring guard.
 *
 * THE BUG (live, Justin's review): two moments typed `barrier` carried
 * speaker=CLOSER and quoted the closer's OWN finances — "Dude, I just burnt
 * through $100,000… my dad, I'm going to talk to him about being a silent
 * partner" — while their observations read "Prospect disclosed no liquid
 * capital." Speaker attribution was CORRECT. The extractor simply ignored it
 * when interpreting, turning the closer's rapport-building into the prospect's
 * barrier.
 *
 * THE RULE: `barrier`, `risk_signal` and `objection` describe the PROSPECT'S
 * position. They cannot be anchored on a closer-spoken line.
 *
 * WHY A WRITE-TIME GUARD RATHER THAN A PROMPT LINE: a prompt instruction is the
 * adjective-not-operation trap this project has now hit three times. And the
 * blast radius is not cosmetic — a closer-spoken "barrier" corrupts the
 * coverage map, what_mattered, and any future 8c/8d tracing, all of which read
 * these types as statements about the prospect.
 *
 * WHY REJECT RATHER THAN RECLASSIFY: the observation is written from the same
 * mistaken premise as the type. Salvaging the row by retyping it would keep
 * prose asserting the prospect disclosed something they never said. The
 * sanitizer cannot rewrite an observation, and inventing a replacement label it
 * cannot justify is the wrong-label-worse-than-none failure. Dropping costs one
 * moment out of the 5-8 the extractor emits.
 */
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const sanitize = worker._sanitizeHighlights;
const PROSPECT_TYPES = ['barrier', 'risk_signal', 'objection'];

function hl(over) {
  return Object.assign({
    timestamp_seconds: 100, speaker: 'PROSPECT',
    quote: 'the lender only approved five thousand dollars of it',
    observation: 'Prospect reported a financing shortfall.',
    type: 'barrier', section: 'close',
  }, over);
}

test('a CLOSER-spoken barrier / risk_signal / objection is REJECTED', () => {
  PROSPECT_TYPES.forEach((t) => {
    const out = sanitize([hl({ type: t, speaker: 'CLOSER' })], 3600);
    assert.deepStrictEqual(out, [], t + ' must not survive on a closer-spoken line');
  });
});

test('the live case is rejected — closer describing his OWN finances', () => {
  const out = sanitize([hl({
    type: 'barrier', speaker: 'CLOSER',
    quote: 'Dude, I just burnt through $100,000 of my own money on this',
    observation: 'Prospect disclosed no liquid capital.',
  })], 3600);
  assert.deepStrictEqual(out, [], 'this is the exact row that shipped wrong');
});

test('the SAME line spoken by the prospect is kept', () => {
  PROSPECT_TYPES.forEach((t) => {
    const out = sanitize([hl({ type: t, speaker: 'PROSPECT' })], 3600);
    assert.strictEqual(out.length, 1, t);
    assert.strictEqual(out[0].speaker, 'PROSPECT');
  });
});

test('closer-side types are untouched by the guard', () => {
  // strong_moment and rapport_moment are ABOUT the closer — rejecting those
  // would delete the good half of the corpus.
  ['strong_moment', 'rapport_moment', 'missed_opportunity'].forEach((t) => {
    const out = sanitize([hl({ type: t, speaker: 'CLOSER' })], 3600);
    assert.strictEqual(out.length, 1, t + ' must survive a closer-spoken line');
  });
});

test('buying_signal and disqualify_signal are prospect-side but NOT guarded here', () => {
  // Deliberate scope: the ruling names three types. A buying signal voiced by
  // the closer ("so you'd want to start in January?") is a normal reflection
  // and not the corruption this guard exists to stop. Widening the list is a
  // ruling, not a tidy-up.
  ['buying_signal', 'disqualify_signal'].forEach((t) => {
    const out = sanitize([hl({ type: t, speaker: 'CLOSER' })], 3600);
    assert.strictEqual(out.length, 1, t);
  });
});

test('the guard is exported so the worker can re-apply it after verification', () => {
  // Write-time speaker VERIFICATION can correct speaker PROSPECT -> CLOSER
  // after sanitisation, so the same rule has to run again on the proven value.
  // Checking the model's claim alone would let a corrected row slip through.
  assert.strictEqual(typeof worker._violatesProspectAnchor, 'function');
  assert.strictEqual(worker._violatesProspectAnchor({ type: 'barrier', speaker: 'CLOSER' }), true);
  assert.strictEqual(worker._violatesProspectAnchor({ type: 'barrier', speaker: 'PROSPECT' }), false);
  assert.strictEqual(worker._violatesProspectAnchor({ type: 'strong_moment', speaker: 'CLOSER' }), false);
});

test('a moment with no speaker at all is not rejected by this guard', () => {
  // Missing speaker is already handled upstream; this guard must not become a
  // second, silent reason for moments to vanish.
  assert.strictEqual(worker._violatesProspectAnchor({ type: 'barrier', speaker: null }), false);
});
