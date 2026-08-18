/**
 * ITEM (j) — the price-drop moment.
 *
 * ⚠ THE FIXTURES ARE VERBATIM FROM REAL CALLS, hand-read 2026-08-18 across five
 * of Josh's closed calls over 20 minutes. Every quote below was typed from the
 * transcript, not invented — including the decoys, which is the point: a made-up
 * decoy would be easy to reject and the real ones are not.
 */
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/price-moment');

const PRICE = 9800;   // Josh's real price_pif

// ── the four real moments, verbatim ───────────────────────────────────────
const CORY = "But the one-time investment, the one way to go about it, not yearly, not subscription, like just one time, for all of the services, including that 30K document, everything I told you about was $9,800 for the whole thing.";
const NATE = "The total price to work with us was $9,800, the total price for everything, all the services, everything I explained.";
const ANTHONY = "But the regular price, if you want to just pay at one time, was $9,800 for the entire thing, one time ever, for all the documents, everything, all the coaching, all the stuff we talked about.";
const DAMIEN_A = "And it was $9,800.";
const DAMIEN_B = "So one time ever, 9,800.";

// ── real decoys from the same calls ───────────────────────────────────────
const DECOYS = [
  "So I don't think a single property went for under $3 million.",
  "And they came in here with like a 580 credit score and $5,000 in their bank account.",
  "just to give you an example for your area, Minnesota, we're looking at anywhere between $600 to $800 per bed",
  "Andrew's got a property where he's doing $6,000 per bed every month, 18 beds in that property",
  "So it's doing like $110,000 a month off of one property.",
  "Andrew got an $800,000 grant two months ago to buy a property cash in California.",
  "We spent about $30,000 developing this document over the years with our legal team.",
  "I got some students doing $16,000 a month off four-bedroom properties.",
  "I've been negative $150 on that one property because they're just good tenants.",
  "But yeah, we have a ton of finance options where it might be anywhere between $300 a month to $500 a month",
];

const turn = (speaker, text, secs) => ({ speaker: speaker, text: text, start_seconds: secs });

test('⚠ the price regex matches the written forms and NOT neighbouring numbers', () => {
  const re = P.priceRegex(9800);
  ['$9,800', '9,800', '9800', '$9800', 'was $9,800 for'].forEach((s) => {
    assert.ok(re.test(s), 'should match: ' + s);
  });
  // The lookarounds are what make these fail — they are different numbers and
  // all three appear on real calls.
  ['19800', '98000', '$19,800', '1.9800'].forEach((s) => {
    assert.ok(!re.test(s), 'must NOT match: ' + s);
  });
  assert.strictEqual(P.priceRegex(0), null);
  assert.strictEqual(P.priceRegex(null), null);
  assert.strictEqual(P.priceRegex('abc'), null);
});

test('the four REAL moments are all found', () => {
  [CORY, NATE, ANTHONY].forEach((line) => {
    const m = P.findPriceMoment([turn('CLOSER', line, 2000)], PRICE);
    assert.ok(m, 'not found: ' + line.slice(0, 50));
    assert.strictEqual(m.seconds, 2000);
  });
});

test('⚠ the number in its own short turn is found via the NEXT closer turn', () => {
  // Damien, verbatim: the framing and the figure are in DIFFERENT turns, 0.4s
  // apart. Same-turn-only would miss this real moment.
  const alone = P.findPriceMoment([turn('CLOSER', DAMIEN_A, 2262)], PRICE);
  assert.strictEqual(alone, null, 'unframed on its own must not qualify');
  const paired = P.findPriceMoment([
    turn('CLOSER', DAMIEN_A, 2262), turn('CLOSER', DAMIEN_B, 2286),
  ], PRICE);
  assert.ok(paired, 'the following closer turn supplies the framing');
  assert.strictEqual(paired.seconds, 2262, 'and the moment is the FIRST turn, not the framing one');
});

test('⚠⚠ NO REAL DECOY is ever returned', () => {
  DECOYS.forEach((line) => {
    const m = P.findPriceMoment([turn('CLOSER', line, 600)], PRICE);
    assert.strictEqual(m, null, 'decoy matched: ' + line.slice(0, 60));
  });
  // and a whole call of decoys followed by the real line returns the real one
  const turns = DECOYS.map((l, i) => turn('CLOSER', l, 100 + i * 60))
    .concat([turn('CLOSER', NATE, 2568)]);
  const m = P.findPriceMoment(turns, PRICE);
  assert.ok(m);
  assert.strictEqual(m.seconds, 2568, 'must skip every decoy and land on the price');
});

test('⚠ FIRST closer occurrence — later re-references and prospect echoes lose', () => {
  const turns = [
    turn('PROSPECT', 'So how much is it?', 2500),
    turn('CLOSER', NATE, 2568),                                                     // the drop
    turn('CLOSER', 'your payments on $9,800 is like $100 a month, one-time', 2586), // re-reference
    turn('PROSPECT', 'I think it is just trying to process the whole 9800', 4146),  // echo
    turn('PROSPECT', "Yeah, so now it's saying pay total $9,800.", 5310),           // echo
  ];
  const m = P.findPriceMoment(turns, PRICE);
  assert.strictEqual(m.seconds, 2568);
});

