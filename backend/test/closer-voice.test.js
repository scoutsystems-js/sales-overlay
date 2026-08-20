/**
 * (t) THE FOLLOW-UP EMAIL IN THE CLOSER'S OWN LANGUAGE — Josh: "unless the
 * closer sounds dumb lol".
 *
 * ⚠⚠ THE FILTERS ARE THE FEATURE, NOT THE GROUNDING. Grounding on the closer's
 * real lines is easy; NOT propagating their filler is the whole job. Every
 * rejection case below is a REAL verified line from Josh's calls.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cv = require('../lib/closer-voice');

test('⚠⚠ REAL disfluent lines are rejected — these are verbatim from Josh', () => {
  [
    "that's not the, the real estate's not the hard part.",          // stammer
    "I mean, do you have, do you have room on like a credit card by chance?", // filler + repair
    "we've also, although we would prefer, right, that it was in a area or location.", // fragment
    "And that's outside of emergency funds? That's like, you can, that's what you can spend on it.",
  ].forEach((l) => assert.strictEqual(cv.isCleanVoiceLine(l), false,
    'must be rejected — this is the noise, not the voice: ' + l));
});

test('⚠ REAL clean lines are kept — the voice must survive the filter', () => {
  [
    'That is 100% normal. It is actually almost impossible to start a sober living property.',
    "You don't need my permission to do whatever the hell you want.",
    'Are you living paycheck to paycheck by any means?',
    'Take as long as you need. My job is not to convince you to work with us.',
  ].forEach((l) => assert.strictEqual(cv.isCleanVoiceLine(l), true,
    'must be kept — a filter that rejects everything has no voice left: ' + l));
});

test('⚠ it REJECTS, never repairs — a cleaned line is evidence of our rewriting', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'closer-voice.js'), 'utf8');
  const fn = src.slice(src.indexOf('function isCleanVoiceLine'), src.indexOf('function selectVoiceLines'));
  assert.ok(!/\.replace\(/.test(fn.replace(/\/\*[\s\S]*?\*\//g, '').split('var words')[0]),
    'the predicate must not rewrite the text it is judging');
  assert.ok(/return false/.test(fn), 'it rejects');
});

test('⚠⚠ ZOOM DEGRADES TO SILENCE — never substitute unverified lines', () => {
  assert.strictEqual(cv.shouldGroundVoice('matched'), true);
  assert.strictEqual(cv.shouldGroundVoice('unknown'), false,
    'an unmatched transcript has no closer, so its lines are as likely to be the '
    + "PROSPECT's — an email in the wrong person's voice with nothing to reveal it");
  assert.strictEqual(cv.shouldGroundVoice('inferred'), false);
  assert.strictEqual(cv.shouldGroundVoice(undefined), false, 'fails closed');
  assert.strictEqual(cv.voicePromptBlock([]), null, 'no lines -> no block, not an empty block');
  assert.strictEqual(cv.voicePromptBlock(null), null);
});

test('⚠⚠ the block says REGISTER-not-reuse AND carries the no-filler clause', () => {
  const b = cv.voicePromptBlock(['That is 100% normal. It is almost impossible to do this.']);
  assert.ok(/EVIDENCE OF REGISTER/.test(b), 'framing: register, not a phrase bank');
  assert.ok(/not as text to reuse/.test(b), 'or the email becomes a collage of old lines');
  assert.ok(/THIS call only/.test(b), 'and must not import moments from other calls');
  assert.ok(/would have said if they had said it cleanly/.test(b),
    'THE clause that separates voice from noise — without it "sounds like Josh" '
    + 'and "sounds dumb" are the same instruction');
});

test('⚠ the sample is spread and deduped — one call must not set the register', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ closer_response: 'That is normal number ' + i + '. It happens to everyone here.' });
  rows.push({ closer_response: 'That is normal number 0. It happens to everyone here.' }); // dupe
  const got = cv.selectVoiceLines(rows, 15);
  assert.strictEqual(got.length, 15);
  assert.strictEqual(new Set(got).size, 15, 'no duplicates');
  assert.notStrictEqual(got[1], rows[1].closer_response, 'strided, not the first N');
});

test('⚠⚠ the prompt change ships WITH its version bump, in this commit', () => {
  const w = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const v = w.match(/const ANALYSIS_PROMPT_VERSION = '([^']+)'/);
  assert.ok(v, 'version constant missing');
  assert.ok(/^v24-/.test(v[1]),
    'a prompt edit and its version bump are ONE atomic change — a lagging version '
    + 'makes every downstream system lie coherently. Got ' + v[1]);
  assert.ok(/voiceBlock/.test(w), 'and the block must actually reach the prompt');
  assert.ok(/shouldGroundVoice\(normalized\.speaker_confidence\)/.test(w),
    'gated on a MATCHED speaker, not on source');
});
