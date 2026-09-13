'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComputed } = require('./helpers/electron-render');
const { documentFor, overviewLoadingFirstPaint } = require('./helpers/observatory-fixture');

function probePage() {
  return `(() => {
    const page = document.querySelector('.observatory-page');
    const hud = document.querySelector('.observatory-hud');
    const rail = document.querySelector('.sidebar');
    const pageRect = page && page.getBoundingClientRect();
    const railRect = rail && rail.getBoundingClientRect();
    const style = page && getComputedStyle(page);
    return {
      page: pageRect && { left: pageRect.left, right: pageRect.right, width: pageRect.width },
      rail: railRect && { right: railRect.right, bottom: railRect.bottom },
      pageOverflow: style && style.overflowX,
      documentWidth: document.documentElement.scrollWidth,
      focus: (() => { const node = document.querySelector('.observatory-overview-focus-grid'); const rect = node && node.getBoundingClientRect(); return rect && { left: rect.left, top: rect.top }; })(),
      instrumentCount: document.querySelectorAll('.observatory-close-instrument, .observatory-overview .glance-tile').length,
      hud: !!hud,
      hudPosition: hud && getComputedStyle(hud).position,
      backgroundAttachment: getComputedStyle(document.body).backgroundAttachment,
      text: document.body.innerText
    };
  })()`;
}

test('overview populated export uses the third-view Observatory structure and stays within desktop/mobile bounds', () => {
  const html = documentFor('overview');
  for (const width of [1920, 390]) {
    const observed = renderComputed(html, probePage(), { width });
    assert.ok(observed.page, 'overview must render an Observatory page at ' + width + 'px');
    assert.ok(observed.page.left >= 0 && observed.page.right <= width, 'overview page must stay inside the viewport at ' + width + 'px');
    assert.ok(observed.documentWidth <= width, 'overview must not create horizontal document overflow at ' + width + 'px');
    assert.match(observed.text, /Closing %/i);
    assert.match(observed.text, /Performance Summary/);
    assert.equal(observed.instrumentCount, 4, 'overview must keep its four top instruments at ' + width + 'px');
  }
  const desktop = renderComputed(html, probePage(), { width: 1920 });
  assert.ok(desktop.page.left <= 32 && 1920 - desktop.page.right <= 32, 'overview desktop gutters must be at most 32px');
  assert.ok(desktop.page.left < desktop.rail.right, 'overview page must retain the established under-rail alignment');
  assert.ok(desktop.focus && desktop.focus.left === desktop.page.left, 'overview focus grid must align to the page edge');
  assert.ok(desktop.focus.top >= desktop.rail.bottom, 'overview focus grid must clear the expanded rail');
  assert.equal(desktop.hudPosition, 'fixed', 'overview HUD must be viewport-fixed');
  assert.ok(desktop.backgroundAttachment.split(',').every((layer) => layer.trim() === 'fixed'), 'overview ground layers must stay fixed');
});

