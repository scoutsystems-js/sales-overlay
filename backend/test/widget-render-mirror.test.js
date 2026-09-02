'use strict';
/**
 * ⚠⚠⚠ `RENDERABLE` IS A CLAIM ABOUT web/dashboard.html THAT lib/widget-catalog.js
 * CANNOT VERIFY — the lib is Node, the renderers are an inline browser script, and
 * there is no import between them. So the claim is MIRRORED here, the same shape
 * as the SQL/JS scope mirror: the list is checked against what the real card
 * builders actually branch on.
 *
 * ⚠ WHY IT MATTERS MORE THAN AN ORDINARY MIRROR. If the list says a renderer
 * handles a metric and it does not, the picker OFFERS a card that renders
 * nothing — or, in the by-rep case that shipped, ANOTHER METRIC'S NUMBERS. If
 * the list is short, a working card is silently withheld. Both directions are
 * defects and both are invisible on screen, so both are asserted.
 *
 * ⚠ AND THE DIRECTION OF THE TWO FAILURES IS NOT SYMMETRIC:
 *     list too WIDE  -> a broken or WRONG card reaches a manager
 *     list too NARROW -> a good card is missing and nobody knows why
 * The first is the one that ships confidently, which is why the offer is an
 * intersection rather than a hand-maintained allowlist.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const C = require('../lib/widget-catalog.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

/* ⚠ FROM THE RAW SOURCE. The comment stripper is for TEXT matching; these
   slices are read for their branch conditions, and stripping can leave a block
   delimiter unpaired. */
function slice(name, min, max) {
  const at = HTML.indexOf('function ' + name);
  assert.ok(at !== -1, 'no such renderer: ' + name);
  const body = HTML.slice(at, HTML.indexOf('\n  }', at));
  assert.ok(body.length > min && body.length < max, name + ' slice: ' + body.length);
  return body;
}

