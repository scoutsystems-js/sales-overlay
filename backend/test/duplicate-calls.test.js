/**
 * CROSS-PROVIDER DUPLICATES — Fathom and Zoom recording the same meeting.
 *
 * ⚠⚠ THE GOVERNING TRADE: a FALSE POSITIVE destroys a real call silently; a
 * false negative only leaves a count too high, which is visible and reversible.
 * Every threshold here is chosen for that asymmetry, and the known false pair
 * from Josh's live data is a test case rather than a footnote.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const D = require('../lib/duplicate-calls');

const U = 'josh';
function call(id, source, iso, dur, user) {
  return { id, source, call_date: iso, duration_seconds: dur, user_id: user || U };
}

/* ── real pairs from production, quoted exactly ───────────────────────────── */

const REAL_PAIRS = [
  ['2026-08-24T18:01:49Z', 3000, '2026-08-24T18:02:25Z', 2997],  // 99%
  ['2026-08-24T20:01:48Z', 3120, '2026-08-24T20:02:25Z', 3088],  // 99%
  ['2026-08-24T17:02:50Z', 240,  '2026-08-24T17:03:59Z', 228],   // 71% — the LOWEST genuine
  ['2026-08-24T22:03:58Z', 1860, '2026-08-24T22:04:42Z', 1850],  // 98%
];

test('⚠⚠ EVERY GENUINE PAIR FROM PRODUCTION IS MATCHED — including the weakest', () => {
  REAL_PAIRS.forEach(([zs, zd, fs, fd], i) => {
    const z = call('z' + i, 'zoom', zs, zd);
    const f = call('f' + i, 'fathom', fs, fd);
    assert.strictEqual(D.isDuplicatePair(z, f), true,
      'pair ' + i + ' (overlap ' + Math.round(D.overlapRatio(z, f) * 100) + '%) must match');
  });
});

test('⚠⚠ THE KNOWN FALSE PAIR IS REJECTED — two different meetings back to back', () => {
  /* Live data, quoted with the real ORDER: a 5-minute Fathom call ending at
     23:06:55, then a 49-minute Zoom call starting 84s later at 23:08:19 —
     starts 379s apart, ZERO shared time. Two different meetings back to back.
     ⚠ My first version of this fixture had the sign reversed, which put the
     short call INSIDE the long one and made it overlap 10%. The direction
     matters, so the real timestamps are used rather than reconstructed ones.
     It is rejected TWICE — by the start gap AND by the overlap. */
  const f = call('f', 'fathom', '2026-08-21T23:02:00Z', 295);
  const z = call('z', 'zoom', '2026-08-21T23:08:19Z', 2940);
  assert.strictEqual(D.overlapRatio(f, z), 0, 'they share no time at all');
  assert.strictEqual(D.isDuplicatePair(f, z), false);
});

test('⚠⚠ BACK-TO-BACK CALLS OF SIMILAR LENGTH NEVER MERGE', () => {
  /* The nightmare case: two real 30-minute calls, the second starting the
     moment the first ends. Similar duration, close in time — and NOT the same
     meeting. Zero overlap is what saves it. */
  const a = call('a', 'zoom', '2026-08-24T10:00:00Z', 1800);
  const b = call('b', 'fathom', '2026-08-24T10:30:00Z', 1800);
  assert.strictEqual(D.isDuplicatePair(a, b), false,
    'consecutive calls share no time and must never be treated as one');
});

test('⚠ SAME USER ONLY — two closers on one meeting is not a duplicate', () => {
  const a = call('a', 'zoom', '2026-08-24T18:01:49Z', 3000, 'josh');
  const b = call('b', 'fathom', '2026-08-24T18:02:25Z', 2997, 'someone-else');
  assert.strictEqual(D.isDuplicatePair(a, b), false,
    'merging them would delete one closer\'s record of their own call');
});

