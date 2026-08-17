/**
 * 12a — ranking the five sections of the sales process (Justin's spec).
 * "I just wanna know what part of the ENTIRE sales process needs work, not just
 * objections."
 *
 * ⚠⚠ CLOSE MUST BE READ FROM close_score_earned. Migration 027 forces the
 * DISPLAYED close score to 100 on closed calls. Measured on Josh's last 30 days:
 * displayed close = 64.6 (ranks 2nd BEST of five) vs earned = 57.2 (ranks 2nd
 * WORST). Reading the wrong column does not error, does not look wrong, and
 * inverts the answer the whole card exists to give. This trap is already
 * recorded twice in CLAUDE.md; this is the third surface it applies to.
 *
 * ⚠ THE "LEVEL" GATE IS NOT THEORETICAL — it fires on Josh's real data TWICE:
 *     intro 57.2 (n=149)  vs  close 57.2 (n=136)   → gap 0.0
 *     pitch 64.5 (n=140)  vs  objection 64.6 (n=127) → gap 0.1
 * Without it the card would confidently name a 2nd-worst section on a 0.0-point
 * difference, and that ordering would flip on the next call analysed.
 */
const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/section-ranking');

// Josh, last 30 days — the real measured numbers.
const JOSH = {
  discovery: { mean: 46.7, n: 144, sd: 14.8 },
  intro:     { mean: 57.2, n: 149, sd: 16.9 },
  close:     { mean: 57.2, n: 136, sd: 20.5 },
  pitch:     { mean: 64.5, n: 140, sd: 17.5 },
  objection: { mean: 64.6, n: 127, sd: 8.6 },
};

test('the five sections rank WORST FIRST', () => {
  const r = R.rankSections(JOSH);
  assert.deepStrictEqual(r.map((s) => s.section),
    ['discovery', 'intro', 'close', 'pitch', 'objection']);
  assert.strictEqual(r[0].rank, 1, 'rank 1 is the weakest — the card leads with it');
  assert.strictEqual(r[4].rank, 5);
  assert.strictEqual(r.length, 5, 'always five cards: the whole sales process');
});

test('each entry carries its score, sample size and the gap to the next', () => {
  const r = R.rankSections(JOSH);
  assert.strictEqual(r[0].section, 'discovery');
  assert.strictEqual(r[0].score, 47, 'rounded only for display');
  assert.strictEqual(r[0].n, 144);
  assert.strictEqual(r[0].gapToNext, 10.5, 'discovery → intro');
  assert.strictEqual(r[4].gapToNext, null, 'the strongest section has nothing after it');
});

test('⚠ DISCOVERY IS GENUINELY WORST — separated well beyond noise', () => {
  const r = R.rankSections(JOSH);
  assert.strictEqual(r[0].levelWithNext, false,
    'a 10.5-point gap on n≈145 is a real difference, not a coin flip');
});

test('⚠ THE TWO REAL TIES ARE REPORTED AS LEVEL, NOT RANKED CONFIDENTLY', () => {
  const r = R.rankSections(JOSH);
  const intro = r.find((s) => s.section === 'intro');
  const pitch = r.find((s) => s.section === 'pitch');
  assert.strictEqual(intro.levelWithNext, true, 'intro 57.2 vs close 57.2 — gap 0.0');
  assert.strictEqual(pitch.levelWithNext, true, 'pitch 64.5 vs objection 64.6 — gap 0.1');
});

test('the gate SCALES WITH SAMPLE SIZE — it is computed, not hard-coded', () => {
  // The same 4-point gap is real on 150 calls and meaningless on 12. A fixed
  // threshold would be wrong at one end or the other; this is why the gate is
  // derived from the standard error of each mean.
  const big = R.rankSections({
    discovery: { mean: 50, n: 150, sd: 15 }, intro: { mean: 54, n: 150, sd: 15 },
    close: { mean: 70, n: 150, sd: 15 }, pitch: { mean: 80, n: 150, sd: 15 },
    objection: { mean: 90, n: 150, sd: 15 },
  });
  const small = R.rankSections({
    discovery: { mean: 50, n: 12, sd: 15 }, intro: { mean: 54, n: 12, sd: 15 },
    close: { mean: 70, n: 12, sd: 15 }, pitch: { mean: 80, n: 12, sd: 15 },
    objection: { mean: 90, n: 12, sd: 15 },
  });
  assert.strictEqual(big[0].levelWithNext, false, '4 points on n=150 is separable');
  assert.strictEqual(small[0].levelWithNext, true, 'the same 4 points on n=12 is not');
});

