'use strict';

/*
 * Observatory is presentation around two existing team surfaces. This guard
 * drives their shipped dispatcher so a visual pass cannot accidentally remove
 * the date/team controls, the preserved chart hosts, rep controls, or the
 * coaching call evidence that managers use to act on the page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComputed } = require('./helpers/electron-render');
const { fnBody } = require('./helpers/strip-comments');
const TEAM_AVERAGES = require('../lib/team-averages');

const DASHBOARD = path.join(__dirname, '..', 'web', 'dashboard.html');
const HTML = fs.readFileSync(DASHBOARD, 'utf8');
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/.exec(HTML)[1];
const RAW_SCRIPT = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).sort((a, b) => b.length - a.length)[0];
const SCRIPT = RAW_SCRIPT.replace(/\n\s*init\(\);\s*$/, '\n');
// Run this exact production function in the browser fixture. A source check
// cannot prove that an unusually tall navigation rail clears the lower panels.
const OBSERVATORY_RAIL_SYNC = fnBody(SCRIPT, 'syncObservatoryRailClearance');

const SERIES = {
  buckets: [{ label: 'Sep 7' }, { label: 'Sep 14' }],
  reps: [{ user_id: 'rep-1', name: 'Ava',
    handle: [{ rate: 35, handled: 7, total: 20 }, { rate: 42, handled: 10, total: 24 }],
    close: [{ rate: 20, closed: 4, total: 20 }, { rate: 25, closed: 6, total: 24 }],
    price: [{ value: 18, total: 20 }, { value: 21, total: 24 }] }],
  team: {
    handle: [{ rate: 35, reps_counted: 1, numerator: 7, total: 20 }, { rate: 42, reps_counted: 1, numerator: 10, total: 24 }],
    close: [{ rate: 20, reps_counted: 1, numerator: 4, total: 20 }, { rate: 25, reps_counted: 1, numerator: 6, total: 24 }],
    price: [{ value: 18, reps_counted: 1, total: 20 }, { value: 21, reps_counted: 1, total: 24 }]
  }
};

const REP = {
  user_id: 'rep-1', display_name: 'Ava', calls_analyzed: 24, active: true,
  prospect_close_rate: 25, prospect_close_wins: 6, prospect_close_total: 24,
  obj_handle_rate: 42, obj_handled: 10, obj_total: 24, avg_call_time: 41,
  avg_score: 72, sections: { intro: 75, discovery: 69, pitch: 71, objection: 66, close: 78 },
  weakest_section: { section: 'objection', score: 66 }, weakest_objection: null
};

const AVERAGE_REPS = [
  { closing: { numerator: 11, total: 39 }, objections: { numerator: 14, total: 39 }, calltime: { seconds: 49.4 * 60 * 39, calls: 39 } },
  { closing: { numerator: 7, total: 33 }, objections: { numerator: 11, total: 33 }, calltime: { seconds: 42.0 * 60 * 33, calls: 33 } }
];

// This is the same producer shape as GET /team/averages: its values come from
// the module that pools real route rows, rather than an invented visual fixture.
const AVERAGES = {
  metrics: Object.fromEntries(TEAM_AVERAGES.METRIC_ORDER.map((key) => {
    const metric = TEAM_AVERAGES.METRICS[key];
    const pooled = key === 'calltime'
      ? TEAM_AVERAGES.poolDuration(AVERAGE_REPS)
      : TEAM_AVERAGES.poolRate(AVERAGE_REPS, key);
    return [key, {
      key, label: metric.label, target: metric.target, scale: metric.scale, unit: metric.unit,
      value: pooled.value, numerator: pooled.numerator, total: pooled.total, enough: pooled.enough, reason: pooled.reason,
      unit_name: metric.unitName, numerator_name: metric.numeratorName, direction: metric.direction,
      target_caption: metric.targetCaption, band: TEAM_AVERAGES.band(pooled.value, metric.target, metric.direction, metric.band),
      sweet_spot: metric.band ? { good: metric.band.good, ok: metric.band.ok } : null
    }];
  }))
};

function renderTeamSurface(overrides) {
  let markup = '';
  const charts = [];
  const mounted = {};
  const content = {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = String(value); },
    insertAdjacentHTML(_position, value) { markup += String(value); }
  };
  const document = {
    getElementById(id) {
      if (id === 'content') return content;
      return mounted[id] ? { id, getContext: () => ({ id }) } : null;
    },
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector !== '.rep-graph-slot') return [];
      return [...markup.matchAll(/data-canvas="([^"]+)"/g)].map((match) => ({
        getAttribute: () => match[1], appendChild() { mounted[match[1]] = true; }
      }));
    },
    addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {}, classList: { add() {}, remove() {} }, dataset: {} }, documentElement: { style: {} }
  };
  const Chart = function Chart(context, config) { charts.push({ canvas: context.id, config }); this.destroy = () => {}; };
  const window = {
    Chart, location: { hash: '', search: '', pathname: '/dashboard', href: 'https://example.test/dashboard', replace() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    fetch: () => new Promise(() => {}), matchMedia: () => ({ matches: false, addEventListener() {} }), ScoutAuth: null, history: { replaceState() {} }
  };
  const run = new Function('document', 'window', 'Chart', 'localStorage', 'fetch', 'console',
    SCRIPT + '\nreturn { state, renderTeamSurface };');
  const api = run(document, window, Chart, window.localStorage, window.fetch, { log() {}, warn() {}, error() {} });
  Object.assign(api.state, overrides);
  api.renderTeamSurface();
  return { markup, charts, state: api.state };
}

const PERFORMANCE = {
  view: 'team-performance', teamContext: { teams: [], rep_count: 1 }, teamContextLoading: false,
  teamOverview: { reps: [], per_rep: [REP], totals: {} }, teamOverviewLoading: false,
  teamAverages: AVERAGES, teamAveragesLoading: false, teamRepSeries: SERIES, teamRepSeriesLoading: false,
  teamNeedsWork: { available: false }, teamNeedsWorkLoading: false, teamRecs: { available: true, working: [], improve: [] }, teamRecsLoading: false,
  teamCoachable: { reps: [] }, teamCoachableLoading: false, teamDigest: { available: false }, teamDigestLoading: false,
  teamDetailMetric: null, teamObjectionCategory: '', teamRanges: {}, teamRangeInit: {}
};

function populatedCoachingState() {
  return Object.assign({}, PERFORMANCE, {
    view: 'team-coaching',
    teamOverview: { reps: [], per_rep: [REP], totals: { avg_score: 72 } },
    teamRecs: {
      available: true,
      working: [{ claim: 'Ava made the prospect feel heard before presenting the next step.', data: 'The prospect stayed engaged after the summary.', quote: 'That makes sense to me.', rep: 'Ava', spoke: 'prospect', call_id: 'call-verified', highlight_id: 'highlight-1' }],
      improve: [{ claim: 'Make the next step specific when a prospect needs time.', data: 'The call ended open without a date.', quote: 'Reach out when you are ready.', rep: 'Ava', spoke: 'closer', call_id: 'call-verified', highlight_id: 'highlight-2' }]
    },
    teamCoachable: { reps: [{
      user_id: 'rep-1', name: 'Ava', calls: 1, recent_calls: [],
      period_summary: {
        status: 'ready', from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z', patterns: [],
        coaching: {
          state: 'item', label: 'Close', move: 'asking for the sale', calls: 1, recurring: false,
          example: {
            call_id: 'call-verified', call_date: '2026-09-12T10:00:00.000Z', prospect_name: 'Morgan', outcome: 'follow_up', source: 'fathom',
            observation: 'The prospect asked for time and the call ended without a confirmed next step.',
            recommendation: 'Ask for a specific next step before ending the call.', clip_url: 'https://fathom.video/calls/verified?t=120',
            evidence: [
              { speaker: 'PROSPECT', quote: 'I need a day to think about this.', timestamp_seconds: 120 },
              { speaker: 'CLOSER', quote: 'Of course, reach out when you are ready.', timestamp_seconds: 126 }
            ]
          }
        }
      }
    }] }
  });
}

test('Performance remains an executed team surface: its date/team controls, sorting, cards, filter host, and all three charts survive', () => {
  const out = renderTeamSurface(PERFORMANCE);
  for (const required of ['observatory-page', 'observatory-performance', 'observatory-team-panel', 'observatory-reps-panel', 'dp-btn-team', 'rep-sort', 'rep-card-list', 'repFilterHost']) {
    assert.ok(out.markup.includes(required), 'missing from the dispatched Performance render: ' + required);
  }
  assert.deepEqual(out.charts.map((chart) => chart.canvas), ['repHandleChart', 'repCloseChart', 'repPriceChart'],
    'the existing three chart slots must mount before the new visual treatment is considered safe');
  for (const ringPart of ['observatory-ring-track', 'observatory-ring-glow', 'observatory-ring-value']) {
    assert.ok(out.markup.includes(ringPart), 'the instrument is incomplete: ' + ringPart);
  }
});

test('Coaching remains an executed team surface: one selected closer keeps the verified call, owner-aware review door, and cited evidence', () => {
  const out = renderTeamSurface(populatedCoachingState());
  for (const required of ['observatory-page', 'observatory-coaching', 'observatory-coaching-hero', 'observatory-score-instrument', 'observatory-focus-panel', 'observatory-coaching-workspace-panel', 'dp-btn-team', 'coaching-rep-workspace']) {
    assert.ok(out.markup.includes(required), 'missing from the dispatched Coaching render: ' + required);
  }
  assert.match(out.markup, /data-user="rep-1"[^>]*aria-pressed="true"/, 'the selected member is still identified by their real user id');
  assert.match(out.markup, /data-call="call-verified" data-owner="rep-1"/, 'Review Full Call must keep the evidence call and its rep owner together');
  for (const quotedLine of ['I need a day to think about this.', 'Of course, reach out when you are ready.']) {
    assert.ok(out.markup.includes(quotedLine), 'the visible evidence disclosure lost a verified transcript line');
  }
});

// The source documents static chrome in comments too. The last occurrence is
// the live body element; first-match would export prose as visible HTML.
const CHROME_START = HTML.lastIndexOf('<nav class="top-bar">');
const CONTENT_START = HTML.indexOf('<div id="content">', CHROME_START);
assert.ok(CHROME_START > -1 && CONTENT_START > CHROME_START, 'fixture needs the dashboard’s real top bar, sidebar and page ancestor chain');
const CHROME = HTML.slice(CHROME_START, CONTENT_START);

function visualChrome(view, options) {
  const longNavigation = options && options.longNavigation;
  const baseLinks = ['Performance', 'Coaching'];
  const teamPages = longNavigation
    ? baseLinks.concat(Array.from({ length: 18 }, (_unused, index) => 'Team report ' + (index + 1)))
    : baseLinks;
  const teamLinks = teamPages.map((label) => '<a class="workspace-team-link' + (label.toLowerCase() === view.slice(5) ? ' is-current' : '') + '">' + label + '</a>').join('');
  return CHROME.replace('id="navTeamSep" style="display:none"', 'id="navTeamSep"')
    .replace('id="navTeamWrap" style="display:none"', 'id="navTeamWrap"')
    .replace('<nav class="workspace-team-pages" id="workspaceTeamPages" aria-label="Team pages"></nav>', '<nav class="workspace-team-pages" id="workspaceTeamPages" aria-label="Team pages">' + teamLinks + '</nav>');
}

function visualShell(view, content, options) {
  const productionRailSync = options && options.runProductionRailSync
    ? '<script>' + OBSERVATORY_RAIL_SYNC + ';syncObservatoryRailClearance();</script>'
    : '';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + STYLE + '</style></head><body data-view="' + view + '">'
    + visualChrome(view, options) + '<div id="content">' + content + '</div></main>' + productionRailSync + '</body></html>';
}

test('Observatory decoration stays inside its two approved views and cannot capture interaction or overflow on desktop or mobile', () => {
  const probe = `(() => { const page = document.querySelector('.observatory-page'); const hud = document.querySelector('.observatory-hud'); const style = getComputedStyle(hud); const withHud = document.documentElement.scrollWidth; hud.style.display = 'none'; const withoutHud = document.documentElement.scrollWidth; return { present: !!page && !!hud, contained: !!(page && page.contains(hud)), hudPosition: style.position, hudPointerEvents: style.pointerEvents, pageOverflowX: getComputedStyle(page).overflowX, withHud, withoutHud }; })()`;
  for (const width of [1400, 390]) {
    for (const view of ['team-performance', 'team-coaching']) {
      const rendered = renderTeamSurface(view === 'team-performance' ? PERFORMANCE : populatedCoachingState());
      const observed = renderComputed(visualShell(view, rendered.markup), probe, { width });
      assert.equal(observed.present, true, view + ' width ' + width + ' must render the page and decoration');
      assert.equal(observed.contained, true, 'the decoration belongs to the page it decorates');
      assert.notEqual(observed.hudPosition, 'static', 'the decoration must be layered rather than take layout space');
      assert.equal(observed.hudPointerEvents, 'none', 'artwork must not block existing controls');
      assert.equal(observed.withHud, observed.withoutHud, view + ' width ' + width + ' lets the decorative HUD widen the document');
    }
  }
  const unrelated = renderComputed(visualShell('call-library', '<div class="observatory-page observatory-performance"><div class="observatory-hud" aria-hidden="true"></div></div>'), probe, { width: 1400 });
  assert.equal(unrelated.hudPosition, 'static', 'Observatory styling must not leak into Calls');
});

test('the rendered desktop chrome aligns lower panels to the rail and clears an expanded Team navigation', () => {
  const bounds = `(() => { const box = (selector) => { const node = document.querySelector(selector); const rect = node && node.getBoundingClientRect(); return rect && { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }; const upper = document.querySelector('.observatory-upper'); return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, page: box('#page'), rail: box('.sidebar'), upper: box('.observatory-upper'), lower: box('.observatory-reps-panel, .observatory-coaching-workspace-panel'), upperMinHeight: upper && upper.style.minHeight }; })()`;
  const desktopOptions = { longNavigation: true, runProductionRailSync: true };
  for (const [view, state] of [['team-performance', PERFORMANCE], ['team-coaching', populatedCoachingState()]]) {
    for (const width of [1400, 1024]) {
      const geometry = renderComputed(visualShell(view, renderTeamSurface(state).markup, desktopOptions), bounds, { width });
      for (const [name, box] of Object.entries(geometry)) if (!['viewport', 'documentWidth', 'upperMinHeight'].includes(name)) assert.ok(box, view + ' width ' + width + ' is missing ' + name);
      assert.ok(geometry.rail.bottom - geometry.rail.top > 510, view + ' width ' + width + ' fixture did not expand the navigation rail');
      assert.match(geometry.upperMinHeight, /px$/, view + ' width ' + width + ' did not execute the production rail clearance function');
      assert.ok(geometry.upper.left >= geometry.rail.right - 1, view + ' width ' + width + ' upper content overlaps the rail');
      assert.ok(geometry.lower.top >= geometry.rail.bottom + 8, view + ' width ' + width + ' lower panel starts before the rail ends');
      assert.ok(Math.abs(geometry.lower.left - geometry.rail.left) <= 2,
        view + ' width ' + width + ' lower panel must align to the rail edge');
      assert.ok(Math.abs(geometry.lower.right - geometry.page.right) <= 2,
        view + ' width ' + width + ' lower panel does not span the page');
    }
  }
  for (const [view, state] of [['team-performance', PERFORMANCE], ['team-coaching', populatedCoachingState()]]) {
    const mobile = renderComputed(visualShell(view, renderTeamSurface(state).markup), 'document.documentElement.scrollWidth <= innerWidth', { width: 390 });
    assert.equal(mobile, true, view + ' has horizontal document overflow at 390px');
  }
  const coachingMobileBounds = `(() => { const box = (selector) => { const node = document.querySelector(selector); const rect = node && node.getBoundingClientRect(); return rect && { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; }; return { memberList: box('.coaching-rep-list'), selectedMember: box('.coaching-rep-choice.is-selected'), detail: box('.coaching-rep-detail') }; })()`;
  const mobileCoaching = renderComputed(
    visualShell('team-coaching', renderTeamSurface(populatedCoachingState()).markup),
    coachingMobileBounds,
    { width: 390 }
  );
  for (const [name, box] of Object.entries(mobileCoaching)) assert.ok(box, 'populated Coaching mobile view is missing ' + name);
  assert.ok(mobileCoaching.detail.width >= 280, '390px Coaching detail pane is too narrow to read its evidence');
  assert.ok(mobileCoaching.detail.top >= mobileCoaching.memberList.bottom - 2, '390px Coaching detail must stack below the member list');
  assert.ok(mobileCoaching.selectedMember.height < 100, '390px Coaching selected member control is too tall to scan');
});

test('the HUD stays fixed while the Observatory content scrolls, and desktop lower panels reach the viewport gutters', () => {
  const scrollProbe = `(() => {
    const hud = document.querySelector('.observatory-hud');
    const card = document.querySelector('.rep-card, .team-rep-card, .observatory-focus-panel');
    const before = hud.getBoundingClientRect();
    const cardBefore = card && card.getBoundingClientRect().top;
    const contentHeight = document.documentElement.scrollHeight;
    window.scrollTo(0, 600);
    const after = hud.getBoundingClientRect();
    const cardAfter = card && card.getBoundingClientRect().top;
    return { contentHeight, scrollY, beforeTop: before.top, afterTop: after.top, beforeBottom: before.bottom, afterBottom: after.bottom, cardBefore, cardAfter, backgroundAttachment: getComputedStyle(document.body).backgroundAttachment, position: getComputedStyle(hud).position };
  })()`;
  for (const [view, state] of [['team-performance', PERFORMANCE], ['team-coaching', populatedCoachingState()]]) {
    const rendered = renderTeamSurface(state);
    const tall = rendered.markup + '<div style="height:1800px" aria-hidden="true"></div>';
    const scrolled = renderComputed(visualShell(view, tall), scrollProbe, { width: 1400 });
    assert.ok(scrolled.contentHeight > 1200, view + ' scroll fixture must contain content below the fold');
    assert.ok(scrolled.scrollY >= 500, view + ' rendered page must actually scroll');
    assert.equal(scrolled.position, 'fixed', view + ' HUD must be fixed to the viewport');
    assert.ok(scrolled.backgroundAttachment.split(',').every((layer) => layer.trim() === 'fixed'), view + ' Observatory gradient layers must stay fixed: ' + scrolled.backgroundAttachment);
    assert.equal(scrolled.beforeTop, scrolled.afterTop, view + ' HUD top must not move with document content');
    assert.equal(scrolled.beforeBottom, scrolled.afterBottom, view + ' HUD bottom must not move with document content');
    assert.ok(scrolled.cardBefore !== null && scrolled.cardAfter !== null, view + ' must render a content card');
    assert.ok(Math.abs((scrolled.cardAfter - scrolled.cardBefore) + scrolled.scrollY) <= 2,
      view + ' content card must move with the document by -scrollY');
  }

  const desktopBounds = `(() => {
    const page = document.querySelector('#page').getBoundingClientRect();
    const lower = document.querySelector('.observatory-reps-panel, .observatory-coaching-workspace-panel').getBoundingClientRect();
    const rail = document.querySelector('.sidebar').getBoundingClientRect();
    return { pageLeft: page.left, pageRight: page.right, lowerLeft: lower.left, lowerRight: lower.right, railRight: rail.right };
  })()`;
  for (const [view, state] of [['team-performance', PERFORMANCE], ['team-coaching', populatedCoachingState()]]) {
    const bounds = renderComputed(visualShell(view, renderTeamSurface(state).markup), desktopBounds, { width: 1920 });
    assert.ok(bounds.lowerLeft <= 32, view + ' lower panel left gutter is wider than 32px: ' + bounds.lowerLeft);
    assert.ok(1920 - bounds.lowerRight <= 32, view + ' lower panel right gutter is wider than 32px: ' + (1920 - bounds.lowerRight));
    assert.equal(bounds.lowerLeft, bounds.pageLeft, view + ' lower panel must share the page edge');
    assert.ok(bounds.lowerRight <= 1920, view + ' lower panel must stay inside the viewport');
    assert.ok(bounds.lowerLeft < bounds.railRight, view + ' lower panel must retain the established under-rail alignment');
  }
});

function mediaBlocks(css, query) {
  const blocks = [];
  const opener = new RegExp('@media\\s*\\(' + query + '\\)\\s*\\{', 'g');
  let match;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let end = opener.lastIndex;
    for (; end < css.length && depth; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
    }
    assert.equal(depth, 0, 'unclosed media block for ' + query);
    blocks.push(css.slice(opener.lastIndex, end - 1));
  }
  return blocks;
}

test('the new motion has a reduce-motion override scoped to its own decorative parts', () => {
  const reduced = mediaBlocks(STYLE, 'prefers-reduced-motion:\\s*reduce').join('\n');
  assert.ok(reduced.length, 'the dashboard needs a reduced-motion block');
  for (const selector of ['.observatory-hud-orbit', '.observatory-hud-dot', '.observatory-hud-scan']) {
    assert.ok(reduced.includes(selector), 'reduced motion must include ' + selector);
  }
  assert.match(reduced, /animation\s*:\s*(none|0s)/, 'new decorative movement must stop for reduced motion');
});