/** What each card builder ACTUALLY branches on, read out of the shipped source. */
function actualCoverage() {
  const num = [...slice('dashNumberHtml', 400, 3000).matchAll(/card\.metric === '([a-z_]+)'/g)].map((m) => m[1]);
  const gau = [...slice('dashGaugeHtml', 200, 2000).matchAll(/([a-z_]+): '[a-z]+'/g)].map((m) => m[1]);
  /* ⚠ THE PER-REP LOOKUP MOVED into `dashRepRanking`, which the LIST and the BAR
     both read — one ranking, two views, so the order and the top-N note cannot
     drift between them. The mirror follows it there rather than being weakened. */
  const rep = [...slice('dashRepRanking', 600, 4000).matchAll(/^      ([a-z_]+): function \(r\)/gm)].map((m) => m[1]);
  const brk = [...slice('dashBreakdownHtml', 400, 3000).matchAll(/card\.metric === '([a-z_]+)'/g)].map((m) => m[1]);
  const bcat = [...slice('dashBarCatHtml', 400, 3000).matchAll(/card\.metric === '([a-z_]+)'/g)].map((m) => m[1]);
  /* ⚠ DASH_CANVAS IS NOW A TABLE OF OBJECTS — `{ key, label, unit }` per metric —
     because those three have to agree and a ternary chain is how they came apart:
     the unit was inferred from the axis label, and that inference selected the
     CLOSING team average for the objection-handling card. So the keys of the
     table are the metrics, and the inner `key:` fields are not. */
  const cAt = HTML.indexOf('var DASH_CANVAS = {');
  assert.ok(cAt !== -1, 'DASH_CANVAS must exist — it is what the trend view looks a chart up by');
  const canvasSrc = HTML.slice(cAt, HTML.indexOf('\n  };', cAt));
  assert.ok(canvasSrc.length > 200 && canvasSrc.length < 2500, 'DASH_CANVAS slice: ' + canvasSrc.length);
  const tre = [...canvasSrc.matchAll(/^    ([a-z_]+):\s*\{/gm)].map((m) => m[1]);
  /* ⚠ bar_rep reads the SAME ranking as by_rep, so its coverage is that set BY
     CONSTRUCTION — the test below asserts the two stay identical rather than
     letting a metric gain one view and not the other. */
  /* The rep-card widget (2026-09-02) refuses any metric but its own, so the
     same extraction works: the one it branches on is the one it can draw. */
  const card = [...slice('dashRepCardHtml', 300, 2500).matchAll(/card\.metric === '([a-z_]+)'/g)].map((m) => m[1]);
  return { number: num, gauge: gau, trend: tre, by_rep: rep, bar_rep: rep, breakdown: brk, bar_cat: bcat, rep_card: card };
}

test('⚠⚠ RENDERABLE mirrors what the real card builders branch on', () => {
  const actual = actualCoverage();
  const declared = C._RENDERABLE;

  assert.deepStrictEqual(Object.keys(declared).sort(), Object.keys(actual).sort(),
    'a view kind exists in one and not the other');

  Object.keys(actual).forEach((view) => {
    // sanity FIRST — an empty extraction would make every comparison below vacuous
    assert.ok(actual[view].length > 0, view + ': extracted nothing from the renderer');
    assert.deepStrictEqual(
      [...declared[view]].sort(), [...actual[view]].sort(),
      view + ': the catalog and the renderer disagree about which metrics it can draw. '
      + 'Too wide offers a card that shows nothing (or another metric\'s numbers); '
      + 'too narrow withholds a card that works.');
  });
});

test('⚠⚠ the by-rep view REFUSES an unknown metric — it does not fall back', () => {
  const body = slice('dashRepRanking', 600, 4000);
  /* This shipped as `}[card.metric] || function (r) { return r.avg_score; };` and
     rendered AVERAGE SCORE under five other metrics' titles. Measured on the live
     editor: Outcome mix, Average call time, Section scores, Call moment mix and
     Time to price all showed the identical Josh 64 / Godwin 60 / Yazan 58.
     ⚠ A card headed "Time to price" showing 64 reads as minutes. An empty card is
     a question; a wrong one is an answer. */
  assert.ok(!/\}\[card\.metric\] \|\|/.test(body),
    'no fallback: an unknown metric must refuse, never render another metric\'s values');
  assert.ok(/if \(!pickVal\) return \{ error:/.test(body),
    'and it must say it cannot show this metric, rather than showing something else');
  /* ⚠ AND BOTH CONSUMERS MUST SURFACE THE REFUSAL. The ranking returning an
     error object is useless if a view ignores it — the compute-a-check-and-
     ignore-its-result shape. */
  ['dashByRepHtml', 'dashBarRepHtml'].forEach((n) => {
    const v = slice(n, 200, 2500);
    assert.ok(/if \(r\.error\) return dashNoValueHtml\(r\.error\)/.test(v),
      n + ' must render the refusal, not ignore it');
  });
});

test('⚠⚠ ONE ranking, two views — the list and the bar cannot disagree', () => {
  ['dashByRepHtml', 'dashBarRepHtml'].forEach((n) => {
    const v = slice(n, 200, 2500);
    assert.ok(/dashRepRanking\(card\)/.test(v), n + ' must read the shared ranking');
    assert.ok(!/prospect_close_rate/.test(v), n + ' must not carry its own metric lookup');
    assert.ok(/dashRepNote\(shown, r\)/.test(v), n + ' must state the same top-N / unmeasured note');
  });
  /* ⚠⚠ AND THE SORT FOLLOWS THE METRIC'S DIRECTION. Descending is right for a
     rate and WRONG for a ceiling metric, where the best rep is the lowest — and
     a bar chart makes that far worse than a list, because the longest bar reads
     as best. No inverted metric reaches this today, so it is closed BEFORE it
     can appear rather than after. */
  const rank = slice('dashRepRanking', 600, 4000);
  assert.ok(/lowerIsBetter \? a\.v - b\.v : b\.v - a\.v/.test(rank),
    'the sort must invert for a lower-is-better metric');
  assert.ok(/card\.targetDirection === 'lower_is_better'/.test(rank),
    'and it must take the direction from the METRIC, not from the view');
  const note = slice('dashRepNote', 150, 900);
  assert.ok(/lower is better/.test(note), 'and the card must say so');
});

test('⚠ the bars draw with plain elements — no canvas, no chart library', () => {
  ['dashBarRepHtml', 'dashBarCatHtml'].forEach((n) => {
    const v = slice(n, 300, 3000);
    assert.ok(!/canvas/i.test(v) && !/Chart/.test(v),
      n + ': trend needs a canvas because it draws axes and several series; four to '
      + 'nine bars do not, and a canvas drags in the mount/destroy lifecycle that '
      + 'made the team graphs rebuild fifteen times on one visit');
  });
  /* ⚠ THE SCALE IS THE LARGEST VALUE PRESENT, and a zero-safe denominator —
     rates in the teens against a 0-100 axis draw five slivers and say nothing. */
  const sc = slice('dashBarScale', 100, 700);
  assert.ok(/max > 0 \? max : 1/.test(sc), 'never divide by zero');
  /* ⚠⚠ AND THE CALL SITES, NOT JUST THE HELPER — FIFTH TIME THIS SHAPE HAS BITTEN.
     Restoring `var max = 100` in the bar renderer left this assertion GREEN,
     because a helper being correct says nothing about whether anything calls it.
     Testing a function in isolation and grepping for its name are the same check
     twice: both confirm it EXISTS, neither confirms it RUNS. */
  ['dashBarRepHtml', 'dashBarCatHtml'].forEach((n) => {
    const v = slice(n, 300, 3000);
    assert.ok(/dashBarScale\(/.test(v), n + ' must scale to the data, not to a fixed axis');
    assert.ok(!/var max = \d/.test(v), n + ' must not hard-code a maximum');
  });
});

test('⚠ every by-rep row carries its unit, and the bare ones are bare ON PURPOSE', () => {
  const at = HTML.indexOf('var DASH_UNIT');
  const src = HTML.slice(at, HTML.indexOf('};', at) + 2);
  assert.ok(src.length > 100 && src.length < 800, 'DASH_UNIT slice: ' + src.length);
  const unit = new Function(src + '; return DASH_UNIT;')();

  /* ⚠ A UNITLESS RATE OR DURATION IS A NUMBER WHOSE MEANING LIVES ONLY IN THE
     READER'S HEAD. Justin found it missing on ONE card; it was missing on every
     by-rep row, so closing rate read "25" where it means 25%. */
  assert.strictEqual(unit.closing_rate, '%');
  assert.strictEqual(unit.objection_handle_rate, '%');
  assert.strictEqual(unit.avg_call_time, ' min');
  assert.strictEqual(unit.time_to_price, ' min');
  /* ⚠ AND THESE ARE CORRECTLY BARE — a score out of 100 and a count of calls
     need no unit, and inventing one would be worse than none. Named here so the
     absence is a decision rather than an omission nobody re-checked. */
  ['avg_score', 'calls_analyzed', 'prospects'].forEach((k) =>
    assert.strictEqual(unit[k], '', k + ' is bare on purpose'));

  // every metric EITHER per-rep view can draw must have an entry, bare or not
  assert.deepStrictEqual([...C._RENDERABLE.bar_rep].sort(), [...C._RENDERABLE.by_rep].sort(),
    'the bar draws the same data the list reads — they cannot diverge');
  C._RENDERABLE.by_rep.forEach((k) =>
    assert.ok(Object.prototype.hasOwnProperty.call(unit, k),
      k + ' can be drawn by rep and has no declared unit — bare must be a CHOICE'));

  /* ⚠ THIS ANCHORED ON THE LOOP VARIABLE NAME (`r.v`) and broke when the shared
     ranking took `r` for the ranking object and the row became `x`. A guard
     pinned to a NAME breaks on a rename that changes nothing it cares about —
     anchor on the CLAIM: both per-rep views append the unit to the value. */
  ['dashByRepHtml', 'dashBarRepHtml'].forEach((n) => {
    const v = slice(n, 200, 2500);
    assert.ok(/DASH_UNIT\[card\.metric\]/.test(v), n + ' must read the metric\'s unit');
    assert.ok(/\.v\)\) \+ unit/.test(v), n + ' must actually append it to the value');
  });
});

