// lib/prospect-merge.js — merge PROPOSALS for human review (3d-2).
//
// Stakes: close rate is closed prospects / total prospects, so every unmerged
// duplicate moves the headline number. But a WRONG merge silently fuses two
// people and is invisible in the aggregate — so this file proposes and NEVER
// decides. Confirmed on live data: the title generator proposed
// "Mark-Anthony ~ Forb", and that call's own summary said Forb "got routed into
// the wrong Zoom meeting". Only a human could catch that.
const test = require('node:test');
const assert = require('node:assert');
const { generateCandidates, MERGE_REASONS } = require('../lib/prospect-merge');

const P = (id, name, calls) => ({ id, display_name: name, calls: calls || [] });
const C = (title, date, outcome) => ({ title, call_date: date, outcome });

test('proposes on name containment (Lemoine ~ Lemoine Richmond)', () => {
  const c = generateCandidates([P('a', 'Lemoine'), P('b', 'Lemoine Richmond')]);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].reason, 'name');
});

test('proposes on initial+surname (L. Williams ~ Lisa Williams)', () => {
  const c = generateCandidates([P('a', 'L. Williams'), P('b', 'Lisa Williams')]);
  assert.strictEqual(c.length, 1);
});

test('proposes on a shared DISTINCTIVE meeting title even when names disagree', () => {
  // The Mark-Anthony/Forb class: no name-based rule can join these, and the
  // title is the only signal that they share a booked slot.
  const t = 'PS Sober Living Riches | Mark-Anthony Rassmann';
  const c = generateCandidates([
    P('a', 'Mark-Anthony', [C(t, '2026-07-30', 'follow_up')]),
    P('b', 'Forb', [C(t, '2026-07-29', 'follow_up')]),
  ]);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].reason, 'title');
});

test('a GENERIC title is NOT a key — this is what stops a combinatorial explosion', () => {
  // Live: many calls share "Impromptu Zoom Meeting". Treating it as a key
  // cross-matched 7 unrelated prospects into 18 junk proposals.
  const t = 'Impromptu Zoom Meeting';
  const c = generateCandidates([
    P('a', 'Katina Goss', [C(t, '2026-07-01', 'closed')]),
    P('b', 'Eli Leifer', [C(t, '2026-07-02', 'follow_up')]),
    P('c', 'bopha', [C(t, '2026-07-03', 'follow_up')]),
  ]);
  assert.deepStrictEqual(c, []);
});

test('never proposes a prospect against itself, and never duplicates a pair', () => {
  const c = generateCandidates([P('a', 'Sam'), P('b', 'Sam Walker'), P('c', 'Sam')]);
  const pairs = c.map((x) => [x.a.id, x.b.id].sort().join('|'));
  assert.strictEqual(new Set(pairs).size, pairs.length, 'duplicate pair proposed');
  assert.ok(!c.some((x) => x.a.id === x.b.id));
});

test('does NOT propose two clearly different people', () => {
  assert.deepStrictEqual(generateCandidates([P('a', 'Jane Smith'), P('b', 'John Smith')]), []);
  assert.deepStrictEqual(generateCandidates([P('a', 'Katina Goss'), P('b', 'Eli Leifer')]), []);
});

test('EXCLUDES already-merged prospects from proposals', () => {
  const merged = P('b', 'Lemoine Richmond'); merged.merged_into = 'a';
  assert.deepStrictEqual(generateCandidates([P('a', 'Lemoine'), merged]), []);
});

test('every proposal carries the EVIDENCE a human needs to decide', () => {
  const t = 'PS Sober Living Riches | Sam Walker';
  const c = generateCandidates([
    P('a', 'Sam', [C(t, '2026-07-29', 'follow_up')]),
    P('b', 'Sam Walker', [C(t, '2026-07-29', 'closed')]),
  ]);
  const x = c[0];
  // Without these the reviewer is guessing — and a wrong merge is invisible later.
  assert.ok(x.a.display_name && x.b.display_name);
  assert.ok(Array.isArray(x.a.calls) && x.a.calls.length);
  assert.ok(MERGE_REASONS.indexOf(x.reason) !== -1);
  assert.ok(typeof x.rate_impact === 'object', 'must state what the merge does to the close rate');
});

test('rate_impact reports the real effect, including when it LOWERS the rate', () => {
  // closed+closed merges DROP the numerator. Learned the hard way: an earlier
  // estimate assumed merges only shrink the denominator and was wrong.
  const both = generateCandidates([
    P('a', 'Lemoine', [C('t1', '2026-07-26', 'closed')]),
    P('b', 'Lemoine Richmond', [C('t2', '2026-07-26', 'closed')]),
  ])[0];
  assert.strictEqual(both.rate_impact.closed_delta, -1);
  assert.strictEqual(both.rate_impact.total_delta, -1);

  const openClosed = generateCandidates([
    P('a', 'Sam', [C('t1', '2026-07-29', 'follow_up')]),
    P('b', 'Sam Walker', [C('t2', '2026-07-29', 'closed')]),
  ])[0];
  assert.strictEqual(openClosed.rate_impact.closed_delta, 0);
  assert.strictEqual(openClosed.rate_impact.total_delta, -1);
});

test('generateCandidates is total on junk input', () => {
  for (const v of [null, undefined, [], 'nope', [null], [{}]]) {
    assert.ok(Array.isArray(generateCandidates(v)));
  }
});
