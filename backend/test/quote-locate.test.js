/**
 * The locator's job is to REFUSE more often than it answers. These cases are
 * taken from the live corpus, including the ones that defeated the first,
 * unsound implementation.
 */
const test = require('node:test');
const assert = require('node:assert');
const { locateQuoteSpeaker, labelForQuote } = require('../lib/quote-locate');

const t = (name, text, role) => ({ display_name: name, speaker: role || name, text: text });

test('single-turn quote resolves to its speaker', () => {
  const r = locateQuoteSpeaker([
    t('Joshua Pinner', 'So tell me where you are with all this today.'),
    t('Leonard', 'Honestly I am struggling to get residents in.'),
  ], 'Honestly I am struggling to get residents in.');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.speakerName, 'Leonard');
});

test('quote STITCHED across consecutive turns resolves to whoever opened it', () => {
  // Real shape: "…but my dad's got cancer." + "I just found out." The quote
  // begins mid-turn, so a fixed 8-word anchor refused this real CLOSER moment.
  const r = locateQuoteSpeaker([
    t('Joshua Pinner', 'Everything should be fine, but my dad\'s got cancer.'),
    t('Joshua Pinner', 'I just found out.'),
    t('Leonard', 'Oh man, I am so sorry.'),
  ], "my dad's got cancer. I just found out.");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.speakerName, 'Joshua Pinner');
});

test('THE UNSOUND-MATCH TRAP: a short unrelated turn inside the quote must not win', () => {
  // The old locator accepted "turn text sits inside quote", so this early
  // "Yeah, I'm in." by the closer captured a long prospect quote and flipped
  // its attribution. It produced 5 wrong labels on live data.
  const turns = [
    t('Joshua Pinner', "Yeah, I'm in."),                                    // decoy, earlier in the call
    t('Leonard', "I'm in. Looks like I'm in, yeah, I can see the portal."),
  ];
  const r = locateQuoteSpeaker(turns, "I'm in. Looks like I'm in, yeah, I can see the portal.");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.speakerName, 'Leonard', 'must attribute to the speaker who actually said the whole quote');
});

test('AMBIGUOUS — two speakers can each produce the quote → refuse', () => {
  // Live case: closer and prospect both say this on the same call.
  const r = locateQuoteSpeaker([
    t('Joshua Pinner', "I don't care if you're a multi millionaire, honestly."),
    t('Josh', "I don't care if you're a multi millionaire, honestly."),
  ], "I don't care if you're a multi millionaire, honestly.");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous');
});

test('quote that appears nowhere → refuse, never a guess', () => {
  const r = locateQuoteSpeaker([
    t('Joshua Pinner', 'Tell me about your situation.'),
    t('Leonard', 'It has been a hard year.'),
  ], 'Let me walk you through the pricing options we offer.');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_reconstructible');
});

test('paraphrased / reworded quote → refuse rather than approximate', () => {
  const r = locateQuoteSpeaker([
    t('Leonard', 'I am really struggling to fill the beds right now honestly.'),
  ], 'The prospect said he cannot fill his beds');
  assert.strictEqual(r.ok, false);
});

test('too-short quote is refused rather than matched loosely', () => {
  const r = locateQuoteSpeaker([t('Leonard', 'Yeah absolutely, for sure.')], 'Yeah');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'quote_too_short');
});

test('empty / malformed input never throws', () => {
  assert.strictEqual(locateQuoteSpeaker(null, 'anything at all here').ok, false);
  assert.strictEqual(locateQuoteSpeaker([], 'anything at all here').ok, false);
  assert.strictEqual(locateQuoteSpeaker([t('A', null)], 'anything at all here').ok, false);
  assert.strictEqual(locateQuoteSpeaker([t('A', 'text here')], null).ok, false);
});

test('punctuation and casing differences do not defeat reconstruction', () => {
  const r = locateQuoteSpeaker([
    t('Leonard', "Well — I THINK the cost, the barrier, to get in... that's it."),
  ], 'i think the cost the barrier to get in');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.speakerName, 'Leonard');
});

test('mixed flag is set when the quote spans more than one speaker', () => {
  const r = locateQuoteSpeaker([
    t('Leonard', 'So moving forward, would you be sending us'),
    t('Joshua Pinner', 'like an email or something like that?'),
  ], 'So moving forward, would you be sending us like an email or something like that?');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.speakerName, 'Leonard');
  assert.strictEqual(r.mixed, true);
});

// ─── labelForQuote: role resolution against matched turns ──────────────────

test('labelForQuote returns the ROLE on already-labelled turns', () => {
  const turns = [
    { display_name: 'Joshua Pinner', speaker: 'CLOSER', text: 'What are you hoping to fix here?' },
    { display_name: 'Leonard', speaker: 'PROSPECT', text: 'I need to fill six beds by spring.' },
  ];
  assert.strictEqual(labelForQuote(turns, 'I need to fill six beds by spring.'), 'PROSPECT');
  assert.strictEqual(labelForQuote(turns, 'What are you hoping to fix here?'), 'CLOSER');
});

test('labelForQuote returns null when it cannot attribute — callers must not default', () => {
  const turns = [{ display_name: 'Leonard', speaker: 'PROSPECT', text: 'Short.' }];
  assert.strictEqual(labelForQuote(turns, 'Something never said on this call at all'), null);
});