test('⚠⚠ a stored board naming a metric nothing can draw DROPS and says so', () => {
  const L = require('../lib/dashboard-layout.js');
  const r = L.resolveLayout([
    { metric: 'outcome_mix', view: 'breakdown', w: 2, h: 2 },
    { metric: 'closing_rate', view: 'gauge', w: 1, h: 2 },
  ]);
  assert.deepStrictEqual(r.cards.map((c) => c.metric), ['closing_rate']);
  assert.deepStrictEqual(r.dropped.map((d) => d.metric), ['outcome_mix'],
    'available is NOT enough — a metric with no offerable view cannot be drawn, and '
    + 'coercing its view produced "no data in this range", which is a FALSE reason');
});

test('⚠⚠ a withdrawn view falls back to the metric\'s FIRST OFFERED view, not to `number`', () => {
  const L = require('../lib/dashboard-layout.js');
  /* ⚠⚠ CONVERTED 2026-09-01, AND THE REASON IS THE POINT. This drove the two
     MINUTE metrics, because they were the only ones that did not offer `number`
     — and closing the minutes hole gave both of them a number card, so the
     fixture can no longer tell "falls back to the first offered view" apart from
     "always falls back to number". THE SUBJECT SURVIVES AND THE FIXTURE DIED:
     every offerable metric now offers `number` first, so no catalog entry can
     prove this behaviourally any more. Asserted at the SOURCE instead, which
     cannot go vacuous however the catalog moves. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dashboard-layout.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const falls = [...code.matchAll(/\?\s*(?:want|c\.view)\s*:\s*([A-Za-z0-9_.\[\]']+)/g)].map((x) => x[1]);
  assert.ok(falls.length >= 2, 'non-vacuity: the fallback expressions must be found — ' + falls.length);
  falls.forEach((f) => assert.strictEqual(f, 'm.views[0]',
    "the fallback must be the metric's FIRST OFFERED view, never a literal: got " + f));

  /* and behaviourally: a view the metric does not offer still lands on one it
     DOES, and the card records that it changed so it can say so. */
  const r = L.resolveLayout([{ metric: 'closing_rate', view: 'breakdown', w: 1, h: 1 }]);
  const cat = require('../lib/widget-catalog.js');
  const offered = cat.byKey('closing_rate').views;
  assert.ok(offered.indexOf('breakdown') === -1, 'fixture: the asked-for view must be unofferable');
  assert.strictEqual(r.cards[0].view, offered[0]);
  assert.strictEqual(r.cards[0].requestedView, 'breakdown');
});