test('overview uses four real glowing instruments and keeps content compact at every viewport', () => {
  const html = documentFor('overview');
  const desktop = renderComputed(html, `(() => {
    const hero = document.querySelector('.observatory-overview-hero');
    const close = document.querySelector('.observatory-close-instrument');
    const metrics = [...document.querySelectorAll('.observatory-metric-instrument')];
    const focus = document.querySelector('.observatory-overview-focus-grid');
    const coach = document.querySelector('.observatory-overview-upper-coach');
    const side = document.querySelector('.observatory-overview-focus-side');
    return {
      tracks: hero.querySelectorAll('.observatory-ring-track').length,
      values: hero.querySelectorAll('.observatory-ring-value').length,
      glows: hero.querySelectorAll('.observatory-ring-glow').length,
      arcs: [...hero.querySelectorAll('.observatory-ring-value')].map((arc) => arc.getAttribute('stroke-dasharray')),
      metrics: metrics.map((node) => { const ring = node.querySelector('.observatory-metric-ring'); return { action: node.getAttribute('onclick'), ring: !!ring, ringWidth: ring && ring.getBoundingClientRect().width }; }),
      closeRingWidth: close.querySelector('.overview-close-ring').getBoundingClientRect().width,
      ringCenters: [close.querySelector('.overview-close-ring'), ...metrics.map((node) => node.querySelector('.observatory-metric-ring'))].map((ring) => { const rect = ring.getBoundingClientRect(); return rect.top + rect.height / 2; }),
      trendBelowRing: !!document.querySelector('.observatory-metric-trend .glance-trend'),
      coachInUpper: coach.parentElement.classList.contains('observatory-upper'),
      focusColumns: getComputedStyle(focus).gridTemplateColumns.split(' ').length,
      focusAlign: getComputedStyle(focus).alignItems,
      sideCards: side.children.length,
      lowerAfterRail: focus.getBoundingClientRect().top >= document.querySelector('.sidebar').getBoundingClientRect().bottom
    };
  })()`, { width: 1920 });
  assert.equal(desktop.tracks, 4, 'Closing, calls, score, and OHR each need a real SVG track');
  assert.equal(desktop.values, 4, 'each measured top metric needs a proportional value arc');
  assert.equal(desktop.glows, 4, 'each measured top metric needs its glow arc');
  assert.deepEqual(desktop.arcs, ['23.00 77.00', '100.00 0.00', '72.00 28.00', '33.00 67.00'], 'each arc must reflect its existing fixture value, not a target');
  assert.equal(desktop.metrics.length, 3, 'the supporting metrics remain three distinct drill targets');
  desktop.metrics.forEach((metric) => {
    assert.ok(metric.ring, 'each supporting metric must render a ring, not text-only tile');
    assert.ok(metric.action, 'each supporting metric keeps its existing drill action');
  });
  assert.deepEqual(desktop.metrics.map((metric) => metric.action), ["drillCalls('analyzed',null)", "drillCalls('analyzed','score')", 'goObjections()'], 'the existing Calls, score, and OHR drills remain intact');
  assert.ok(desktop.closeRingWidth > desktop.metrics[0].ringWidth, 'Closing remains visibly more prominent than a support instrument');
  desktop.ringCenters.forEach((center) => assert.ok(Math.abs(center - desktop.ringCenters[0]) <= 1, 'all four desktop rings share one visual centerline'));
  assert.equal(desktop.trendBelowRing, true, 'the existing score trend remains present below its instrument');
  assert.equal(desktop.coachInUpper, true, 'Coach Summary fills the upper rail-height area');
  assert.equal(desktop.focusColumns, 2, 'the full-width lower content retains its two-column desktop layout');
  assert.equal(desktop.focusAlign, 'start', 'the lower columns must not stretch short cards to a tall neighbour');
  assert.equal(desktop.sideCards, 2, 'Objection focus and Performance Summary stack on the right');
  assert.equal(desktop.lowerAfterRail, true, 'the lower panels begin after the actual rail');

  const mobile = renderComputed(html, `(() => {
    const all = [document.querySelector('.observatory-close-instrument'), ...document.querySelectorAll('.observatory-metric-instrument')];
    return all.map((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  })()`, { width: 390 });
  assert.equal(mobile.length, 4);
  assert.ok(Math.abs(mobile[0].top - mobile[1].top) <= 1, 'mobile first row is Closing and calls');
  assert.ok(mobile[2].top > mobile[0].bottom, 'mobile score moves to the second row');
  assert.ok(Math.abs(mobile[2].top - mobile[3].top) <= 1, 'mobile second row is score and OHR');
  mobile.forEach((rect) => assert.ok(rect.left >= 0 && rect.right <= 390, 'mobile instruments stay in bounds'));
});

function alphaOf(color) {
  const match = /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}