test('⚠ SAME SOURCE IS NEVER A DUPLICATE — the unique key already prevents that', () => {
  const a = call('a', 'zoom', '2026-08-24T18:01:49Z', 3000);
  const b = call('b', 'zoom', '2026-08-24T18:02:25Z', 2997);
  assert.strictEqual(D.isDuplicatePair(a, b), false,
    'two rows from ONE provider are two real calls, not one meeting twice');
});

test('⚠ A ZERO-LENGTH ROW CANNOT BE MATCHED ON TIME', () => {
  const a = call('a', 'zoom', '2026-08-24T22:03:58Z', 0);
  const b = call('b', 'fathom', '2026-08-24T22:04:42Z', 1850);
  assert.strictEqual(D.isDuplicatePair(a, b), false,
    'a 0s recording overlaps nothing; guessing from the start time alone is how '
    + 'a false positive gets in');
});

/* ── the preference must be flippable ─────────────────────────────────────── */

test('⚠⚠ FATHOM WINS TODAY — as an ORDERED PREFERENCE, not a verdict on Zoom', () => {
  const z = call('z', 'zoom', '2026-08-24T18:01:49Z', 3000);
  const f = call('f', 'fathom', '2026-08-24T18:02:25Z', 2997);
  const plan = D.planDuplicates([z, f]);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].id, 'z', 'the Zoom copy is suppressed');
  assert.strictEqual(plan[0].duplicate_of, 'f', 'and points at the Fathom row that is kept');

  /* Justin intends Zoom to REPLACE Fathom. Re-ordering this list must be the
     whole change — if anything else has to move, the preference has been baked
     into a branch somewhere and this test is the place that catches it. */
  assert.deepStrictEqual(D.SOURCE_PREFERENCE, ['fathom', 'zoom'],
    'the preference is a list, so flipping it is a one-line edit');
});

test('⚠⚠ ONE CALL WITH TWO CANDIDATES TAKES ITS BEST MATCH, AND ONLY ONE', () => {
  /* This happens live: one Fathom call matched both a 6-minute and a 49-minute
     Zoom row. Suppressing both would delete a real call. */
  const f = call('f', 'fathom', '2026-08-21T23:02:00Z', 295);
  const good = call('zgood', 'zoom', '2026-08-21T23:00:20Z', 360);
  const bad = call('zbad', 'zoom', '2026-08-21T23:08:19Z', 2940);
  const plan = D.planDuplicates([f, good, bad]);
  assert.strictEqual(plan.length, 1, 'exactly one row is suppressed, not two');
  assert.strictEqual(plan[0].id, 'zgood');
  assert.ok(plan.every((p) => p.id !== 'zbad'), 'the unrelated long call survives');
});

test('⚠ A SUPPRESSED ROW IS NEVER REUSED AS A TARGET — no chains', () => {
  const a = call('a', 'zoom', '2026-08-24T18:01:49Z', 3000);
  const b = call('b', 'fathom', '2026-08-24T18:02:25Z', 2997);
  const c = call('c', 'zoom', '2026-08-24T18:02:30Z', 2990);
  const plan = D.planDuplicates([a, b, c]);
  const dropped = plan.map((p) => p.id);
  assert.ok(dropped.indexOf('b') === -1, 'the survivor must not itself be suppressed');
  plan.forEach((p) => assert.ok(dropped.indexOf(p.duplicate_of) === -1,
    'a suppressed row must never be the target of another suppression'));
});

test('the thresholds sit in the empty band measured on real data', () => {
  assert.strictEqual(D.MAX_START_GAP_SECONDS, 300, 'genuine gaps ran 18-254s; the false pair was 379s');
  assert.ok(D.MIN_OVERLAP_RATIO > 0.42 && D.MIN_OVERLAP_RATIO < 0.71,
    'the threshold must sit between the ambiguous 42% case and the weakest genuine 71% one');
});

test('degenerate input never throws', () => {
  [null, undefined, [], [null], 'x'].forEach((v) => assert.ok(Array.isArray(D.planDuplicates(v))));
  assert.strictEqual(D.isDuplicatePair(null, null), false);
  assert.strictEqual(D.overlapRatio({}, {}), 0);
});