test('⚠ the fell-back note names what it BECAME, not what it used to always become', () => {
  const at = HTML.indexOf('var fell = card.requestedView');
  const src = HTML.slice(at, HTML.indexOf(': \'\';', at));
  assert.ok(src.length > 80 && src.length < 900, 'slice: ' + src.length);
  assert.ok(!/Shown as a number \\u2014 this metric has no target/.test(src),
    'that sentence was true while `number` was the only fallback and is false now');
  assert.ok(/DASH_VIEW_SHORT\[card\.view\]/.test(src) && /DASH_VIEW_SHORT\[card\.requestedView\]/.test(src),
    'it must name both the view it got and the view it asked for');
});

test('⚠⚠ step one NAMES the views rather than counting them', () => {
  const at = HTML.indexOf('function dashRenderPicker');
  const body = HTML.slice(at, HTML.indexOf('\n  }', at));
  /* ⚠ CEILING RAISED 5000 -> 7000, and the reason belongs here rather than in a
     commit message: step two now GROUPS the views into "Over time" and "Right
     now" with a sentence for each absent group, which is real added markup. A
     ceiling is the mirror of a floor — raising one is the single edit that can
     turn a real check vacuous, so it is only ever moved with its cause named.
     The lower bound is what still makes this non-vacuous. */
  /* Ceiling 7000 → 9000 on 2026-09-02: step two grew a "Which closer" branch
     for the person entry (real added markup). The floor keeps this non-vacuous. */
  assert.ok(body.length > 800 && body.length < 9000, 'slice: ' + body.length);
  /* This read "4 views" — a number that says nothing about WHICH, so the only
     way to find the three metrics with a trend was to open all ten in turn.
     Justin reported "no graphs appear as options" while the picker was offering
     Trend the whole time, on step TWO. The explanation was correct and in the
     wrong place. */
  assert.ok(!/m\.views\.length \+ ' view'/.test(body),
    'a count tells a manager nothing about which views a metric offers');
  assert.ok(/m\.views\.map\(function \(v\) \{ return escapeHtml\(DASH_VIEW_SHORT/.test(body),
    'step one must name them, so a trend is findable without opening every metric');
});

test('⚠⚠⚠ a line graph is only OFFERED where the data layer actually emits a series', () => {
  /* ⚠⚠ THIS GUARD EXISTS BECAUSE RESTORING `history: false` ON FOUR METRICS
     PRODUCED ZERO FAILURES. The whole point of the history work is that a
     metric with a line graph has a line behind it — and nothing asserted the
     chain. A metric could silently lose its trend, or claim one it cannot draw,
     and the suite would stay green.

     THE CHAIN IS THREE LINKS AND ALL THREE MUST AGREE:
       catalog says `history: true`  ->  DASH_CANVAS maps it to a series key
                                     ->  rep-series EMITS that key per rep AND on team
     Break any link and the card draws an empty chart, which reads as "this rep
     had no calls" rather than as a missing feature. */
  const REP = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rep-series.js'), 'utf8');

  const withHistory = C._CATALOG.filter((m) => m.history).map((m) => m.key);
  assert.ok(withHistory.length >= 3, 'non-vacuity: some metric must claim history');

  const cAt = HTML.indexOf('var DASH_CANVAS = {');
  const canvasSrc = HTML.slice(cAt, HTML.indexOf('\n  };', cAt));

  withHistory.forEach((key) => {
    const row = new RegExp('^    ' + key + ':\\s*\\{([^}]+)\\}', 'm').exec(canvasSrc);
    assert.ok(row, key + ' claims history but DASH_CANVAS has no chart for it — '
      + 'the trend view would render an empty canvas');
    const sk = /key:\s*'([a-z_]+)'/.exec(row[1]);
    assert.ok(sk, key + ' has no series key in DASH_CANVAS');

    /* per-rep AND team: the team baseline is what the closer is read against,
       and it is selected by this same key — see the label-match defect, where
       the objection card drew the CLOSING team average. */
    assert.ok(new RegExp('^      ' + sk[1] + ': keys\\.map', 'm').test(REP),
      key + ' -> series "' + sk[1] + '" is never emitted per rep by rep-series');
    assert.ok(new RegExp('^      ' + sk[1] + ': teamLine\\(', 'm').test(REP),
      key + ' -> series "' + sk[1] + '" has no TEAM line');
  });

  /* and the other direction: a RENDERABLE.trend entry for a metric with no
     history is dead weight that reads as a supported view. */
  C._RENDERABLE.trend.forEach((key) => {
    const m = C._CATALOG.find((x) => x.key === key);
    assert.ok(m && m.history, key + ' is listed as trend-renderable but claims no history');
  });
});
