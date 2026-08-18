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

  // ⚠⚠ THE CANVAS NOW ARRIVES BY MOUNT, NOT BY MARKUP (2026-08-18). It used to
  // be emitted inside the innerHTML string, and this stub's load-bearing trick
  // was to hand back a canvas ONLY if that id appeared in the assigned markup —
  // so a chart being built PROVED the canvas existed at draw time.
  //
  // The graph-flash fix moved the canvas out of the markup: the string now
  // carries a SLOT, and mountRepGraphHosts() appends a preserved canvas node
  // into it. Left as it was, this stub would return null forever and the probe
  // would silently prove nothing.
  //
  // So the stub MODELS THE MOUNT instead, and the property is preserved rather
  // than weakened: a canvas is returned only if its slot was in the assigned
  // markup AND the mount step actually ran. Draw-before-assign, and
  // draw-without-mount, both still yield no chart.
  const mounted = {};
  const doc = {
    getElementById(id) {
      if (id === 'content') return contentEl;
      if (!mounted[id]) return null;
      // The context carries the id so the test can tell the two charts apart
      // (repSeriesChart passes getContext('2d'), never the element itself).
      return { id: id, getContext: () => ({ __canvasId: id }) };
    },
    querySelector: () => null,
    querySelectorAll(sel) {
      if (sel !== '.rep-graph-slot') return [];
      // Slots exist only where the assigned markup declares them.
      const ids = (assigned.match(/data-canvas="([^"]+)"/g) || [])
        .map((m) => m.replace(/.*data-canvas="([^"]+)".*/, '$1'));
      return ids.map((id) => ({
        getAttribute: (a) => (a === 'data-canvas' ? id : null),
        appendChild() { mounted[id] = true; events.push('mount:' + id); },
      }));
    },
    addEventListener() {},
    createElement: () => ({ style: {}, className: '', classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {}, classList: { add() {}, remove() {} }, dataset: {} },
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
    SCRIPT + '\n;return { state: state, renderTeamView: renderTeamView, resetTeamData: resetTeamData,'
           + ' viewToHashPath: viewToHashPath, parseRangeFromHash: parseRangeFromHash,'
           + ' renderOverview: renderOverview };');

  const api = runner(doc, win, Chart, win.localStorage, win.fetch,
    { log() {}, warn() {}, error() {} });

  Object.assign(api.state, overrides);
  if (overrides && overrides.__entry === 'overview') api.renderOverview(false);
  else api.renderTeamView();
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

test('the graphs are the FIRST thing on the team view, above the needs-work card', () => {
  // The glance stat card was removed 2026-08-16 (Justin, twice), so the graphs
  // now sit directly under the header — which is what "the first thing he wants
  // to see" asked for in the first place.
  const out = renderTeam(BASE);
  const header = out.html.indexOf('page-header');
  const graphs = out.html.indexOf('repHandleChart');
  // Anchor renamed 2026-08-17: the team objection card is now titled
  // "Objection Handling Focus". The ordering property is unchanged — this is
  // the anchor moving, not the claim.
  const needsWork = out.html.indexOf('Objection Handling Focus');
  const overview = out.html.indexOf('Team Overview');

  assert.notStrictEqual(graphs, -1, 'graph canvas missing');
  assert.notStrictEqual(needsWork, -1, 'needs-work heading missing — anchor is stale');
  assert.notStrictEqual(overview, -1, 'Team Overview heading missing — anchor is stale');
  assert.notStrictEqual(header, -1, 'page header missing — anchor is stale');

  assert.ok(header < graphs, 'graphs come after the header');
  assert.ok(graphs < needsWork, 'graphs must come BEFORE the needs-work card');
  assert.ok(graphs < overview, 'graphs must come BEFORE Team Overview');
  assert.strictEqual(out.html.indexOf('team-glance'), -1, 'the glance card must be gone');
});

test('removing the glance card left its drill-down machinery intact', () => {
  // Restoring the card is re-adding one line. Nothing else was ripped out, so
  // the trade Justin overruled stays cheaply reversible.
  assert.ok(/function openTeamDetail/.test(HTML));
  assert.ok(/var TEAM_DETAIL = \{/.test(HTML));
  assert.ok(/function teamAggregateHtml/.test(HTML), 'the builder itself is kept');
  assert.ok(/REMOVED 2026-08-16/.test(HTML), 'and the removal is commented in place');
});

test('the charts are built AFTER the canvases are in the DOM', () => {
  // The stub returns a canvas only when the assigned markup contains it, so a
  // chart existing here is proof of ordering, not an assumption about it.
  const out = renderTeam(BASE);
  // ⚠ NAMED AND IN BUILD ORDER. A bare count went stale the moment item (j)
  // added the third graph, and a count would also pass if the WRONG three were
  // built. This assertion already did it right — only the list needed extending.
  assert.deepStrictEqual(out.charts.map((c) => c.canvas),
    ['repHandleChart', 'repCloseChart', 'repPriceChart'],
    'all three graphs, in order; got ' + JSON.stringify(out.charts.map((c) => c.canvas)));
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

// ─── STAGE 2: the team date picker, driven through the real render path ────

test('renderTeamView renders the PICKER and no preset buttons', () => {
  const out = renderTeam(Object.assign({}, BASE, {
    teamRange: { from: '2026-08-03T00:00:00.000Z', to: '2026-08-10T23:59:59.999Z' }, teamRangeInit: true,
  }));
  assert.ok(out.html.indexOf('dp-btn-team') !== -1, 'the picker trigger must be in the rendered markup');
  assert.ok(out.html.indexOf('Aug 3 - Aug 10') !== -1, 'showing the INCLUSIVE label for the custom range');
  assert.ok(!/onclick="setTeamRange\(/.test(out.html), 'the 7d/30d/90d buttons must be gone');
});

test('a CUSTOM range reaches the graphs, the picker label and the hash — all agreeing', () => {
  // The three had to be checked together: a label that says one thing while the
  // graphs query another is exactly the kind of disagreement nobody notices.
  const range = { from: '2026-07-20T00:00:00.000Z', to: '2026-08-02T23:59:59.999Z' };
  const out = renderTeam(Object.assign({}, BASE, { teamRange: range, teamRangeInit: true }));
  assert.ok(out.html.indexOf('Jul 20 - Aug 2') !== -1, 'label');
  assert.strictEqual(out.api.state.teamRange.from, range.from, 'the view did not mutate the range');
  const hash = out.api.viewToHashPath();
  assert.strictEqual(hash, 'team?from=2026-07-20&to=2026-08-02', 'hash carries the range');
  assert.strictEqual(out.charts.length, 3, 'all three graphs still built');
});

test('the hash round-trips: parse → state → hash gives back the same window', () => {
  const out = renderTeam(BASE);
  const parsed = out.api.parseRangeFromHash('team?from=2026-06-01&to=2026-06-30');
  assert.deepStrictEqual(parsed, { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' });
  out.api.state.teamRange = parsed;
  assert.strictEqual(out.api.viewToHashPath(), 'team?from=2026-06-01&to=2026-06-30');
});

test('a malformed or hand-edited hash falls back rather than rendering a bogus window', () => {
  const out = renderTeam(BASE);
  ['team', 'team?from=nonsense&to=2026-06-30', 'team?from=2026-06-01',
   'team?from=2026-13-45&to=2026-06-30', 'team?from=&to='].forEach((h) => {
    assert.strictEqual(out.api.parseRangeFromHash(h), null, h);
  });
});

test('a reversed hash range is tolerated the same way the picker tolerates it', () => {
  const out = renderTeam(BASE);
  assert.deepStrictEqual(out.api.parseRangeFromHash('team?from=2026-06-30&to=2026-06-01'),
    { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' });
});

test('TEAM AND COACHING NOW HOLD SEPARATE RANGES', () => {
  // The split starts here. Coaching stays on state.dateRange until stage 3;
  // nothing the team picker does may touch it.
  const out = renderTeam(Object.assign({}, BASE, {
    teamRange: { from: '2026-08-03T00:00:00.000Z', to: '2026-08-10T23:59:59.999Z' }, teamRangeInit: true,
    dateRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z', days: 30 },
  }));
  assert.ok(out.html.indexOf('Aug 3 - Aug 10') !== -1, 'team renders ITS range');
  assert.strictEqual(out.api.state.dateRange.from, '2026-01-01T00:00:00.000Z',
    "coaching's range must be untouched by rendering team");
});

test('the default seed is the last 7 days INCLUSIVE, not a bare now-minus-7', () => {
  const out = renderTeam(Object.assign({}, BASE, { teamRange: null, teamRangeInit: false }));
  const r = out.api.state.teamRange;
  assert.ok(r && r.from.endsWith('T00:00:00.000Z'), 'starts at midnight: ' + (r && r.from));
  assert.ok(r && r.to.endsWith('T23:59:59.999Z'), 'covers the whole end day: ' + (r && r.to));
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000);
  assert.strictEqual(days, 7, 'seven inclusive days');
});

// ─── 10c-2: the rep cards, driven through the real render path ────────────

const REPS = [
  { user_id: 'u-josh', display_name: 'josh', calls_analyzed: 155,
    prospect_close_rate: 27, prospect_close_wins: 39, prospect_close_total: 142,
    obj_handle_rate: 13, obj_handled: 17, obj_total: 132,
    sections: { intro: 57, discovery: 47, pitch: 65, objection: 64, close: 64 },
    weakest_section: { section: 'discovery', score: 47 },
    weakest_objection: { category: 'timing', rate: 7, handled: 3, total: 42,
                         comparable: false, team_rate: null, is_lowest: null } },
  { user_id: 'u-ava', display_name: 'demo-ava', calls_analyzed: 5,
    prospect_close_rate: null, prospect_close_wins: 0, prospect_close_total: 0,
    obj_handle_rate: 14, obj_handled: 1, obj_total: 7,
    sections: { intro: 71, discovery: 45, pitch: 67, objection: 56, close: 50 },
    weakest_section: { section: 'discovery', score: 45 },
    weakest_objection: null },
  { user_id: 'u-zed', display_name: 'zed', calls_analyzed: 9,
    prospect_close_rate: 5, prospect_close_wins: 1, prospect_close_total: 20,
    obj_handle_rate: null, obj_handled: 0, obj_total: 0,
    sections: {}, weakest_section: null,
    weakest_objection: { category: 'partner', rate: 9, handled: 1, total: 11,
                         comparable: true, team_rate: 24, is_lowest: true } },
];

function renderCards(reps) {
  return renderTeam(Object.assign({}, BASE, {
    teamOverview: { reps: [], per_rep: reps, totals: {} }, teamOverviewLoading: false,
  }));
}

test('10c-2: a card renders per rep, SORTED WORST FIRST', () => {
  const out = renderCards(REPS);
  const order = ['zed', 'josh', 'demo-ava'].map((n) => out.html.indexOf('>' + n + '<'));
  order.forEach((i, k) => assert.notStrictEqual(i, -1, 'missing card: ' + ['zed','josh','demo-ava'][k]));
  assert.ok(order[0] < order[1], 'zed (5%) before josh (27%)');
  assert.ok(order[1] < order[2], 'the rep with NO prospects sorts last');
});

test('rates render WITH their raw counts, per the house rule', () => {
  const out = renderCards(REPS);
  assert.ok(out.html.indexOf('39 of 142 prospects') !== -1, 'closing counts');
  assert.ok(out.html.indexOf('17 of 132 handled') !== -1, 'objection counts');
  assert.ok(out.html.indexOf('3 of 42 handled') !== -1, 'weakest-objection counts');
});

test('UNMEASURED IS SAID IN WORDS, never a bare dash that reads as zero', () => {
  const out = renderCards(REPS);
  assert.ok(out.html.indexOf('No prospects yet') !== -1, 'a rep with no prospects says so');
  assert.ok(out.html.indexOf('No objections yet') !== -1, 'and one with no objections');
  // And crucially: NO dash is rendered as the value either. A big "—" where a
  // percentage goes reads as zero however the line beneath it is worded.
  const avaCard = out.html.slice(out.html.indexOf('>demo-ava<'), out.html.indexOf('>demo-ava<') + 1400);
  assert.strictEqual(avaCard.indexOf('rep-stat-val">\u2014'), -1, 'no dash as a stat value');
  assert.ok(out.html.indexOf('not enough objections yet to judge a category') !== -1);
  assert.ok(out.html.indexOf('no scored sections yet') !== -1);
});

test('THE TEAM COMPARISON APPEARS ONLY WHEN IT QUALIFIES', () => {
  const out = renderCards(REPS);
  // zed qualifies (comparable true) — josh does not.
  assert.ok(out.html.indexOf('team 24%') !== -1, 'a qualifying comparison is shown');
  assert.ok(out.html.indexOf('lowest on the team') !== -1);
  const joshCard = out.html.slice(out.html.indexOf('>josh<'), out.html.indexOf('>demo-ava<'));
  assert.ok(joshCard.indexOf('Timing 7%') !== -1, 'josh still gets his own rate');
  assert.ok(joshCard.indexOf('team ') === -1, 'but NO ranking off n=1');
  assert.ok(joshCard.indexOf('lowest on the team') === -1);
});

test('the weakest SECTION renders with its score and a human label', () => {
  const out = renderCards(REPS);
  assert.ok(out.html.indexOf('Discovery 47') !== -1);
  assert.ok(out.html.indexOf('discovery 47') === -1, 'label should be the human form');
});

test('cards click through via the EXISTING pivot, not a parallel path', () => {
  const out = renderCards(REPS);
  assert.ok(/onclick="setUser\('u-josh'\)"/.test(out.html));
});

test('10d: the verified sentence renders on the card when it has loaded', () => {
  const out = renderTeam(Object.assign({}, BASE, {
    teamOverview: { reps: [], per_rep: REPS, totals: {} }, teamOverviewLoading: false,
    teamWhy: { by_rep: { 'u-josh': { sentence: 'Josh closed 39 of 142 prospects (27%).', tier: 2 } } },
  }));
  assert.ok(out.html.indexOf('rep-why') !== -1);
  assert.ok(out.html.indexOf('Josh closed 39 of 142 prospects (27%).') !== -1);
});

test('10d: a card WITHOUT a sentence renders complete, with no placeholder', () => {
  // Absent while loading and absent on failure. A spinner or a half-sentence in
  // a summary slot is worse than nothing.
  const out = renderTeam(Object.assign({}, BASE, {
    teamOverview: { reps: [], per_rep: REPS, totals: {} }, teamOverviewLoading: false,
    teamWhy: { by_rep: { 'u-josh': { sentence: 'x', tier: 1 } } },
  }));
  const avaCard = out.html.slice(out.html.indexOf('>demo-ava<'), out.html.indexOf('>demo-ava<') + 1600);
  assert.strictEqual(avaCard.indexOf('rep-why'), -1, 'no empty slot for a rep with no sentence');
  assert.ok(avaCard.indexOf('Discovery 45') !== -1, 'the rest of the card is intact');
});

test('10d loads LAZILY and is cleared when the team or range changes', () => {
  assert.ok(/why:\s*\{ flag: 'teamWhyLoading'/.test(HTML), 'has its own loader entry');
  const reset = HTML.slice(HTML.indexOf('function resetTeamData'), HTML.indexOf('function renderTeamSurface'));
  assert.ok(/state\.teamWhy = null/.test(reset), 'stale sentences must not survive a range change');
});

test('the cards sit between the graphs and the needs-work card', () => {
  const out = renderCards(REPS);
  const graphs = out.html.indexOf('repHandleChart');
  const cards = out.html.indexOf('rep-card-list');
  const needs = out.html.indexOf('Objection Handling Focus');
  [graphs, cards, needs].forEach((i) => assert.notStrictEqual(i, -1));
  assert.ok(graphs < cards && cards < needs, 'graphs → cards → needs work');
});

test('an empty or still-loading team degrades without throwing', () => {
  const empty = renderCards([]);
  assert.ok(empty.html.indexOf('No reps in this team yet') !== -1);
  const loading = renderTeam(Object.assign({}, BASE, { teamOverview: null, teamOverviewLoading: true }));
  assert.ok(loading.html.length > 0, 'still renders');
});

test('MIRROR GUARD: the inline sort matches lib/rep-card-metrics', () => {
  // The page has no module loader, so the sort is duplicated. This fails if the
  // two ever disagree — the same pattern as section-breakdown-mirror.
  const lib = require('../lib/rep-card-metrics').sortRepsWorstFirst;
  const inline = new Function(
    HTML.slice(HTML.indexOf('function sortRepsWorstFirst'), HTML.indexOf('function repCardsHtml'))
    + '; return sortRepsWorstFirst;')();
  const fixtures = [
    REPS,
    [{ display_name: 'a', prospect_close_rate: 0, prospect_close_total: 5 },
     { display_name: 'b', prospect_close_rate: null, prospect_close_total: 0 }],
    [], null,
  ];
  fixtures.forEach((f) => {
    assert.deepStrictEqual((inline(f) || []).map((r) => r.display_name),
                           (lib(f) || []).map((r) => r.display_name), JSON.stringify(f));
  });
});

// ─── 10e: the pivoted rep's own graph, through the real render path ────────

function renderOverviewAs(overrides) {
  const out = renderTeam(Object.assign({
    __entry: 'overview',
    view: 'overview',
    me: { user_id: 'mgr', role: 'manager' },
    viewingUserId: 'u-josh',
    dateRange: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-14T23:59:59.999Z' },
    // The REAL analytics2 shape from lib/session-analytics — a made-up one threw
    // inside renderCoachingOverview and exercised nothing.
    analytics2: {
      calls: { analyzed: 10, total_in_range: 10, processing: 0, error: 0 },
      avg_score: { mean: 60, graded_calls: 10, win_mean: null, win_n: 0, other_mean: null, other_n: 0 },
      objections: { calls_with_objection: 4, total_highlights: 9 },
      cash_collected: 0, close_rate: null, close_wins: 0, close_decided: 0,
      sections: { intro: { mean: 57, n: 10 }, discovery: { mean: 47, n: 10 }, pitch: { mean: 65, n: 10 },
                  objection: { mean: 64, n: 10 }, close: { mean: 64, n: 10 } },
      weakest_section: 'discovery', strongest_section: 'pitch', latest_one_things: [],
    },
    needsWork: { available: false }, needsWorkLoading: false,
    repGraph: null, repGraphLoading: false,
  }, overrides));
  return out;
}

const REP_SERIES = {
  buckets: [{ label: 'Aug 3' }, { label: 'Aug 10' }],
  reps: [
    { user_id: 'u-josh', name: 'josh', handle: [{ rate: 14, handled: 1, total: 7 }, { rate: 26, handled: 5, total: 19 }],
      close: [{ rate: 40, closed: 2, total: 5 }, { rate: 20, closed: 1, total: 5 }] },
    { user_id: 'u-other', name: 'someone else', handle: [{ rate: 90, handled: 9, total: 10 }, { rate: 80, handled: 8, total: 10 }],
      close: [{ rate: 50, closed: 1, total: 2 }, { rate: 50, closed: 1, total: 2 }] },
  ],
  team: { handle: [{ rate: 52, reps_counted: 2, numerator: 10, total: 17 }, { rate: 53, reps_counted: 2, numerator: 13, total: 29 }],
          close:  [{ rate: 43, reps_counted: 2, numerator: 3, total: 7 }, { rate: 29, reps_counted: 2, numerator: 2, total: 7 }] },
};

test('10e: THE GRAPH SHOWS THAT REP\'S LINE, NOT THE WHOLE TEAM\'S', () => {
  // The failure to guard against is a rep page rendering team data.
  const out = renderOverviewAs({ repGraph: REP_SERIES });
  assert.strictEqual(out.charts.length, 1, 'exactly one chart on the rep report');
  const labels = out.charts[0].cfg.data.datasets.map((d) => d.label);
  assert.ok(labels.indexOf('josh') !== -1, "the pivoted rep's own line is present");
  assert.strictEqual(labels.indexOf('someone else'), -1, 'another rep must NOT appear');
  const mine = out.charts[0].cfg.data.datasets.find((d) => d.label === 'josh');
  assert.deepStrictEqual(mine.data, [14, 26], "and it carries THAT rep's numbers");
});

test('10e: the team average stays as a labelled reference line', () => {
  const out = renderOverviewAs({ repGraph: REP_SERIES });
  const team = out.charts[0].cfg.data.datasets.find((d) => d.label === 'Team average');
  assert.ok(team, 'a single line with nothing to read it against says little');
  assert.deepStrictEqual(team.data, [52, 53]);
});

test('10e: NOT shown on your OWN report, nor to a non-manager', () => {
  const own = renderOverviewAs({ viewingUserId: 'mgr', repGraph: REP_SERIES });
  assert.strictEqual(own.charts.length, 0, 'your own coaching page is unchanged');
  const rep = renderOverviewAs({ me: { user_id: 'mgr', role: 'user' }, repGraph: REP_SERIES });
  assert.strictEqual(rep.charts.length, 0, 'a plain user never sees it');
});

test('10e: it windows by COACHING\'s range, not the team\'s', () => {
  // Using the team range here would show a graph disagreeing with every other
  // number on the same screen.
  const loader = HTML.slice(HTML.indexOf('async function loadRepGraph'), HTML.indexOf('function repOwnSeries'));
  assert.ok(/state\.dateRange/.test(loader));
  assert.ok(!/state\.teamRange/.test(loader));
  assert.ok(/bucketForRange\(r\)/.test(loader), 'and shares the stage-5 bucket thresholds');
});

test('10e: reuses /team/rep-series — no parallel route', () => {
  const loader = HTML.slice(HTML.indexOf('async function loadRepGraph'), HTML.indexOf('function repOwnSeries'));
  assert.ok(/\/team\/rep-series\?/.test(loader));
});

test('10e: a stale rep\'s line cannot survive a pivot or a range change', () => {
  const setUser = HTML.slice(HTML.indexOf('function setUser'), HTML.indexOf('function setCoachingRange') > HTML.indexOf('function setUser')
    ? HTML.indexOf('function setCoachingRange') : HTML.length);
  assert.ok(/state\.repGraph = null/.test(HTML.slice(HTML.indexOf('function setUser'), HTML.indexOf('function setUser') + 700)),
    'setUser must clear it');
  const range = HTML.slice(HTML.indexOf('function setCoachingRange'), HTML.indexOf('function setCoachingRange') + 700);
  assert.ok(/state\.repGraph = null/.test(range), 'a range change must clear it too');
});

test('10e: no data for that rep renders a plain message, not an empty canvas', () => {
  const out = renderOverviewAs({ repGraph: { buckets: [], reps: [], team: { handle: [], close: [] } } });
  assert.strictEqual(out.charts.length, 0);
  assert.ok(out.html.indexOf('No objection data for this rep') !== -1);
});

test('10e: the chart is drawn AFTER the canvas is in the DOM', () => {
  const out = renderOverviewAs({ repGraph: REP_SERIES });
  const firstAssign = out.events.indexOf('assign');
  const firstChart = out.events.findIndex((e) => e.indexOf('chart:') === 0);
  assert.ok(firstAssign !== -1 && firstChart > firstAssign);
});
