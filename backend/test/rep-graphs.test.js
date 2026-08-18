/**
 * 10b — the two manager-board graphs.
 *
 * The chart builder is extracted from the served markup and executed against a
 * fake Chart constructor, so these assert what would actually be PLOTTED rather
 * than what the API returned.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const SRC = HTML.slice(HTML.indexOf('var REP_LINE_COLORS'), HTML.indexOf('function repSeriesSectionHtml'));

function buildChart(series, pick, yLabel) {
  let cfg = null;
  const Chart = function (ctx, c) { cfg = c; this.destroy = () => {}; };
  const doc = { getElementById: () => ({ getContext: () => ({}) }) };
  const fn = new Function('Chart', 'document', 'window', SRC + '; return repSeriesChart;')(Chart, doc, { Chart });
  fn('canvas', series, pick, yLabel);
  return cfg;
}

const SERIES = {
  buckets: [{ label: 'Aug 3' }, { label: 'Aug 10' }],
  reps: [
    { user_id: 'a', name: 'Ava',  handle: [{ rate: 50, handled: 1, total: 2 }, { rate: null, handled: 0, total: 0 }],
                                  close:  [{ rate: 25, closed: 1, total: 4 }, { rate: null, closed: 0, total: 0 }] },
    { user_id: 'b', name: 'Ben',  handle: [{ rate: null, handled: 0, total: 0 }, { rate: null, handled: 0, total: 0 }],
                                  close:  [{ rate: null, closed: 0, total: 0 }, { rate: null, closed: 0, total: 0 }] },
  ],
  team: { handle: [{ rate: 50, reps_counted: 1, numerator: 1, total: 2 }, { rate: null, reps_counted: 0, numerator: 0, total: 0 }],
          close:  [{ rate: 25, reps_counted: 1, numerator: 1, total: 4 }, { rate: null, reps_counted: 0, numerator: 0, total: 0 }] },
};

test('a rep with NO data in the window is absent, not a flat zero or an empty legend', () => {
  const cfg = buildChart(SERIES, (r) => r.handle, 'Handle rate');
  const labels = cfg.data.datasets.map((d) => d.label);
  assert.ok(labels.indexOf('Ava') !== -1);
  assert.strictEqual(labels.indexOf('Ben'), -1, 'Ben has no point at all and must not be drawn');
});

test('empty weeks BREAK the line — never plotted as 0', () => {
  const cfg = buildChart(SERIES, (r) => r.handle, 'Handle rate');
  const ava = cfg.data.datasets.find((d) => d.label === 'Ava');
  assert.deepStrictEqual(ava.data, [50, null], 'a null week stays null');
  assert.ok(cfg.data.datasets.every((d) => d.spanGaps === false), 'gaps must not be bridged');
});

test('the team average is a BOLD DOTTED line', () => {
  const cfg = buildChart(SERIES, (r) => r.handle, 'Handle rate');
  const team = cfg.data.datasets.find((d) => d.label === 'Team average');
  assert.ok(team, 'the team line must be present');
  assert.ok(Array.isArray(team.borderDash) && team.borderDash.length, 'dotted');
  assert.ok(team.borderWidth > 2, 'bold');
});

test('tooltips carry RAW COUNTS, per the house rule', () => {
  const cfg = buildChart(SERIES, (r) => r.handle, 'Handle rate');
  const ava = cfg.data.datasets.find((d) => d.label === 'Ava');
  const line = cfg.options.plugins.tooltip.callbacks.label({ dataset: ava, dataIndex: 0 });
  assert.ok(/50%/.test(line) && /1 of 2/.test(line), 'rate and counts: ' + line);
  const empty = cfg.options.plugins.tooltip.callbacks.label({ dataset: ava, dataIndex: 1 });
  assert.ok(/no data/.test(empty), 'an empty week says "no data", never 0%');
});

test('the closing graph names prospects in its tooltip, not objections', () => {
  const cfg = buildChart(SERIES, (r) => r.close, 'Closing rate');
  const ava = cfg.data.datasets.find((d) => d.label === 'Ava');
  const line = cfg.options.plugins.tooltip.callbacks.label({ dataset: ava, dataIndex: 0 });
  assert.ok(/prospects closed/.test(line), 'the standing definition is per-prospect: ' + line);
});

test('NO GREY TEXT — axes, ticks, legend and titles are full strength', () => {
  const cfg = buildChart(SERIES, (r) => r.handle, 'Handle rate');
  const colours = [
    cfg.options.scales.y.ticks.color,
    cfg.options.scales.x.ticks.color,
    cfg.options.scales.y.title.color,
    cfg.options.plugins.legend.labels.color,
  ];
  colours.forEach((c) => assert.strictEqual(c, '#ededed', 'Justin has raised low-contrast grey twice'));
});

test('the selector uses Scout\'s four categories and offers no "price"', () => {
  // Ruling: use the existing labelling. Money-phrased objections route to
  // `fear` by standing rule — that is the taxonomy working, not a gap.
  // Start the slice at the RULING COMMENT, not at the array — the reason the
  // option is absent is part of what must not be lost.
  const opts = HTML.slice(HTML.indexOf("Ruling 2026-08-15: the selector uses"), HTML.indexOf('function repSeriesChart'));
  ['fear', 'timing', 'logistical', 'partner'].forEach((k) => assert.ok(opts.indexOf("'" + k + "'") !== -1, k));
  assert.ok(/All objections/.test(opts));
  assert.ok(!/price/i.test(opts.replace(/\/\/[^\n]*/g, '')), 'no "price" option in the selector itself');
  assert.ok(/money-phrased objections are classified/.test(opts), 'and the reason is recorded beside it');
});

