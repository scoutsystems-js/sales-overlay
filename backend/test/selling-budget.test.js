// lib/selling-budget.js — per-lane allocation of the grader's selling-context
// character budget.
//
// The bug this exists to prevent, measured on live data: the offer document's
// first chunk took 3,348 of the 5,000 budget, the script's first chunk needed
// ~3,000 and didn't fit, so ALL 14,721 characters of the script were dropped
// silently. Uploading a script appeared to do nothing.
const test = require('node:test');
const assert = require('node:assert');
const { allocate, usableProfileField, chunkForContext } = require('../lib/selling-budget');

const lane = (key, priority, reserve, chunks) => ({ key, priority, reserve, chunks });
const chars = (n) => 'x'.repeat(n);

// ── The regression that motivated this ───────────────────────────────────
test('a long offer can NO LONGER starve the script', () => {
  const out = allocate([
    lane('offer', 2, 900, [chars(3348)]),
    lane('script', 3, 1500, [chars(1200), chars(1200), chars(1200)]),
  ], 5000);
  assert.ok(out.script.length > 0, 'script must receive an allocation');
  assert.ok(out.offer.length > 0, 'offer must still be included');
});

test('the qualifying criteria ALWAYS land — they are tiny and the highest-value item', () => {
  // "10k saved, not living paycheck to paycheck, 640 or above credit score"
  const quals = chars(69);
  const out = allocate([
    lane('qualifications', 1, 600, [quals]),
    lane('offer', 2, 900, [chars(4000)]),
    lane('script', 3, 1500, [chars(4000)]),
  ], 5000);
  assert.strictEqual(out.qualifications.length, 1, 'criteria must never be crowded out');
});

test('priority order decides who fills first when the budget is tight', () => {
  const out = allocate([
    lane('qualifications', 1, 600, [chars(100)]),
    lane('offer', 2, 900, [chars(900)]),
    lane('script', 3, 1500, [chars(1500)]),
    lane('kb', 4, 1500, [chars(1500)]),
  ], 2000);
  assert.strictEqual(out.qualifications.length, 1);
  assert.strictEqual(out.offer.length, 1);
  assert.strictEqual(out.kb.length, 0, 'the lowest-priority lane yields when the budget runs out');
});

// ── Reserves are minimums, not caps ──────────────────────────────────────
test('an EMPTY lane frees its reserve for the others', () => {
  const out = allocate([
    lane('qualifications', 1, 600, []),          // nothing stored
    lane('offer', 2, 900, []),                    // nothing stored
    lane('script', 3, 1500, [chars(1000), chars(1000), chars(1000), chars(1000)]),
  ], 5000);
  assert.ok(out.script.length >= 4, 'script should absorb the freed reserves, got ' + out.script.length);
});

test('leftover budget is redistributed, not wasted', () => {
  const out = allocate([
    lane('offer', 2, 900, [chars(200)]),          // uses far less than its reserve
    lane('script', 3, 1500, [chars(800), chars(800), chars(800), chars(800), chars(800)]),
  ], 5000);
  const used = 200 + out.script.length * 800;
  assert.ok(used > 4000, 'should use most of the budget, used ' + used);
});

// ── Whole chunks only ────────────────────────────────────────────────────
test('never emits a partial chunk', () => {
  const out = allocate([lane('script', 3, 1500, [chars(1200), chars(1200), chars(1200)])], 2500);
  out.script.forEach((c) => assert.strictEqual(c.length, 1200));
  assert.strictEqual(out.script.length, 2, 'two whole chunks fit in 2500, not two-and-a-bit');
});

test('a chunk larger than the whole budget is skipped, not truncated', () => {
  const out = allocate([lane('script', 3, 1500, [chars(9000)])], 5000);
  assert.strictEqual(out.script.length, 0);
});

test('allocate is total on junk input', () => {
  for (const v of [null, undefined, [], 'nope', [null], [{}]]) {
    assert.strictEqual(typeof allocate(v, 5000), 'object');
  }
  assert.deepStrictEqual(allocate([lane('a', 1, 100, [chars(10)])], 0), { a: [] });
});

// ── Profile-field substance guard ────────────────────────────────────────
test('rejects demo junk that would otherwise become selling context', () => {
  // Live values in user_profiles.offer for the demo accounts.
  for (const junk of ['Ava', 'Ben', 'Cara', '', '   ', null, undefined, 'x']) {
    assert.strictEqual(usableProfileField(junk), false, 'must reject: ' + JSON.stringify(junk));
  }
});

test('accepts genuine but short offer text', () => {
  // justinschmidtsales@gmail.com has exactly this, 26 chars. Thin but real.
  assert.strictEqual(usableProfileField('6 month real estate course'), true);
  assert.strictEqual(usableProfileField('10k saved, not living paycheck to paycheck, 640 or above credit score'), true);
});

// ── Context chunking ─────────────────────────────────────────────────────
test('chunkForContext splits long text into allocatable pieces', () => {
  const long = new Array(2000).fill('word').join(' ');   // ~10k chars
  const cs = chunkForContext(long);
  assert.ok(cs.length > 1, 'a 10k-char script must split');
  // Small enough that a lane reserve can actually take one.
  cs.forEach((c) => assert.ok(c.length < 1600, 'chunk too big to allocate: ' + c.length));
});

test('chunkForContext leaves short text as a single chunk', () => {
  assert.deepStrictEqual(chunkForContext('short offer text'), ['short offer text']);
  assert.deepStrictEqual(chunkForContext(''), []);
  assert.deepStrictEqual(chunkForContext(null), []);
});
