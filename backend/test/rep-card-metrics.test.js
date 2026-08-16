/**
 * 10c-1 — the two derivations the rep cards need that nothing computed before.
 *
 * Both are PURE and carry no model call. The card's other four fields already
 * come from computeTeamAnalytics.
 *
 * ⚠ WEAKEST SECTION READS close_score_earned, NOT close_score. Migration 027
 * forces the DISPLAYED close score to 100 on closed calls; the section drilldown
 * already reads the earned column for exactly this reason, but team-analytics
 * selected the inflated one. On live data it flips a result at the margin.
 *
 * ⚠ A TEAM RANKING NEEDS A TEAM. "Lowest on the team" is stated only when ≥3 reps
 * have ≥6 objections in that category (consistent with MIN_BUCKET = 6). Measured
 * live, exactly ONE rep clears that today — a ranking off n=1 reads as a finding
 * and means nothing.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  weakestSection, weakestObjection, sortRepsWorstFirst,
  MIN_CATEGORY_OBJECTIONS, MIN_REPS_FOR_RANKING,
} = require('../lib/rep-card-metrics');

// ── weakest section ───────────────────────────────────────────────────────

test('the weakest section is the lowest score, named with its value', () => {
  const w = weakestSection({ intro: 57, discovery: 47, pitch: 65, objection: 64, close: 57 });
  assert.deepStrictEqual(w, { section: 'discovery', score: 47 });
});

test('a section with no score is SKIPPED, not treated as zero', () => {
  // A rep with no scored objection calls must not be told objection is their
  // weakest area at 0.
  const w = weakestSection({ intro: 57, discovery: 61, pitch: 65, objection: null, close: 58 });
  assert.strictEqual(w.section, 'intro');
});

test('no scored sections at all returns null rather than inventing one', () => {
  assert.strictEqual(weakestSection({}), null);
  assert.strictEqual(weakestSection(null), null);
  assert.strictEqual(weakestSection({ intro: null, discovery: null }), null);
});

test('ties resolve deterministically, so the card does not flicker between loads', () => {
  const a = weakestSection({ intro: 58, discovery: 58, pitch: 65, objection: 70, close: 71 });
  const b = weakestSection({ close: 71, objection: 70, pitch: 65, discovery: 58, intro: 58 });
  assert.strictEqual(a.section, b.section, 'key order must not change the answer');
});

// ── weakest objection + the team ranking rule ─────────────────────────────

const cat = (total, handled) => ({ total: total, handled: handled });

test('the weakest objection is the lowest handle rate among categories with volume', () => {
  const w = weakestObjection(
    { fear: cat(47, 8), timing: cat(42, 3), partner: cat(27, 2), logistical: cat(16, 4) }, {});
  assert.strictEqual(w.category, 'timing');
  assert.strictEqual(w.rate, 7);            // 3/42
  assert.strictEqual(w.handled, 3);
  assert.strictEqual(w.total, 42);
});

test('a thin category cannot be called the weakest', () => {
  // 0 of 2 is 0%, and naming it would coach a rep on two moments.
  const w = weakestObjection({ fear: cat(20, 5), timing: cat(2, 0) }, {});
  assert.strictEqual(w.category, 'fear', 'timing has too little volume to judge');
  assert.ok(MIN_CATEGORY_OBJECTIONS >= 4, 'threshold must be meaningful: ' + MIN_CATEGORY_OBJECTIONS);
});

test('no category with volume returns null, not a shrug dressed as a finding', () => {
  assert.strictEqual(weakestObjection({ fear: cat(2, 0), timing: cat(1, 0) }, {}), null);
  assert.strictEqual(weakestObjection({}, {}), null);
  assert.strictEqual(weakestObjection(null, null), null);
});

test('THE RANKING IS SUPPRESSED unless ≥3 reps have ≥6 objections in that category', () => {
  // The live shape: one rep with real volume, everyone else with a handful.
  const teamThin = { timing: { reps_with_volume: 1, total: 42, handled: 3 } };
  const w = weakestObjection({ timing: cat(42, 3) }, teamThin);
  assert.strictEqual(w.comparable, false, 'n=1 is not a team');
  assert.strictEqual(w.is_lowest, null, 'and no ranking may be asserted');
  assert.strictEqual(w.team_rate, null);
  assert.strictEqual(w.rate, 7, 'the rep\'s own rate is still reported, with counts');
});

test('with enough reps the comparison IS stated, and correctly', () => {
  const team = { timing: { reps_with_volume: 3, total: 60, handled: 12, lowest_rate: 7 } };
  const w = weakestObjection({ timing: cat(42, 3) }, team);
  assert.strictEqual(w.comparable, true);
  assert.strictEqual(w.team_rate, 20, '12/60');
  assert.strictEqual(w.is_lowest, true, 'this rep holds the lowest rate');
});

test('a rep who is NOT lowest is not told they are', () => {
  const team = { timing: { reps_with_volume: 3, total: 60, handled: 12, lowest_rate: 2 } };
  const w = weakestObjection({ timing: cat(42, 3) }, team);
  assert.strictEqual(w.comparable, true);
  assert.strictEqual(w.is_lowest, false);
});

test('the thresholds are the documented ones', () => {
  assert.strictEqual(MIN_CATEGORY_OBJECTIONS, 6, 'consistent with MIN_BUCKET');
  assert.strictEqual(MIN_REPS_FOR_RANKING, 3);
});

// ── sort: worst first ─────────────────────────────────────────────────────

test('reps sort by closing rate ASCENDING — worst first', () => {
  const out = sortRepsWorstFirst([
    { display_name: 'A', prospect_close_rate: 40, prospect_close_total: 10 },
    { display_name: 'B', prospect_close_rate: 12, prospect_close_total: 8 },
    { display_name: 'C', prospect_close_rate: 25, prospect_close_total: 4 },
  ]);
  assert.deepStrictEqual(out.map((r) => r.display_name), ['B', 'C', 'A']);
});

test('A REP WITH NO PROSPECTS GOES LAST — unmeasured is not worst', () => {
  const out = sortRepsWorstFirst([
    { display_name: 'none', prospect_close_rate: null, prospect_close_total: 0 },
    { display_name: 'worst', prospect_close_rate: 10, prospect_close_total: 10 },
    { display_name: 'best', prospect_close_rate: 90, prospect_close_total: 10 },
  ]);
  assert.deepStrictEqual(out.map((r) => r.display_name), ['worst', 'best', 'none']);
});

test('a genuine 0% is WORST, not unmeasured — the distinction that matters', () => {
  const out = sortRepsWorstFirst([
    { display_name: 'unmeasured', prospect_close_rate: null, prospect_close_total: 0 },
    { display_name: 'zero', prospect_close_rate: 0, prospect_close_total: 7 },
    { display_name: 'ok', prospect_close_rate: 30, prospect_close_total: 7 },
  ]);
  assert.deepStrictEqual(out.map((r) => r.display_name), ['zero', 'ok', 'unmeasured']);
});

test('ties break on name so the order is stable across loads', () => {
  const out = sortRepsWorstFirst([
    { display_name: 'Zoe', prospect_close_rate: 20, prospect_close_total: 5 },
    { display_name: 'Ada', prospect_close_rate: 20, prospect_close_total: 5 },
  ]);
  assert.deepStrictEqual(out.map((r) => r.display_name), ['Ada', 'Zoe']);
});

test('sorting does not mutate the caller\'s array', () => {
  const input = [{ display_name: 'A', prospect_close_rate: 40, prospect_close_total: 1 },
                 { display_name: 'B', prospect_close_rate: 10, prospect_close_total: 1 }];
  const copy = input.slice();
  sortRepsWorstFirst(input);
  assert.deepStrictEqual(input, copy, 'the team overview reuses this array');
});

test('malformed input degrades instead of throwing', () => {
  assert.deepStrictEqual(sortRepsWorstFirst(null), []);
  assert.deepStrictEqual(sortRepsWorstFirst(undefined), []);
});
