/* Guards for the four approved renames, the description on every metric, and the
   minutes hole. See CLAUDE.md 2026-09-01. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/widget-catalog.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* line comments FIRST, then block: a `/*` inside a `//` line is a false opener
   that pairs with the next real closer and swallows everything between. */
const CODE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const TA = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-analytics.js'), 'utf8');

test('⚠ the four approved renames, and the three Justin kept are untouched', () => {
  const want = {
    avg_score: 'Average call grade', calls_analyzed: 'Calls graded',
    prospects: 'People talked to',   time_to_price: 'Minutes to price',
    /* ⚠ HE RULED ON 3, 5, 6 AND 7 ONLY. These three keep their names — a rename
       sweep that "finishes the job" is a change he did not ask for. */
    closing_rate: 'Closing rate', objection_handle_rate: 'Objection handling rate',
    avg_call_time: 'Average call time',
  };
  Object.keys(want).forEach((k) => assert.strictEqual(C.byKey(k).label, want[k], k));
  /* the KEYS never move — they are join keys for the layout store, DASH_UNIT,
     DASH_CANVAS and every stored board. A rename is a label change. */
  ['avg_score', 'calls_analyzed', 'prospects', 'time_to_price']
    .forEach((k) => assert.ok(C.byKey(k), 'the key must survive a rename: ' + k));
});

test('⚠⚠ EVERY metric carries a description, and it carries its UNIT', () => {
  /* ⚠ THE DESCRIPTION IS THE PART THAT ANSWERED THE COMPLAINT. "I don't know
     what those metrics do" is not fixed by a better name — a manager placing a
     card needs the numerator, the denominator and the unit. A manager hearing
     "grade" asks "out of what?", so the description must carry the 100. */
  const UNIT = /percent|minutes|count|out of 100|breakdown/i;
  assert.ok(C._CATALOG.length >= 10, 'non-vacuity: the catalog must not be empty');
  C._CATALOG.forEach((m) => {
    assert.ok(m.description && m.description.length > 20, m.key + ' has no description');
    if (m.person) return;   // a PERSON entry (the rep card, 2026-09-02) is not a quantity and has no unit
    assert.ok(UNIT.test(m.description), m.key + ' description states no unit: ' + m.description);
  });
  // and it reaches the browser, or none of the above is visible to anyone
  assert.ok(C._PUBLIC_FIELDS.indexOf('description') !== -1, 'description must be on the wire');
  assert.ok(/m\.description/.test(CODE), 'and the picker must render it');
});

test('⚠⚠⚠ both minute metrics get a NUMBER; only the RULED one gets a ranking', () => {
  /* ⚠⚠ THE ASYMMETRY IS A RULING, NOT AN OVERSIGHT. A number states a value and
     implies no ordering. A ranked list or a bar chart asserts better-and-worse,
     and nobody has ruled whether a faster time to price is better — with no
     direction it would sort SLOWEST FIRST and the longest bar would read as the
     best rep. A wrong direction has no wrong number, so nothing would look off. */
  /* ⚠⚠ CONVERTED 2026-09-01 — `time_to_price` IS RANKED NOW, and the reason is
     exactly the one this test recorded. It was refused because it had NEITHER a
     direction NOR a band, so a ranked list would have sorted slowest-first with
     the longest bar reading as the best rep. IT NOW HAS A BAND: Justin ruled the
     late edge ("if you're price dropping after 45 min you're moving slow") and
     the early edge came from the coverage table. THE SUBJECT SURVIVES: a ranked
     view is offered only where the ORDER IS WELL DEFINED — by a direction or by
     a band — and never by default. */
  assert.deepStrictEqual(C._viewsFor(C.byKey('avg_call_time')),
    ['number', 'gauge', 'trend', 'by_rep', 'bar_rep']);
  assert.deepStrictEqual(C._viewsFor(C.byKey('time_to_price')),
    ['number', 'trend', 'by_rep', 'bar_rep']);

  const BAND = require('../lib/metric-band.js');
  ['avg_call_time', 'time_to_price'].forEach((k) => {
    const m = C.byKey(k);
    assert.ok(BAND.bandFor(k), k + ' is ranked, so its order must be defined by a band');
    assert.ok(!m.targetDirection || !BAND.bandFor(k) === false,
      k + ' must not be judged by a direction AND a band');
  });

  // and the page half: both rankable, and every row states its side
  const rank = CODE.slice(CODE.indexOf('function dashRepRanking'), CODE.indexOf('function dashRepNote'));
  assert.ok(rank.length > 300 && rank.length < 5000, 'slice: ' + rank.length);
  assert.ok(/avg_call_time: function \(r\)/.test(rank) && /time_to_price: function \(r\)/.test(rank),
    'both minute metrics must be rankable now that both have a band');
  assert.ok(/x\.side = /.test(rank) && /b\.dist - a\.dist/.test(rank),
    'a banded metric ranks by DISTANCE and every row carries its SIDE — distance '
    + 'alone puts a rep who rushes next to one who rambles with nothing saying which');
});

