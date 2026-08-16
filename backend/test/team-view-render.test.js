/**
 * 10b — renderTeamView, EXECUTED. Not markers, not the helper in isolation.
 *
 * ⚠ WHY THIS FILE EXISTS. The first 10b verification extracted
 * repSeriesSectionHtml() and ran it headlessly against a fake Chart. It passed,
 * and the graphs never rendered — because the mount line had been spliced INSIDE
 * the callback passed to teamScoreListHtml, after `return r.avg_score;`, with no
 * closing brace between them. Unreachable dead code. It parsed, every marker was
 * present in the served bundle, and the section never appeared.
 *
 * Proving a FUNCTION works says nothing about whether its CALL SITE runs. So
 * these tests run the real renderTeamView and assert on the markup it actually
 * produces.
 *
 * No DOM library on purpose: Railway's build runs `npm install`, which installs
 * devDependencies, so a test-only parser would ship to production. The stub
 * below instead hands back a canvas ONLY when that id is present in the markup
 * most recently assigned to #content — so a chart getting built is itself proof
 * the canvas existed in the DOM at draw time.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// The page's main inline script — the biggest one without a src.
const RAW_SCRIPT = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).sort((a, b) => b.length - a.length)[0];

// Strip ONLY the trailing `init();` — booting the whole app (auth, routing,
// fetches) is not what is under test and does not terminate here. Every
// function definition, including renderTeamView, is left exactly as shipped.
const SCRIPT = RAW_SCRIPT.replace(/\n\s*init\(\);\s*$/, '\n');

test('the boot call is stripped and nothing else is', () => {
  // Guards the surgery above: if init() ever stops being the last statement,
  // this fails rather than silently testing a truncated script.
  assert.ok(/\n\s*init\(\);\s*$/.test(RAW_SCRIPT), 'expected the script to end with init();');
  assert.strictEqual(RAW_SCRIPT.length - SCRIPT.length < 20, true, 'only the init() call may be removed');
  assert.ok(SCRIPT.indexOf('function renderTeamView') !== -1, 'renderTeamView must survive intact');
});

const SERIES = {
  buckets: [{ label: 'Jul 6' }, { label: 'Jul 13' }],
  reps: [{ user_id: 'u1', name: 'josh',
    handle: [{ rate: 14, handled: 1, total: 7 }, { rate: 26, handled: 5, total: 19 }],
    close:  [{ rate: 43, closed: 3, total: 7 }, { rate: 25, closed: 6, total: 24 }] }],
  team: { handle: [{ rate: 14, reps_counted: 1, numerator: 1, total: 7 }, { rate: 26, reps_counted: 1, numerator: 5, total: 19 }],
          close:  [{ rate: 43, reps_counted: 1, numerator: 3, total: 7 }, { rate: 25, reps_counted: 1, numerator: 6, total: 24 }] },
};

// Runs the page script, overrides state, calls renderTeamView, returns what
// happened. `charts` is only non-empty if the canvas was really in the DOM.
function renderTeam(overrides) {
  let assigned = '';                 // markup currently "in the DOM"
  const charts = [];
  const events = [];

  const contentEl = {
    get innerHTML() { return assigned; },
    set innerHTML(v) { assigned = String(v); events.push('assign'); },
    insertAdjacentHTML(_pos, v) { assigned += String(v); events.push('insert'); },
  };

  const doc = {
    getElementById(id) {
      if (id === 'content') return contentEl;
      // The load-bearing part: a canvas exists only if the assigned markup
      // actually contains it. Draw-before-assign therefore yields no chart.
      if (assigned.indexOf('id="' + id + '"') === -1) return null;
      // The context carries the id so the test can tell the two charts apart
      // (repSeriesChart passes getContext('2d'), never the element itself).
      return { id: id, getContext: () => ({ __canvasId: id }) };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { style: {} },
  };

  const Chart = function (ctx, cfg) {
    var which = ctx && ctx.__canvasId;
    events.push('chart:' + which);
    charts.push({ canvas: which, cfg: cfg });
    this.destroy = function () {};
  };

  const win = {
    Chart: Chart,
    location: { hash: '', search: '', pathname: '/dashboard', href: 'https://x/dashboard', replace() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    fetch: () => new Promise(() => {}),       // loads never resolve — irrelevant here
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ScoutAuth: null,
    history: { replaceState() {} },
  };

  const runner = new Function('document', 'window', 'Chart', 'localStorage', 'fetch', 'console',
    SCRIPT + '\n;return { state: state, renderTeamView: renderTeamView, resetTeamData: resetTeamData };');

  const api = runner(doc, win, Chart, win.localStorage, win.fetch,
    { log() {}, warn() {}, error() {} });

  Object.assign(api.state, overrides);
  api.renderTeamView();
  return { html: assigned, charts: charts, events: events, api: api };
}

const BASE = {
  view: 'team', teamContext: { teams: [], rep_count: 1 }, teamContextLoading: false,
  teamOverview: { reps: [], totals: {} }, teamOverviewLoading: false,
  teamNeedsWork: { available: false }, teamNeedsWorkLoading: false,
  teamRecs: { available: false }, teamRecsLoading: false,
  teamDigest: { available: false }, teamDigestLoading: false,
  teamDetailMetric: null,
  teamRepSeries: SERIES, teamRepSeriesLoading: false, teamObjectionCategory: '',
};

test('renderTeamView ACTUALLY EMITS the graph section — the regression that shipped', () => {
  const out = renderTeam(BASE);
  assert.ok(out.html.length > 0, 'renderTeamView produced no markup at all');
  assert.ok(out.html.indexOf('repHandleChart') !== -1,
    'the objection-handling canvas is absent from the rendered markup');
  assert.ok(out.html.indexOf('repCloseChart') !== -1,
    'the closing-rate canvas is absent from the rendered markup');
});

test('the graphs sit ABOVE "What needs work" and BELOW the glance blocks', () => {
  // Justin's spec: the first thing he wants to see on the manager view.
  const out = renderTeam(BASE);
  const glance = out.html.indexOf('team-glance');
  const graphs = out.html.indexOf('repHandleChart');
  const needsWork = out.html.indexOf('What Needs Work');
  const overview = out.html.indexOf('Team Overview');

  // Every anchor asserted present FIRST. A conditional ordering check passes
  // vacuously when its anchor is missing, which is the same class of weak
  // verification that let the dead mount ship. `needs-work` was exactly that:
  // the card renders its heading, not that class, so the check never ran.
  assert.notStrictEqual(graphs, -1, 'graph canvas missing');
  assert.notStrictEqual(needsWork, -1, 'What needs work heading missing — anchor is stale');
  assert.notStrictEqual(overview, -1, 'Team overview heading missing — anchor is stale');
  assert.notStrictEqual(glance, -1, 'glance blocks missing — anchor is stale');

  assert.ok(glance < graphs, 'graphs must come AFTER the glance stat blocks');
  assert.ok(graphs < needsWork, 'graphs must come BEFORE What Needs Work');
  assert.ok(graphs < overview, 'graphs must come BEFORE Team overview');
});

test('the charts are built AFTER the canvases are in the DOM', () => {
  // The stub returns a canvas only when the assigned markup contains it, so a
  // chart existing here is proof of ordering, not an assumption about it.
  const out = renderTeam(BASE);
  assert.strictEqual(out.charts.length, 2, 'both charts must be built; got ' + out.charts.length);
  assert.deepStrictEqual(out.charts.map((c) => c.canvas), ['repHandleChart', 'repCloseChart']);
  const firstAssign = out.events.indexOf('assign');
  const firstChart = out.events.findIndex((e) => e.indexOf('chart:') === 0);
  assert.ok(firstAssign !== -1 && firstChart > firstAssign, 'drawing must follow the innerHTML assignment');
});

test('the plotted series is the real data, carried through the real render path', () => {
  const out = renderTeam(BASE);
  const handle = out.charts[0].cfg.data.datasets.find((d) => d.label === 'josh');
  assert.deepStrictEqual(handle.data, [14, 26], 'handle-rate line must carry the series values');
  const close = out.charts[1].cfg.data.datasets.find((d) => d.label === 'josh');
  assert.deepStrictEqual(close.data, [43, 25], 'closing-rate line must carry the series values');
});

test('NO dead mount: the graph section is never emitted from inside a callback', () => {
  // The exact defect. teamScoreListHtml's callback must be a bare accessor.
  const fn = HTML.slice(HTML.indexOf('function renderTeamView'), HTML.indexOf('function drawRepSeriesCharts'));
  assert.ok(/teamScoreListHtml\(function \(r\) \{ return r\.avg_score; \}\)/.test(fn),
    'the avg_score callback must contain nothing but its return');
  assert.ok(fn.indexOf('insertAdjacentHTML') === -1,
    'the section is part of the main assembly, not appended afterwards');
});

test('a missing or failed series renders the section WITHOUT throwing', () => {
  [null, { _error: true }].forEach((s) => {
    const out = renderTeam(Object.assign({}, BASE, { teamRepSeries: s, teamRepSeriesLoading: true }));
    assert.ok(out.html.length > 0, 'the view must still render for ' + JSON.stringify(s));
    assert.strictEqual(out.charts.length, 0, 'no chart should be built without a series');
  });
});

test('resetTeamData clears the series so a stale team/range cannot linger', () => {
  const out = renderTeam(BASE);
  assert.ok(out.api.state.teamRepSeries, 'precondition: series present');
  out.api.resetTeamData();
  assert.strictEqual(out.api.state.teamRepSeries, null,
    'switching team or date range must drop the previous lines immediately');
});