// ─── range-dependent bucketing (Justin's ruling 2026-08-15) ────────────────

test('STAGE 5: bucketing is span-derived — daily up to 14 days, weekly beyond', () => {
  // "Aug 1 - Aug 12" gives days; "June through August" gives weeks, with no
  // thought required from the user.
  const src = HTML.slice(HTML.indexOf('var DAILY_BUCKET_MAX_DAYS'), HTML.indexOf('function teamQP'));
  const fn = new Function('state', src + '; return repSeriesBucket();');
  const span = (days) => ({ teamRange: {
    from: '2026-08-01T00:00:00.000Z',
    to: new Date(Date.parse('2026-08-01T00:00:00.000Z') + days * 86400000).toISOString() } });

  [1, 5, 7, 10, 13, 14].forEach((d) => assert.strictEqual(fn(span(d)), 'day', d + ' days should be daily'));
  [15, 21, 30, 90, 400].forEach((d) => assert.strictEqual(fn(span(d)), 'week', d + ' days should be weekly'));

  assert.strictEqual(fn({}), 'week', 'no range falls back to weekly, not daily');
  assert.strictEqual(fn({ teamRange: { from: null, to: null } }), 'week');
});

test('the boundary is in CALENDAR DAYS, on ranges the picker actually produces', () => {
  // The picker emits an inclusive window: Aug 1 00:00:00.000 → Aug 14 23:59:59.999
  // is FOURTEEN calendar days and must be daily; adding one more day must not be.
  // Testing raw millisecond spans instead of picker output is how I got this
  // boundary wrong the first time.
  const src = HTML.slice(HTML.indexOf('var DAILY_BUCKET_MAX_DAYS'), HTML.indexOf('function teamQP'));
  const fn = new Function('state', src + '; return repSeriesBucket();');
  const picked = (startDay, endDay) => fn({ teamRange: {
    from: '2026-08-' + String(startDay).padStart(2, '0') + 'T00:00:00.000Z',
    to:   '2026-08-' + String(endDay).padStart(2, '0') + 'T23:59:59.999Z' } });

  assert.strictEqual(picked(1, 14), 'day',  '14 calendar days inclusive');
  assert.strictEqual(picked(1, 15), 'week', '15 calendar days inclusive');
  assert.strictEqual(picked(1, 1),  'day',  'a single day');
  assert.strictEqual(picked(1, 7),  'day',  'a week');
});