test('overview glass panels reveal the fixed ground while retaining readable edges', () => {
  const observed = renderComputed(documentFor('overview'), `(() => {
    const panels = [...document.querySelectorAll('.observatory-overview-upper-coach, .observatory-overview-focus-grid > .section, .observatory-overview-focus-side > .section')];
    const gauges = [...document.querySelectorAll('.observatory-metric-instrument')];
    const insets = [...document.querySelectorAll('.observatory-overview .team-recs-card, .observatory-overview .pattern-card')];
    return {
      panelColors: panels.map((panel) => getComputedStyle(panel).backgroundColor),
      panelBorders: panels.map((panel) => getComputedStyle(panel).borderTopColor),
      panelShadows: panels.map((panel) => getComputedStyle(panel).boxShadow),
      gaugeSurfaces: gauges.map((gauge) => { const style = getComputedStyle(gauge); return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, blur: style.backdropFilter }; }),
      insetColors: insets.map((panel) => getComputedStyle(panel).backgroundColor),
      hud: (() => { const node = document.querySelector('.observatory-hud'); const style = getComputedStyle(node); return { position: style.position, pointerEvents: style.pointerEvents }; })()
    };
  })()`);
  assert.ok(observed.panelColors.length >= 4, 'the rendered Overview must expose its major glass surfaces');
  observed.panelColors.forEach((color) => assert.ok(alphaOf(color) >= .72 && alphaOf(color) <= .82, 'major panels must remain dark but translucent'));
  assert.ok(observed.insetColors.length > 0, 'the rendered Overview must expose nested glass cards');
  observed.insetColors.forEach((color) => assert.ok(alphaOf(color) >= .32 && alphaOf(color) <= .48, 'nested cards must stay lighter glass, never opaque insets'));
  observed.panelBorders.forEach((color) => assert.ok(alphaOf(color) >= .22, 'glass panels need a visible sage edge'));
  observed.panelShadows.forEach((shadow) => assert.ok(shadow.includes('21, 161, 71'), 'glass panels need their scoped emerald edge bloom'));
  assert.equal(observed.gaugeSurfaces.length, 3, 'the three support values remain distinct gauges');
  observed.gaugeSurfaces.forEach((gauge) => {
    assert.equal(alphaOf(gauge.background), 0, 'support gauges must leave the ground visible');
    assert.equal(gauge.border, '0px', 'support gauges must not regain a card edge');
    assert.equal(gauge.shadow, 'none', 'support gauges must not regain a card shadow');
    assert.equal(gauge.blur, 'none', 'support gauges must not blur the ground');
  });
  assert.deepEqual(observed.hud, { position: 'fixed', pointerEvents: 'none' }, 'the existing fixed noninteractive HUD remains behind content');
});

test('overview HUD honors reduced-motion while preserving its fixed noninteractive layer', () => {
  const observed = renderComputed(documentFor('overview'), `(() => {
    const hud = document.querySelector('.observatory-hud');
    return {
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      orbit: getComputedStyle(document.querySelector('.observatory-hud-orbit')).animationName,
      scan: getComputedStyle(document.querySelector('.observatory-hud-scan')).animationName,
      position: getComputedStyle(hud).position,
      pointerEvents: getComputedStyle(hud).pointerEvents
    };
  })()`, { reducedMotion: true });
  assert.equal(observed.reduced, true, 'the probe must render in reduced-motion mode');
  assert.equal(observed.orbit, 'none', 'reduced-motion stops the existing orbit');
  assert.equal(observed.scan, 'none', 'reduced-motion stops the existing scan');
  assert.equal(observed.position, 'fixed');
  assert.equal(observed.pointerEvents, 'none');
});

