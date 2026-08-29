const test = require('node:test');
const assert = require('node:assert');
const { _bucketMaxTokens } = require('../lib/team-needs-work');

/* ⚠⚠ THE OUTPUT CAP MUST SCALE WITH THE NUMBER OF PHRASES.
   The model has to ECHO BACK every distinct objection phrase inside its JSON,
   so the output cost grows with the board. A FIXED cap becomes unsatisfiable
   the moment a company grows, and the failure is total: the response truncates
   mid-JSON, does not parse, and the panel shows an error.

   Measured on the live Sober Living board 2026-08-28 (373 distinct phrases):
     cap 1500 -> output 1500, stop_reason=max_tokens, DOES NOT PARSE
     cap 8000 -> output 3637, stop_reason=end_turn,   parses
   ~10 output tokens per phrase, so the old fixed 1500 covered ~150 phrases and
   had been impossible to satisfy on that board for some time. */

const MEASURED_TOKENS_PER_PHRASE = 10;   // live measurement, 2026-08-28

test('⚠⚠ the cap covers the MEASURED cost at every board size', () => {
  [10, 75, 150, 373, 600, 1000].forEach((n) => {
    const cap = _bucketMaxTokens(n);
    const needed = n * MEASURED_TOKENS_PER_PHRASE;
    // Below the ceiling the cap must clear the measured need with headroom.
    if (cap < 16000) {
      assert.ok(cap >= needed, n + ' phrases need ~' + needed + ' tokens, cap is ' + cap);
    }
  });
});

test('the 373-phrase board that actually failed is now covered', () => {
  // The exact case Justin saw. 1500 could never have satisfied it.
  const cap = _bucketMaxTokens(373);
  assert.ok(cap > 3637, 'must exceed the 3637 tokens measured as actually needed, got ' + cap);
  assert.ok(1500 < 3637, 'sanity: the OLD fixed cap was below the measured need');
});

test('a floor keeps small boards cheap, and a ceiling keeps it sane', () => {
  assert.strictEqual(_bucketMaxTokens(0), 1500, 'no phrases: the floor, not zero');
  assert.strictEqual(_bucketMaxTokens(1), 1500, 'one phrase must not ask for 20 tokens');
  assert.ok(_bucketMaxTokens(100000) <= 16000, 'a runaway board must not request an absurd cap');
});

test('⚠ the cap is DERIVED, not a bigger fixed number', () => {
  // The failure this replaces was a constant. If someone "fixes" a future
  // truncation by editing one number again, this fails.
  assert.notStrictEqual(_bucketMaxTokens(10), _bucketMaxTokens(1000),
    'the cap must be a function of the phrase count, not a constant');
});

test('⚠⚠ truncation is logged DISTINCTLY from unparseable junk', () => {
  // They used to reach the same branch, so a cap that had grown too small was
  // indistinguishable from a model returning nonsense — and only one of those
  // is fixed by changing a number.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-needs-work.js'), 'utf8');
  const live = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/stop_reason === 'max_tokens'/.test(live), 'must detect truncation explicitly');
  assert.ok(/TRUNCATED at the output cap/.test(src), 'and say so in the log');
});