test('the loader SENDS the derived bucket rather than a hardcoded one', () => {
  // The whole ruling is inert if the query string still says bucket=week.
  const loader = HTML.slice(HTML.indexOf("repSeries:{ flag:"), HTML.indexOf("repSeries:{ flag:") + 400);
  assert.ok(/bucket=' \+ repSeriesBucket\(\)/.test(loader), 'loader must call repSeriesBucket(): ' + loader.slice(0, 200));
  assert.ok(!/bucket=week/.test(loader), 'the hardcoded weekly bucket must be gone');
});

test('tooltips inherit the SPAN label — no title override strips it', () => {
  // Ruling 2 covers axis labels AND tooltips. Chart.js defaults the tooltip
  // title to the axis label, so this holds only while nothing overrides it.
  const cfg = buildChart(SERIES, (r) => r.handle, 'Handle rate');
  assert.ok(!cfg.options.plugins.tooltip.callbacks.title,
    'a title callback would bypass the bucket label and reintroduce ambiguity');
  assert.deepStrictEqual(cfg.data.labels, ['Aug 3', 'Aug 10'], 'axis reads the bucket labels verbatim');
});

test('HEADINGS are title case on this view', () => {
  // ⚠ ANCHORS RE-POINTED 2026-08-18 for item (k): "Over Time" was dropped from
  // both graph titles. The old anchors would have gone on passing as absent-case
  // checks while the present-case checks failed — which is what caught it here.
  ['Objection Handling %', 'Closing %', 'What Needs Work',
   'Team Overview', 'Team Recommendations', 'Manager Daily Digest'].forEach((h) => {
    assert.ok(HTML.indexOf('>' + h + '<') !== -1, 'missing title-cased heading: ' + h);
  });
  ['>Objection handling %<', '>Closing %<'.toLowerCase(), '>What needs work<',
   '>Team overview<'].forEach((h) => {
    assert.strictEqual(HTML.indexOf(h), -1, 'sentence-case heading still present: ' + h);
  });
  // The retired names must be gone from the render path entirely, or the page
  // would carry two names for one graph — the thing (k) exists to remove.
  const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ['Objection Handling Over Time', 'Closing Rate Over Time'].forEach((h) => {
    assert.strictEqual(LIVE.indexOf(h), -1, 'the retired graph title is still live: ' + h);
  });
});

// ── (k2) the legend toggle ────────────────────────────────────────────────
test('⚠⚠ the hidden set is keyed by user_id, NEVER by legend index', () => {
  // The dataset ORDER changes with the window: a rep with no points is dropped
  // before datasets are built, so index 2 is a different person on a different
  // range. An index-keyed hidden set hides the WRONG rep after a date change —
  // silently, and with a perfectly plausible chart.
  const at = HTML.indexOf('function repSeriesChart');
  const fn = HTML.slice(at, HTML.indexOf('\n  }', HTML.indexOf('legend:', at)));
  // Bound generously: the point of this assertion is to catch a BACKWARDS or
  // truncated slice (which yields '' or a few characters), not to pin the
  // function's length — a legend block that grows is not a defect.
  // Widened 12000 -> 16000 on 2026-08-18: repSeriesChart gained the
  // update-in-place path (the graph-flash fix) and its explanation, which is a
  // legitimate growth of exactly the kind this bound is documented not to pin.
  assert.ok(fn.length > 800 && fn.length < 16000, 'slice suspicious: ' + fn.length);
  assert.ok(fn.indexOf('function repSeriesChart') === 0, 'slice must start at the function');
  assert.ok(/_userId: toggleable \? r\.user_id : null/.test(fn), 'the dataset must carry user_id');
  assert.ok(/state\.repLineHidden\[r\.user_id\]/.test(fn), 'restore must look up BY user_id');
  assert.ok(!/repLineHidden\[i\]|repLineHidden\[datasetIndex\]/.test(HTML),
    'the hidden set must never be keyed by an index');
});

test('⚠ THE TEAM AVERAGE NEVER TOGGLES — it is the baseline, not a rep', () => {
  const at = HTML.indexOf("label: 'Team average'");
  assert.ok(at > 0, 'the team-average dataset is gone');
  const ds = HTML.slice(at, at + 900);
  assert.ok(/_fixed: true/.test(ds), 'the baseline dataset must be marked _fixed');
  const onClick = HTML.slice(HTML.indexOf('onClick: function (e, item, legend)'), HTML.indexOf('syncRepLineVisibility(canvasId)'));
  assert.ok(/if \(!ds \|\| ds\._fixed\) return;/.test(onClick),
    'the legend handler must refuse to toggle the baseline');
});

test('the toggle is OPT-IN — the single-rep graph does not share the hidden set', () => {
  assert.ok(/repSeriesChart\('repOwnChart',[^\n]*, false\)/.test(HTML),
    "the pivoted rep's own graph must pass toggleable=false");
  assert.ok(/repSeriesChart\('repHandleChart',[^\n]*, true\)/.test(HTML)
    && /repSeriesChart\('repCloseChart',[^\n]*, true\)/.test(HTML),
    'both team graphs must pass toggleable=true');
});

test('⚠ ALL REPS HIDDEN SAYS SO IN WORDS — the chart is not empty, the average remains', () => {
  const at = HTML.indexOf('function updateRepGraphAllHiddenNotes');
  const fn = HTML.slice(at, HTML.indexOf('\n  }', at) + 4);
  assert.ok(fn.length > 300 && fn.length < 2000, 'slice suspicious: ' + fn.length);
  assert.ok(/reps > 0 && visible === 0/.test(fn), 'the all-hidden condition must be explicit');
  assert.ok(/hidden — click a name in the legend/.test(fn), 'and it must say how to undo it');
  assert.ok(/dashed line is the team average/.test(fn),
    'it must explain the line that is still drawn, or the chart looks broken');
  // The note is a SIBLING of the fixed-height chart box, never a child.
  assert.ok(/<\/div>'\s*\n\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*\+ '<div class="rep-graph-note"/.test(HTML)
    || /\+ '<\/div>'[\s\S]{0,600}?\+ '<div class="rep-graph-note"/.test(HTML),
    'the note must sit outside .rep-graph (a fixed 300px box) or it is clipped');
});

// ── (k2 revised) hollow-circle hidden treatment ───────────────────────────
test('⚠⚠ NO STRIKETHROUGH — generateLabels forces hidden:false', () => {
  // Verified against the shipped chart.js@4.4.4 bundle: the legend's text draw
  // calls renderText(..., { strikethrough: item.hidden }). `hidden` is the ONLY
  // thing driving the line, so forcing it false is what removes it — and it is
  // why the hidden state has to be carried entirely by the marker below.
  const at = HTML.indexOf('generateLabels: function (chart)');
  assert.ok(at > 0, 'the custom generateLabels is gone — the default strikes through');
  const fn = HTML.slice(at, HTML.indexOf('\n              },', at));
  assert.ok(fn.length > 400 && fn.length < 3000, 'slice suspicious: ' + fn.length);
  assert.ok(/hidden: false,/.test(fn), 'legend items must report hidden:false');
  assert.ok(!/hidden: !chart\.isDatasetVisible|hidden: !on/.test(fn),
    'reporting the real hidden state reinstates the strikethrough');
});

test('⚠ the OFF marker is a hollow, desaturated circle — not a missing entry', () => {
  const at = HTML.indexOf('generateLabels: function (chart)');
  const fn = HTML.slice(at, HTML.indexOf('\n              },', at));
  assert.ok(/fillStyle: on \? ds\.backgroundColor : 'transparent'/.test(fn),
    'off must be HOLLOW — no fill');
  assert.ok(/strokeStyle: on \? ds\.borderColor : LEGEND_OFF_MARKER/.test(fn),
    'off must ring in the desaturated marker colour');
  assert.ok(/pointStyle: 'circle'/.test(fn), 'the marker is a circle');
  // The label itself must NOT be dimmed — the ask was the circle, not the text.
  assert.ok(/fontColor: '#ededed'/.test(fn), 'the label stays full strength either way');
  assert.ok(!/fontColor: on \?/.test(fn), 'the label must not change with the toggle');
});

test('⚠ EVERYTHING THE DEFAULT SUPPLIED IS RE-SUPPLIED', () => {
  // Replacing generateLabels means re-supplying by hand what Chart.js gave for
  // free. Enumerated from the 4.4.4 source so a dropped field is a failing test
  // rather than a legend that quietly loses its dashes or its click target.
  const at = HTML.indexOf('generateLabels: function (chart)');
  const fn = HTML.slice(at, HTML.indexOf('\n              },', at));
  ['text:', 'fillStyle:', 'fontColor:', 'hidden:', 'lineCap:', 'lineDash:',
   'lineDashOffset:', 'lineJoin:', 'lineWidth:', 'strokeStyle:', 'pointStyle:',
   'rotation:', 'datasetIndex:'].forEach(function (field) {
    assert.ok(fn.indexOf(field) !== -1, 'generateLabels dropped ' + field
      + ' — the default supplied it and nothing else will');
  });
  // datasetIndex is what the click handler reads; without it every click would
  // resolve to undefined and the toggle would silently do nothing.
  assert.ok(/datasetIndex: i,/.test(fn), 'datasetIndex must be the dataset position');
});

test("the team average's dashed marker survives the replacement", () => {
  const at = HTML.indexOf('generateLabels: function (chart)');
  const fn = HTML.slice(at, HTML.indexOf('\n              },', at));
  assert.ok(/lineDash: ds\.borderDash \|\| \[\]/.test(fn),
    'borderDash must be carried or the baseline legend circle stops reading as dashed');
});

test('the OFF marker is a STATE marker, not text — no-grey does not apply', () => {
  assert.ok(/var LEGEND_OFF_MARKER = 'rgba\(237, 237, 237, 0\.5\)'/.test(HTML),
    'the off-marker constant is gone or changed shape');
  // The note beside it must say WHY it is exempt, so a future no-grey sweep is
  // not pointed at it.
  const at = HTML.indexOf('var LEGEND_OFF_MARKER');
  const around = HTML.slice(Math.max(0, at - 600), at);
  assert.ok(/no-grey/.test(around), 'the exemption must be documented at the constant');
});

test('the note is full-strength text — the no-grey rule applies to it too', () => {
  const m = HTML.match(/\.rep-graph-note \{([^}]*)\}/);
  assert.ok(m, '.rep-graph-note style not found');
  assert.ok(/color: var\(--text\)/.test(m[1]), 'must use --text at full strength');
  assert.ok(!/opacity/.test(m[1]), 'no dimming — it states a fact about the user\'s own action');
});

