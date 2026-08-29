/**
 * ALWAYS SHOW WHAT NEEDS WORK (Justin, 2026-08-20).
 *
 * His words: "even if there's multiple things that rank as bad, so it
 * technically is correct that there's not a SINGLE thing that needs work, it
 * actually means multiple — I still want to see what needs work and why."
 *
 * ⚠⚠ MEASURED ON JOSH'S REAL DATA FIRST, AND IT MOVED THE DIAGNOSIS. He is NOT
 * hitting `insufficient` on any window (7/14/30/90 all return `rate_gap`). What
 * he is hitting is `candidates[0]` DROPPING THE REST:
 *     90d  Needs time / not ready  7/60 (12%)  gapPP 10.4   shown
 *          Spouse / partner        4/38 (11%)  gapPP  9.7   DROPPED
 *     30d  Needs to think / review 2/24 ( 8%)  gapPP 11.2   shown
 *          Spouse / Partner        4/35 (11%)  gapPP  8.3   DROPPED
 * A 0.7pp near-tie presented as "your weakest area" — the same family as the
 * rounding lesson: taking [0] of a near-tie and reporting it as a winner.
 *
 * ⚠ THE THREE-STATE CONFLATION IS ALSO REAL and is fixed here, but it is a
 * latent defect for Josh rather than the thing he is looking at.
 *
 * ⚠⚠ NO THRESHOLD MOVED. MIN_GAP_PP and minBucket are untouched — the fix is
 * showing the ranking, not lowering the bar. A threshold tuned until the output
 * looks better is not a threshold.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const nw = require('../lib/team-needs-work');

/**
 * ⚠ THE FIXTURE SHAPE IS COPIED FROM THE PRODUCER'S OWN CONTRACT, not invented.
 * The header of team-needs-work.js states it exactly:
 *   objs:     [{ call_id, surface, handled:boolean, ... }]
 *   analyses: [{ fathom_call_id, outcome, cash_collected }]   (done rows only)
 *   mapping:  { <NORMALIZED SURFACE>: <bucket label> }
 * My first draft keyed the mapping on an invented `id` and used
 * `{resolution, outcome}` on the objection — the invented-fixture failure this
 * project has already paid for once. It threw before reaching the code
 * under test, which is the good version of being wrong.
 */
function mk(buckets, analyzedCount) {
  const objs = [];
  const mapping = {};
  let n = 0;
  Object.keys(buckets).forEach(function (label) {
    const b = buckets[label];
    // one distinct surface phrase per bucket, mapped to that bucket's label
    const surface = label.toLowerCase();
    mapping[surface] = label;
    for (let i = 0; i < b.total; i++) {
      objs.push({ call_id: 'c' + (n % Math.max(1, analyzedCount)),
                  surface: surface,
                  handled: i < b.handled });
      n++;
    }
  });
  const analyses = [];
  for (let i = 0; i < analyzedCount; i++) {
    analyses.push({ fathom_call_id: 'c' + i, outcome: 'lost', cash_collected: 0 });
  }
  return { objs: objs, analyses: analyses, mapping: mapping };
}

const OPTS = { subject: 'personal', minBucket: nw._PERSONAL_MIN_BUCKET,
               minAnalyzed: nw._PERSONAL_MIN_ANALYZED, windowDays: 30 };

test('⚠⚠ (a) NO VOLUME is its own state — a fact about the WINDOW, not the rep', () => {
  const f = mk({}, 0);
  const r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, OPTS);
  assert.strictEqual(r.state, 'no_volume',
    'the volume gate must not share a state with "nothing stands out"');
  assert.ok(/window|range|selected|yet/i.test(r.card_text),
    'it must read as a fact about the window, not a verdict on the rep');
});

test('⚠⚠ (c) THIN TYPES is its own state — enough calls, no single type big enough', () => {
  // plenty of calls and objections, but every bucket is under minBucket
  const f = mk({ 'Price / too expensive': { total: 3, handled: 1 },
                 'Spouse / partner approval': { total: 3, handled: 1 },
                 'Trust / proof': { total: 2, handled: 1 } }, 60);
  const r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, OPTS);
  assert.strictEqual(r.state, 'thin_types',
    'enough calls overall but no ONE type big enough is a THIRD case — it is ' +
    'neither "nothing can be said" nor "nothing stands out"');
  /* ⚠ CONVERTED: thin types must no longer report the DECLINED COMPARISON.
     It names the most common type and its rate instead — even one objection
     is data (Justin, 2026-08-29). */
  assert.ok(/The most common is/i.test(r.card_text),
    'it must name the most common type rather than decline to compare');
  assert.ok(!/enough volume|to rank|to compare/i.test(r.card_text),
    'a declined comparison must not be reported as the finding');
  assert.ok(!/stands out/i.test(r.card_text),
    'it must not claim performance is even — nothing was actually compared');
});

