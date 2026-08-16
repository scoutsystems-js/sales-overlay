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

test('the bucket is derived from the TEAM range span; threshold still 7 days', () => {
  // Stage 2 moved team onto its own range field, so repSeriesBucket no longer
  // reads the retired `days` preset. The THRESHOLD is deliberately unchanged —
  // span-derived bucketing (daily up to ~14 days) is stage 5, kept separate so a
  // bucketing change is never mixed with a control change.
  const src = HTML.slice(HTML.indexOf('function repSeriesBucket'), HTML.indexOf('function teamQP'));
  const fn = new Function('state', src + '; return repSeriesBucket();');
  const range = (days) => ({ teamRange: {
    from: '2026-08-01T00:00:00.000Z',
    to: new Date(Date.parse('2026-08-01T00:00:00.000Z') + days * 86400000).toISOString() } });
  assert.strictEqual(fn(range(7)), 'day');
  assert.strictEqual(fn(range(6)), 'day');
  assert.strictEqual(fn(range(8)), 'week', 'still weekly past 7 — stage 5 raises this to 14');
  assert.strictEqual(fn(range(30)), 'week');
  assert.strictEqual(fn({}), 'week', 'no range falls back to weekly, not daily');
  assert.strictEqual(fn({ teamRange: { from: null, to: null } }), 'week');
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
  ['Objection Handling Over Time', 'Closing Rate Over Time', 'What Needs Work',
   'Team Overview', 'Team Recommendations', 'Manager Daily Digest'].forEach((h) => {
    assert.ok(HTML.indexOf('>' + h + '<') !== -1, 'missing title-cased heading: ' + h);
  });
  ['>Objection handling over time<', '>Closing rate over time<', '>What needs work<',
   '>Team overview<'].forEach((h) => {
    assert.strictEqual(HTML.indexOf(h), -1, 'sentence-case heading still present: ' + h);
  });
});
