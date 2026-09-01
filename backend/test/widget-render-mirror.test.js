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
  const rep = [...slice('dashByRepHtml', 800, 5000).matchAll(/^      ([a-z_]+): function \(r\)/gm)].map((m) => m[1]);
  const brk = [...slice('dashBreakdownHtml', 400, 3000).matchAll(/card\.metric === '([a-z_]+)'/g)].map((m) => m[1]);
  const canvas = /var DASH_CANVAS = \{([^}]+)\}/.exec(HTML);
  assert.ok(canvas, 'DASH_CANVAS must exist — it is what the trend view looks a chart up by');
  const tre = [...canvas[1].matchAll(/([a-z_]+):/g)].map((m) => m[1]);
  return { number: num, gauge: gau, trend: tre, by_rep: rep, breakdown: brk };
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
  const body = slice('dashByRepHtml', 800, 5000);
  /* This shipped as `}[card.metric] || function (r) { return r.avg_score; };` and
     rendered AVERAGE SCORE under five other metrics' titles. Measured on the live
     editor: Outcome mix, Average call time, Section scores, Call moment mix and
     Time to price all showed the identical Josh 64 / Godwin 60 / Yazan 58.
     ⚠ A card headed "Time to price" showing 64 reads as minutes. An empty card is
     a question; a wrong one is an answer. */
  assert.ok(!/\}\[card\.metric\] \|\|/.test(body),
    'no fallback: an unknown metric must refuse, never render another metric\'s values');
  assert.ok(/if \(!pickVal\) return dashNoValueHtml/.test(body),
    'and it must say it cannot show this metric, rather than showing something else');
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

  // every metric the by-rep view can draw must have an entry, bare or not
  C._RENDERABLE.by_rep.forEach((k) =>
    assert.ok(Object.prototype.hasOwnProperty.call(unit, k),
      k + ' can be drawn by rep and has no declared unit — bare must be a CHOICE'));

  assert.ok(/String\(r\.v\)\) \+ unit/.test(HTML),
    'and the row must actually append it');
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
  const r = L.resolveLayout([
    { metric: 'avg_call_time', view: 'number', w: 1, h: 1 },
    { metric: 'time_to_price', view: 'number', w: 1, h: 1 },
  ]);
  /* `number` used to be offered by every available metric and IS NO LONGER.
     Hard-coding it here would coerce these two straight back into the broken
     card this change removed — the shared-carrier shape, where viewsFor() changed
     what it holds and the risk was in its other readers. */
  assert.deepStrictEqual(r.cards.map((c) => c.metric + '/' + c.view),
    ['avg_call_time/gauge', 'time_to_price/trend']);
  r.cards.forEach((c) => assert.strictEqual(c.requestedView, 'number',
    'and the card records that it changed, so it can say so'));
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
  assert.ok(body.length > 800 && body.length < 5000, 'slice: ' + body.length);
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
