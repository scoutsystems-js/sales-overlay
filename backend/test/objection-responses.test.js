/**
 * 6e — recover the closer's objection handling.
 *
 * An objection highlight is the PROSPECT's row; the closer's reply sits in the
 * `closer_response` field. So the rep's best objection work never reaches a
 * CLOSER-speaker filter, and the objection section renders with 1 moment while
 * 257 responses sit in the data.
 *
 * The field name is not evidence. Measured: of 53 responses that reconstruct
 * from the transcript, 3 were actually spoken by the PROSPECT. So a response is
 * shown as the rep's words ONLY when closer_response_verified is true, which
 * means reconstructed AND spoken by the closer.
 *
 * The pairing is the point: the prospect's objection is already on the same
 * row, so it becomes exact context — not the nearest-preceding guess 6d needs
 * for ordinary moments.
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildSectionBreakdown } = require('../lib/section-breakdown');

const META = { c1: { prospect_name: 'Leonard', recording_url: 'https://fathom.video/calls/1', call_date: '2026-08-01T10:00:00Z' } };

function objection(over) {
  return Object.assign({
    id: 'h1', fathom_call_id: 'c1', section: 'objection', type: 'objection',
    speaker: 'PROSPECT', speaker_verified: true,
    quote: 'Nine thousand eight hundred is a lot of money for me right now',
    closer_response: 'What would it cost you to still be empty in six months?',
    closer_response_verified: true,
    resolution: 'handled', observation: 'o', timestamp_seconds: 100,
  }, over);
}

const build = (hs) => buildSectionBreakdown('objection', { analyses: [], highlights: hs, callMeta: META });

test('a PROVEN, HANDLED closer response becomes one of the rep\'s own moments', () => {
  const out = build([objection()]);
  assert.strictEqual(out.closer_moments.length, 1);
  const m = out.closer_moments[0];
  assert.strictEqual(m.quote, 'What would it cost you to still be empty in six months?');
  assert.strictEqual(m.speaker, 'CLOSER');
});

test('the prospect\'s objection is attached as EXACT context, from the same row', () => {
  const m = build([objection()]).closer_moments[0];
  assert.ok(m.context);
  assert.strictEqual(m.context.quote, 'Nine thousand eight hundred is a lot of money for me right now');
  assert.strictEqual(m.context.speaker, 'PROSPECT');
});

test('an UNPROVEN response is excluded and counted, never shown as the rep\'s', () => {
  const out = build([objection({ closer_response_verified: false })]);
  assert.strictEqual(out.closer_moments.length, 0);
  assert.strictEqual(out.closer_counts.hidden_unverified, 1);
});

test('a response that reconstructed to the PROSPECT is excluded', () => {
  // Live: 3 of 53 did exactly this. The field is named closer_response and was
  // still the prospect talking.
  const out = build([objection({ closer_response_verified: false })]);
  assert.strictEqual(out.closer_moments.length, 0);
});

test('a NEVER-ASSESSED response is excluded as unassessed, not as unprovable', () => {
  const out = build([objection({ closer_response_verified: null })]);
  assert.strictEqual(out.closer_moments.length, 0);
  assert.strictEqual(out.closer_counts.hidden_unassessed, 1);
  assert.strictEqual(out.closer_counts.hidden_unverified, 0);
});

test('an UNHANDLED objection is not presented as something that worked', () => {
  ['partial', 'unhandled'].forEach(function (res) {
    const out = build([objection({ resolution: res })]);
    assert.strictEqual(out.closer_moments.length, 0, res + ' must not appear in the closer lane');
  });
});

test('a missing or blank response produces nothing and is not counted as hidden', () => {
  [null, '', '   '].forEach(function (val) {
    const out = build([objection({ closer_response: val })]);
    assert.strictEqual(out.closer_moments.length, 0);
    assert.strictEqual(out.closer_counts.hidden_unverified, 0, 'no response is not a withheld response');
    assert.strictEqual(out.closer_counts.hidden_unassessed, 0);
  });
});

test('the objection row itself still appears in the ordinary groups, unchanged', () => {
  // 6e ADDS a lane. The prospect's objection is still a moment in its own right.
  const out = build([objection({ resolution: 'unhandled' })]);
  assert.strictEqual(out.bad.length, 1, 'unhandled objection belongs in What to fix');
  assert.strictEqual(out.closer_moments.length, 0);
});

test('a response moment carries the clip link and stays linked to its call', () => {
  const m = build([objection()]).closer_moments[0];
  assert.strictEqual(m.fathom_call_id, 'c1');
  assert.ok(String(m.clip_url).indexOf('t=100') !== -1);
});

test('response moments and ordinary closer moments coexist in one lane', () => {
  const out = build([
    objection(),
    { id: 'h2', fathom_call_id: 'c1', section: 'objection', type: 'strong_moment',
      speaker: 'CLOSER', speaker_verified: true, quote: 'A plain closer moment',
      observation: 'o', timestamp_seconds: 300 },
  ]);
  assert.strictEqual(out.closer_moments.length, 2);
  assert.strictEqual(out.closer_counts.verified, 2);
});

test('a response is not double-counted as its own row\'s speaker verdict', () => {
  // The row's `speaker` is the PROSPECT and its speaker_verified refers to the
  // OBJECTION quote, not the response. Mixing them would let a proven prospect
  // line smuggle an unproven response onto the screen.
  const out = build([objection({ speaker_verified: true, closer_response_verified: false })]);
  assert.strictEqual(out.closer_moments.length, 0);
});