test('⚠⚠ (b) EVEN PERFORMANCE is a FINDING, and it still shows the ranking', () => {
  // big buckets, near-identical rates — nothing clears MIN_GAP_PP
  const f = mk({ 'Price / too expensive': { total: 20, handled: 6 },
                 'Spouse / partner approval': { total: 20, handled: 6 },
                 'Trust / proof': { total: 20, handled: 6 } }, 60);
  const r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, OPTS);
  assert.strictEqual(r.state, 'even_performance', 'a real, positive finding');
  assert.ok(!/not enough|keep logging|wider range/i.test(r.card_text),
    'even performance must NOT render as a shortage');
  /* ⚠ CONVERTED 2026-08-29, not deleted. The property still holds — this is a
     RESULT, not a shortage — but the wording no longer cites the threshold
     ("no type is more than N points below your average"), which described our
     own bar rather than the rep. It now states the finding and its evidence. */
  assert.ok(/running level across types/i.test(r.card_text),
    'wording states the result: handling is running level across types');
  /* ⚠ Two valid evidence forms: the contrast, or — when the rates are EQUAL
     after rounding — a plain statement of the level rate, because contrasting
     a number with itself reads as a mistake. */
  assert.ok(/The lowest is .+ at \d+%, against \d+% everywhere else/.test(r.card_text)
            || /Every type is close to \d+%/.test(r.card_text),
    'it must state the evidence for the claim: ' + r.card_text);
  assert.ok(!/points below|average|baseline/i.test(r.card_text),
    'the threshold and the "average" mechanism must not return to customer copy');
  // ⚠ Justin still wants to see the ranking
  assert.ok(Array.isArray(r.detail.ranking) && r.detail.ranking.length >= 3,
    'the ranking is shown even when nothing is a standout');
  assert.ok(r.detail.ranking.every(function (x) { return typeof x.gapPP === 'number'; }),
    'each row states its gap so a reader can see how much worse it is');
});

test('⚠⚠ MORE THAN ONE IS SURFACED WHEN MORE THAN ONE QUALIFIES', () => {
  /* Josh's real 90-day shape: two candidates 0.7pp apart. The old code took
     candidates[0] and dropped the rest, so the second was invisible. */
  /* ⚠ JOSH'S ACTUAL 90-DAY BUCKETS, all six — totals 137 objections / 24
     handled, which is what the live endpoint returns. A first draft used only
     the top three and produced `even_performance`, because DROPPING BUCKETS
     MOVES THE BASELINE: each bucket's gap is measured against every OTHER
     objection, so a partial fixture measures a different question. */
  const f = mk({ 'Needs time / not ready':      { total: 60, handled: 7 },
                 'Spouse / partner approval':   { total: 38, handled: 4 },
                 'Price / too expensive':       { total: 14, handled: 4 },
                 'Trust / proof / skepticism':  { total: 10, handled: 3 },
                 'Timing / external dependency':{ total:  8, handled: 2 },
                 'Financing / credit concerns': { total:  7, handled: 4 } }, 202);
  const r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, OPTS);
  assert.strictEqual(r.state, 'rate_gap');
  assert.ok(Array.isArray(r.detail.focus_set), 'a focus SET, not a single winner');
  assert.ok(r.detail.focus_set.length >= 2,
    'both near-tied weaknesses must be surfaced, not just the top one');
  assert.ok(r.detail.focus_set.length <= nw._MAX_FOCUS,
    'and capped, so the panel cannot become a list of everything');
  // the primary is still the biggest gap
  assert.ok(r.detail.focus_set[0].gapPP >= r.detail.focus_set[1].gapPP, 'ranked by gap');
});

test('⚠⚠ NO THRESHOLD WAS MOVED — the fix is the ranking, not the bar', () => {
  assert.strictEqual(nw._MIN_GAP_PP, 5, 'MIN_GAP_PP unchanged');
  assert.strictEqual(nw._MIN_BUCKET, 6, 'MIN_BUCKET unchanged');
  assert.strictEqual(nw._PERSONAL_MIN_BUCKET, 4, 'PERSONAL_MIN_BUCKET unchanged');
});

test('⚠ the three states are DISTINCT — none of them is "insufficient"', () => {
  const seen = {};
  [[mk({}, 0), 'no_volume'],
   [mk({ 'A': { total: 3, handled: 1 }, 'B': { total: 2, handled: 1 } }, 60), 'thin_types'],
   [mk({ 'A': { total: 20, handled: 6 }, 'B': { total: 20, handled: 6 } }, 60), 'even_performance'],
  ].forEach(function (pair) {
    const r = nw._computeNeedsWork(pair[0].objs, pair[0].analyses, pair[0].mapping, OPTS);
    assert.strictEqual(r.state, pair[1]);
    assert.notStrictEqual(r.state, 'insufficient',
      'the shared state is what made "no weakness" and "nothing could be ' +
      'classified" indistinguishable');
    seen[r.state] = true;
  });
  assert.strictEqual(Object.keys(seen).length, 3, 'three genuinely distinct states');
});