// ── ⚠⚠ GRAPH PARITY IS PART OF THE SPEC (Justin, 2026-08-18: "don't get lazy") ──
/**
 * A NEW GRAPH MATCHES THE EXISTING ONES IN EVERY RESPECT — line colours and
 * saturation, clickable legend names, the hollow-circle hidden state, the fixed
 * team average, and the shared hidden set. The three graphs must be
 * INDISTINGUISHABLE IN BEHAVIOUR.
 *
 * ⚠ THE STRUCTURAL GUARANTEE IS THAT ALL THREE GO THROUGH ONE BUILDER. These
 * assertions exist to stop the cheap shortcut that breaks it: giving one graph
 * its own chart-construction path "just for this case". A fourth graph added
 * that way would look right and behave differently, and nothing else would
 * notice.
 */
test('⚠⚠ all three graphs are built by the SAME function — parity by construction', () => {
  const draws = HTML.match(/repSeriesChart\('rep(Handle|Close|Price)Chart'[^\n]*/g) || [];
  assert.strictEqual(draws.length, 3, 'expected three repSeriesChart calls, got ' + draws.length);
  draws.forEach((d) => {
    assert.ok(/, true\)/.test(d), 'every team graph must be toggleable=true: ' + d.slice(0, 80));
  });
  // No graph may construct its own Chart directly — that is how parity dies.
  const direct = (HTML.match(/new Chart\(/g) || []).length;
  assert.ok(direct <= 2, 'a graph is building its own Chart instead of using repSeriesChart; found '
    + direct + ' direct constructions');
});

test('⚠ every toggle-capable chart shares the hidden set', () => {
  const m = HTML.match(/var REP_TOGGLE_CHARTS = \[([^\]]*)\]/);
  assert.ok(m, 'REP_TOGGLE_CHARTS not found');
  ['repHandleChart', 'repCloseChart', 'repPriceChart'].forEach((id) => {
    assert.ok(m[1].indexOf(id) !== -1,
      id + ' is missing from REP_TOGGLE_CHARTS — its legend would desync from the others');
  });
});