test('⚠⚠ RULE A — the PROSPECT saying it FIRST means no drop happened here', () => {
  // Ruled 2026-08-18. If the prospect states the figure before the closer, the
  // closer is ANSWERING A QUESTION on a continuation call, not dropping a price.
  // Both fixtures are verbatim from hand-verified failures.
  const damienStyle = [
    turn('PROSPECT', "What is the total amount that way I know what I'm working It was the $9,800.", 234),
    turn('CLOSER', 'The $9,800.', 240),
    turn('CLOSER', 'For all of the services, lifetime, for the documentation, everything, one time.', 246),
  ];
  assert.strictEqual(P.findPriceMoment(damienStyle, PRICE), null,
    'the closer confirming a price the prospect already named is not a drop');

  const guessStyle = [
    turn('PROSPECT', "I think it's $9,800 or $10,000, I think you guys charge?", 336),
    turn('CLOSER', "It's $9,800 for all our services, but it's one time.", 342),
  ];
  assert.strictEqual(P.findPriceMoment(guessStyle, PRICE), null);

  // ⚠ AND IT MUST NOT OVER-FIRE: a prospect echoing the price AFTER the drop is
  // the normal case and must leave the moment intact.
  const normal = [
    turn('CLOSER', NATE, 2568),
    turn('PROSPECT', 'So $9,800, and when is that due?', 2600),
  ];
  assert.strictEqual(P.findPriceMoment(normal, PRICE).seconds, 2568);

  // a prospect alone is nothing at all
  assert.strictEqual(P.findPriceMoment([damienStyle[0]], PRICE), null);
});

test('⚠ THE KNOWN RESIDUAL — "again" without the figure still gets through', () => {
  // Recorded rather than papered over (ruling: no time floor). The prospect asks
  // for the total "again" but never names it, so nothing in the transcript marks
  // the price as already known. Exactly one call in 124 has this shape.
  const residual = [
    turn('PROSPECT', 'And the total amount, again, is?', 72),
    turn('CLOSER', 'To work with us, the one-time investment was $9,800 for everything.', 78),
  ];
  const m = P.findPriceMoment(residual, PRICE);
  assert.ok(m, 'this one is NOT caught — the rule keys on the figure, not on "again"');
  assert.strictEqual(m.seconds, 78);
});

test('⚠⚠ ROUND-PRICE COLLISION is handled by the framing requirement', () => {
  // A seller priced at $5,000 or $10,000 collides with decoys that exist on
  // these very calls. Measured corpus-wide, a round decoy carries total-framing
  // 0-1% of the time against the real price's 85% — so requiring the framing
  // makes the collision self-limiting rather than needing a special rule.
  const bank = turn('CLOSER', "they came in here with a 580 credit score and $5,000 in their bank account", 700);
  const furniture = turn('CLOSER', "We are not going to encourage you to dump $10,000 in one day on furniture.", 1188);
  assert.strictEqual(P.findPriceMoment([bank], 5000), null, '$5,000 in the bank is not a price');
  assert.strictEqual(P.findPriceMoment([furniture], 10000), null, '$10,000 of furniture is not a price');
  // but a genuinely round price, framed as the total, IS found
  const real = turn('CLOSER', "The total price to work with us was $5,000 for everything, one time.", 2100);
  assert.strictEqual(P.findPriceMoment([bank, real], 5000).seconds, 2100);
});

test('⚠ NULL is expected and correct — ~1 in 5 closed calls has no price moment', () => {
  // Hand-read: a closed call whose own pitch_notes read "No pitch occurred."
  // It contains zero occurrences of the price, from either speaker.
  const noPitch = [
    turn('CLOSER', "It's all noise. I don't want you all to do really anything until you meet with your specialist.", 2047),
    turn('CLOSER', "I've been negative $150 on that one property because they're just good tenants.", 1038),
  ];
  assert.strictEqual(P.findPriceMoment(noPitch, PRICE), null);
  assert.ok(P.EXPECTED_NULL_SHARE_CLOSED > 0,
    'the expected null rate must be recorded, so gaps are not read as breakage');
});

test('a turn with no timestamp cannot be the moment', () => {
  const t = { speaker: 'CLOSER', text: NATE };            // no start_seconds
  assert.strictEqual(P.findPriceMoment([t], PRICE), null);
});

test('malformed input never throws', () => {
  [null, undefined, [], [null], [{}], [{ speaker: 'CLOSER' }]].forEach((x) => {
    assert.doesNotThrow(() => P.findPriceMoment(Array.isArray(x) ? x : [], PRICE));
  });
  [null, undefined, 0, -5, NaN, 'x'].forEach((p) => {
    assert.strictEqual(P.findPriceMoment([turn('CLOSER', NATE, 10)], p), null, String(p));
  });
});

test('the quote is carried, trimmed and bounded', () => {
  const m = P.findPriceMoment([turn('CLOSER', '   ' + ANTHONY + '   ', 1986)], PRICE);
  assert.strictEqual(m.quote, ANTHONY);
  const long = P.findPriceMoment([turn('CLOSER', NATE + ' ' + 'x'.repeat(900), 10)], PRICE);
  assert.ok(long.quote.length <= 400, 'quote must be bounded: ' + long.quote.length);
});
