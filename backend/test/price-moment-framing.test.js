/**
 * ⚠⚠ TIME TO PRICE WITHOUT A STORED PRICE (2026-08-31, Justin's ruling twice).
 * The old finder ran only when a rep had saved price_pif — 2 of 13 ever did,
 * both the same person — so every other rep had ZERO moments and the graph drew
 * one line. The discriminator was never the number: it is total-framing
 * language (85% of real first-mentions vs 0-1% of round decoys).
 *
 * Measured against the stored lookup as ground truth over 120 real calls:
 * 109 exact, 6 within 60s, 0 DIFFERENT, 5 missed. The failure mode is a null,
 * never a wrong minute.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findPriceMomentByFraming, moneyCandidates } = require('../lib/price-moment');

const t = (speaker, text, s) => ({ speaker, text, start_seconds: s });

test('finds a framed total with no price supplied', () => {
  const r = findPriceMomentByFraming([
    t('CLOSER', 'So it is $9,800 for everything, one time.', 1800),
  ]);
  assert.strictEqual(r.seconds, 1800);
  assert.strictEqual(r.price, 9800);
});

test('an unframed money mention is NOT a price', () => {
  // the decoys the header names: market rates, grants, a document's cost
  assert.strictEqual(findPriceMomentByFraming([
    t('CLOSER', 'Most people are paying $30,000 for a document like that.', 600),
  ]), null);
});

test('⚠⚠ RULE A SURVIVES — a figure the prospect named first is a continuation', () => {
  const r = findPriceMomentByFraming([
    t('PROSPECT', "What's the total? I think it's $9,800?", 100),
    t('CLOSER', 'The $9,800, for everything.', 106),
  ]);
  assert.strictEqual(r, null, 'the closer is answering, not dropping a price');
});

/* ⚠⚠ REGRESSION 1 — MY OWN DISCOUNT EXCLUSION COST FOUR REAL PRICES.
   A turn-level /\b(off|discount|save)\b/ looked reasonable and killed exactly
   the moment it should find, because closers state the FULL price when they
   mention a discount. It also matched "tax write-OFF". */
test('a discount mentioned in the same breath must not hide the price', () => {
  ['If you wanted to pay the entire thing, the total price was $9,800 before the discount.',
   "It was $9,800 for everything, but we're doing a discount right now for $1,000 off.",
   'We are a tax write-off, and the one-time investment is $9,800 for everything.',
  ].forEach((line) => {
    const r = findPriceMomentByFraming([t('CLOSER', line, 2400)]);
    assert.ok(r, 'must still find the price in: ' + line.slice(0, 40));
    assert.strictEqual(r.price, 9800, 'and must take the TOTAL, not the discount: ' + line.slice(0, 40));
  });
});

/* ⚠⚠ REGRESSION 2 — A NEGATED PERIOD PHRASE CONFIRMS A TOTAL, IT DOES NOT DENY IT.
   "that's not per year" was firing the instalment exclusion. */
test('"not per year" is a total, not an instalment', () => {
  const r = findPriceMomentByFraming([
    t('CLOSER', "The one-time price was $9,800 one time. That's not per property, that's not per year.", 2280),
  ]);
  assert.ok(r && r.price === 9800, 'a negated period phrase must not exclude the turn');
});

test('a genuine instalment is still excluded', () => {
  assert.strictEqual(findPriceMomentByFraming([
    t('CLOSER', 'I see anywhere between $300 to $500 a month, $500 being the average for the total.', 2760),
  ]), null);
});

test('the largest surviving candidate wins — a discount is smaller than the price', () => {
  const r = findPriceMomentByFraming([
    t('CLOSER', '$9,800 for the whole thing, minus $1,000.', 1200),
  ]);
  assert.strictEqual(r.price, 9800);
});

test('candidates are bounded, and a bare count is not money', () => {
  assert.deepStrictEqual(moneyCandidates('only 300 of them'), []);           // below the floor
  assert.deepStrictEqual(moneyCandidates('a $2,000,000 portfolio'), []);     // above the ceiling
  assert.ok(moneyCandidates('$9,800').indexOf(9800) !== -1);
});

test('malformed input is total, never thrown on', () => {
  [null, undefined, [], [{}], [{ speaker: 'CLOSER' }]].forEach((x) =>
    assert.strictEqual(findPriceMomentByFraming(x), null));
});