test('a section with too few calls is UNRANKED, not ranked at zero', () => {
  const r = R.rankSections(Object.assign({}, JOSH, { pitch: { mean: 64.5, n: 3, sd: 17 } }));
  const pitch = r.find((s) => s.section === 'pitch');
  assert.strictEqual(pitch.enough, false);
  assert.strictEqual(pitch.rank, null, 'it holds no position in the order');
  assert.ok(/only 3 calls/.test(pitch.reason), pitch.reason);
  // and the ranked ones still number 1..4 without a hole
  const ranked = r.filter((s) => s.enough).map((s) => s.rank);
  assert.deepStrictEqual(ranked, [1, 2, 3, 4]);
});

test('unranked sections sort AFTER ranked ones, never interleaved', () => {
  const r = R.rankSections(Object.assign({}, JOSH, { discovery: { mean: 20, n: 2, sd: 10 } }));
  const enough = r.map((s) => s.enough);
  assert.deepStrictEqual(enough, [true, true, true, true, false],
    'a 20-point section on n=2 must not lead the card just because the number is low');
});

test('missing or malformed input never throws', () => {
  [null, undefined, {}, { intro: null }, { intro: { mean: 'x', n: 5 } }].forEach(function (s) {
    const r = R.rankSections(s);
    assert.ok(Array.isArray(r) && r.length === 5, JSON.stringify(s));
    assert.ok(r.every((x) => x.enough === false));
  });
});

// ── the column trap ───────────────────────────────────────────────────────
test('⚠⚠ sectionStatsFromAnalyses READS close_score_earned, NEVER close_score', () => {
  const rows = [
    { intro_score: 60, discovery_score: 40, pitch_score: 70, objection_score: 65, close_score: 100, close_score_earned: 50 },
    { intro_score: 50, discovery_score: 44, pitch_score: 66, objection_score: 63, close_score: 100, close_score_earned: 54 },
  ];
  const s = R.sectionStatsFromAnalyses(rows);
  assert.strictEqual(s.close.mean, 52, 'the EARNED mean — reading close_score would give 100');
  assert.strictEqual(s.close.n, 2);
  assert.strictEqual(s.discovery.mean, 42);
});

test('the earned column is what makes close rank 2nd WORST rather than 2nd BEST', () => {
  // Josh's real 30-day numbers, both ways. This is the whole reason the rule
  // exists, so it is asserted rather than left in a comment.
  const earned = R.rankSections(JOSH).map((x) => x.section);
  const displayed = R.rankSections(Object.assign({}, JOSH, { close: { mean: 64.6, n: 138, sd: 26.7 } }))
    .map((x) => x.section);
  assert.strictEqual(earned.indexOf('close'), 2, 'earned → 3rd from worst (2nd-worst band)');
  assert.strictEqual(displayed.indexOf('close'), 4, 'displayed → last, i.e. the BEST section');
});

test('a null section score is skipped, never counted as zero', () => {
  const s = R.sectionStatsFromAnalyses([
    { intro_score: 60, discovery_score: null, close_score_earned: 50 },
    { intro_score: 50, discovery_score: 40, close_score_earned: null },
  ]);
  assert.strictEqual(s.discovery.n, 1);
  assert.strictEqual(s.discovery.mean, 40, 'not 20 — a missing grade is absent, not a zero');
  assert.strictEqual(s.close.n, 1);
});

test('the ruled constants are the existing ones', () => {
  const { _MIN_ANALYZED } = require('../lib/team-needs-work');
  assert.strictEqual(R.MIN_CALLS_TO_RANK, _MIN_ANALYZED,
    '"enough calls to say anything" must not have two answers');
  assert.strictEqual(R.CONFIDENCE_Z, 1.96);
  assert.deepStrictEqual(R.SECTION_ORDER, ['intro', 'discovery', 'pitch', 'objection', 'close']);
});