test('overview direct boot loader stamps its visual scope before it inserts the fixed HUD', () => {
  const firstPaint = overviewLoadingFirstPaint();
  assert.equal(firstPaint.startedWithoutView, true, 'boot fixture must start without a body data-view hook');
  assert.equal(firstPaint.view, 'overview', 'direct overview loader must stamp its body view hook');
  assert.match(firstPaint.markup, /class="observatory-hud/, 'direct loader must include the Observatory HUD');
  const observed = renderComputed(firstPaint.document, `(() => { const hud = document.querySelector('.observatory-hud'); return { hudPosition: getComputedStyle(hud).position, backgroundAttachment: getComputedStyle(document.body).backgroundAttachment }; })()`);
  assert.equal(observed.hudPosition, 'fixed', 'first-paint HUD must be viewport-fixed before analytics returns');
  assert.ok(observed.backgroundAttachment.split(',').every((layer) => layer.trim() === 'fixed'), 'first-paint background must be fixed before analytics returns');
});

test('overview loading and no-call exports remain truthful while background-off scopes to the overview HUD', () => {
  for (const file of ['overview-loading.html', 'overview-no-calls.html']) {
    const html = require('./helpers/observatory-fixture').documentFor('overview', file.includes('loading')
      ? { analytics2: null, analytics2Loading: true, needsWork: null, needsWorkLoading: true, sectionRank: null, sectionRankLoading: true }
      : { analytics2: { calls: { analyzed: 0, total_in_range: 0, processing: 0, error: 0 }, avg_score: { mean: null, graded_calls: 0 }, objections: { calls_with_objection: 0, total_highlights: 0 }, close_rate: null, close_wins: 0, close_decided: 0, sections: {}, weakest_section: null, strongest_section: null, latest_one_things: [] }, needsWork: { available: false, reason: 'No analyzed calls in this range.' }, sectionRank: { sections: [] } });
    const observed = renderComputed(html, `(() => ({ page: !!document.querySelector('.observatory-page'), hud: !!document.querySelector('.observatory-hud') }))()`);
    assert.equal(observed.page, true, file + ' must keep the overview page shell');
    assert.equal(observed.hud, true, file + ' must keep scoped decoration');
    assert.ok(/Counting your closed prospects|Reading your graded calls|No analyzed calls in this range/.test(html), file + ' must state its data state');
    if (file.includes('no-calls')) {
      assert.ok(/lead-number-val">—/.test(html), 'no-call overview must show an unmeasured closing value');
      assert.equal((html.match(/class="observatory-ring-value"/g) || []).length, 0, 'no-call overview must not draw a filled value arc');
      assert.equal((html.match(/class="observatory-ring-glow"/g) || []).length, 0, 'no-call overview must not draw a glow arc');
      assert.match(html, /class="observatory-ring overview-close-ring observatory-ring--empty"/, 'no-call overview keeps the neutral closing instrument');
      const empty = renderComputed(html, `(() => { const rings = [...document.querySelectorAll('.observatory-overview-hero .observatory-ring--empty')]; return { count: rings.length, filters: rings.map((ring) => getComputedStyle(ring).filter) }; })()`);
      assert.equal(empty.count, 4, 'all four unavailable top metrics remain neutral instruments');
      empty.filters.forEach((filter) => assert.equal(filter, 'none', 'an unavailable metric must not keep a coloured glow'));
    }
  }
  const off = renderComputed(documentFor('overview'), `(() => { document.documentElement.setAttribute('data-bg','off'); const hud = document.querySelector('.observatory-hud'); return { display: getComputedStyle(hud).display, body: getComputedStyle(document.body).backgroundImage }; })()`);
  assert.equal(off.display, 'none', 'background-off must hide only the overview HUD');
});

test('overview HUD motion advances in normal mode and remains noninteractive', () => {
  const observed = renderComputed(documentFor('overview'), `(async () => { const hud = document.querySelector('.observatory-hud'); const orbit = document.querySelector('.observatory-hud-orbit'); const first = getComputedStyle(orbit).transform; await new Promise((resolve) => setTimeout(resolve, 140)); const second = getComputedStyle(orbit).transform; return { first, second, pointerEvents: getComputedStyle(hud).pointerEvents }; })()`);
  assert.notEqual(observed.first, observed.second, 'overview HUD orbit must advance in normal mode');
  assert.equal(observed.pointerEvents, 'none', 'overview HUD must not capture controls');
});