test('⚠⚠ ONE unit table, every card builder — no builder inlines its own', () => {
  /* Units have been the fault twice in this catalog. The by-rep list and the bar
     chart already read DASH_UNIT; the number card inlined '%' on two branches. */
  const num = CODE.slice(CODE.indexOf('function dashNumberHtml'), CODE.indexOf('function dashGaugeHtml'));
  assert.ok(num.length > 400 && num.length < 4000, 'slice: ' + num.length);
  assert.ok(/DASH_UNIT\[card\.metric\]/.test(num), 'the number card must read the unit table');
  assert.ok(!/\+ '%'/.test(num), 'and must not inline a unit of its own');

  // every offerable metric has an entry, bare or not — an ABSENT entry and a
  // deliberately bare one are indistinguishable unless the decision is written down
  const tbl = CODE.slice(CODE.indexOf('var DASH_UNIT = {'), CODE.indexOf('};', CODE.indexOf('var DASH_UNIT = {')));
  C._CATALOG.filter((m) => C._viewsFor(m).length && !m.person).forEach((m) => {   // a person entry draws no number, so it has no unit
    assert.ok(new RegExp(m.key + ':').test(tbl), m.key + ' has no DASH_UNIT entry');
  });

  /* ⚠ `breakdown` AND `bar_cat` STILL INLINE '%', and that is safe ONLY while
     they are renderable for percent metrics alone. Asserted rather than assumed,
     so the day a count-based breakdown arrives this fails instead of rendering
     "12%" over a count. */
  ['breakdown', 'bar_cat'].forEach((v) => {
    C._RENDERABLE[v].forEach((k) => {
      assert.ok(/percent/i.test(C.byKey(k).description),
        v + ' inlines a percent sign, so ' + k + ' must be a percent metric');
    });
  });
});

test('⚠⚠ the minute totals mirror rep-series EXACTLY — the card and the line agree', () => {
  /* ⚠ A NUMBER CARD AND THE GRAPH BESIDE IT MUST NOT DISAGREE ABOUT THE SAME
     WORD. A zero-length call is excluded, not averaged in; a NULL price moment is
     excluded, never counted as zero (~1 in 5 closed calls has no price drop). */
  /* ⚠ ANCHORED ON THE CLAIM, NOT ON A VARIABLE NAME — a rename is free and
     must not turn a guard red while the property it protects is untouched. */
  assert.ok(/duration_seconds/.test(TA), 'the duration must be fetched');
  assert.ok(/price_stated_at_seconds/.test(TA), 'the price moment must be fetched');
  assert.ok(/=== 'number' && \w+ > 0\) \{ r\.dur_sum/.test(TA),
    'a zero-length call must be excluded, not averaged in');
  assert.ok(/isFinite\(\w+\)\) \{ r\.price_sum/.test(TA),
    'a NULL price moment must be excluded, never counted as zero');
  // both accumulate inside the ANALYSES loop, so both count GRADED calls
  const loop = TA.slice(TA.indexOf('doneCallIds.push'), TA.indexOf('for (var j = 0'));
  assert.ok(loop.length > 400, 'slice: ' + loop.length);
  assert.ok(/r\.dur_sum \+=/.test(loop) && /r\.price_sum \+=/.test(loop),
    'both must accumulate on graded calls — "calls graded", not "calls synced"');
  // and the team figure is POOLED, not a mean of per-rep means
  assert.ok(/t\.dur_sum \+= c\.dur_sum/.test(TA) && /t\.price_sum \+= c\.price_sum/.test(TA),
    'the team figure must pool the counts, or it disagrees with the counts printed under it');
});