test('⚠ the MINUTES graph does not inherit the percentage axis', () => {
  // The one place the three legitimately differ, and it is unit-driven rather
  // than a parity break. Pinned so a "tidy-up" cannot re-share the axis.
  assert.ok(/var isMinutes = \/minutes\/i\.test\(yLabel/.test(HTML),
    'the unit flag must be derived from the axis label, in one place');
  assert.ok(/max: isMinutes \? undefined : 100/.test(HTML),
    'a shared 0-100 max would render "38%" for a 38-minute call');
  assert.ok(/isMinutes \? \(v \+ 'm'\) : \(v \+ '%'\)/.test(HTML), 'ticks must carry the right unit');
});

// ── (ff) nav separators ───────────────────────────────────────────────────
/**
 * ⚠ THE NAV IS HAND-WRITTEN MARKUP, NOT GENERATED FROM A LIST. Every "·" is a
 * literal <span class="sep"> placed by hand, so nothing adds one automatically
 * — which is exactly why the Calls / EOD Report separator was missing for
 * months. The next link added will have the same gap unless whoever adds it
 * remembers, so this guard remembers for them.
 *
 * ⚠ CONDITIONAL LINKS CARRY THEIR OWN SEPARATOR (navTeamSep, navKbSep) with a
 * matching display:none, so hiding a link hides its dot too. A generated nav
 * would be the tidier fix, but it is a bigger change than this item asked for
 * — recorded here rather than done.
 */
test('⚠ every adjacent nav link pair has a separator between them', () => {
  const bar = HTML.slice(HTML.indexOf('<div class="top-bar-left"'), HTML.indexOf('<div class="top-bar-right"'));
  assert.ok(bar.length > 200 && bar.length < 4000, 'nav slice suspicious: ' + bar.length);

  // Strip comments so an archived link cannot answer for a live one.
  const live = bar.replace(/<!--[\s\S]*?-->/g, '');
  const tokens = [...live.matchAll(/<a class="nav-link"[^>]*id="([a-zA-Z]+)"|<span class="sep"/g)]
    .map((m) => (m[1] ? 'LINK:' + m[1] : 'SEP'));

  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].indexOf('LINK:') === 0 && tokens[i - 1].indexOf('LINK:') === 0) {
      assert.fail('no separator between ' + tokens[i - 1] + ' and ' + tokens[i]
        + ' — the nav is hand-written, so the dot has to be typed');
    }
  }
  assert.ok(tokens.filter((t) => t.indexOf('LINK:') === 0).length >= 5, 'expected the real nav, got ' + tokens.length);
});

test('⚠ NON-VACUITY — the nav check catches a removed separator', () => {
  const bar = HTML.slice(HTML.indexOf('<div class="top-bar-left"'), HTML.indexOf('<div class="top-bar-right"'));
  const live = bar.replace(/<!--[\s\S]*?-->/g, '');
  // ⚠ Remove EVERY separator rather than "the first one" — the first sits
  // between the "Scout" wordmark and the first link, so removing it creates no
  // adjacent LINK pair and the check would pass while proving nothing. Stripping
  // all of them cannot go stale as the nav changes.
  const broken = live.replace(/<span class="sep"[^>]*>[^<]*<\/span>/g, '');
  assert.notStrictEqual(broken, live, 'non-vacuity anchor is stale — no separators found at all');
  const tokens = [...broken.matchAll(/<a class="nav-link"[^>]*id="([a-zA-Z]+)"|<span class="sep"/g)]
    .map((m) => (m[1] ? 'LINK:' + m[1] : 'SEP'));
  let adjacent = false;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].indexOf('LINK:') === 0 && tokens[i - 1].indexOf('LINK:') === 0) adjacent = true;
  }
  assert.ok(adjacent, 'the scan must see adjacent links once a separator is removed');
});
