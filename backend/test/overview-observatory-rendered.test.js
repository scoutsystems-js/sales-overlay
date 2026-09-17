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
      focus: (() => { const node = document.querySelector('.observatory-coaching-brief'); const rect = node && node.getBoundingClientRect(); return rect && { left: rect.left, top: rect.top }; })(),
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
    assert.match(observed.text, /YOUR EDGE/);
    assert.match(observed.text, /YOUR FOCUS/);
    assert.equal(observed.instrumentCount, 3, 'overview must keep its three top instruments at ' + width + 'px');
  }
  const desktop = renderComputed(html, probePage(), { width: 1920 });
  assert.ok(desktop.page.left <= 32 && 1920 - desktop.page.right <= 32, 'overview desktop gutters must be at most 32px');
  assert.ok(desktop.page.left < desktop.rail.right, 'overview page must retain the established under-rail alignment');
  assert.ok(desktop.focus && desktop.focus.left >= desktop.rail.right, 'overview focus grid must remain in the main column beside the rail');
  assert.equal(desktop.hudPosition, 'fixed', 'overview HUD must be viewport-fixed');
  assert.ok(desktop.backgroundAttachment.split(',').every((layer) => layer.trim() === 'fixed'), 'overview ground layers must stay fixed');
});

test('overview uses three real glowing instruments in the requested order and keeps content compact at every viewport', () => {
  const html = documentFor('overview').replace('</style>', '.sidebar{min-height:520px!important;}</style>');
  const desktop = renderComputed(html, `(() => {
    const hero = document.querySelector('.observatory-overview-hero');
    const close = document.querySelector('.observatory-close-instrument');
    const metrics = [...document.querySelectorAll('.observatory-metric-instrument')];
    const focus = document.querySelector('.observatory-coaching-brief');
    const closingLink = close;
    let callsNavigationCount = 0;
    window.goCallLibrary = () => { callsNavigationCount++; };
    const callsNavigationPrevented = !closingLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const heroRect = hero.getBoundingClientRect();
    const focusRect = focus.getBoundingClientRect();
    const railRect = document.querySelector('.sidebar').getBoundingClientRect();
    return {
      tracks: hero.querySelectorAll('.observatory-visor-track').length,
      values: hero.querySelectorAll('.observatory-visor-arc').length,
      glows: hero.querySelectorAll('.observatory-visor-arc-glow').length,
      arcs: [...hero.querySelectorAll('.observatory-visor-arc')].map((arc) => arc.getAttribute('stroke-dasharray')),
      outerTicks: hero.querySelectorAll('.observatory-visor-ticks').length,
      outerContours: hero.querySelectorAll('.observatory-visor-contours').length,
      staticNumerals: [...hero.querySelectorAll('.observatory-visor-value')].map((node) => node.textContent),
      labels: [close.querySelector('.lead-number-label').textContent, ...metrics.map((node) => node.querySelector('.glance-label').textContent)],
      metrics: metrics.map((node) => { const ring = node.querySelector('.observatory-visor-gauge'); return { action: node.getAttribute('onclick'), ring: !!ring, ringWidth: ring && ring.getBoundingClientRect().width }; }),
      closeLink: closingLink && { tag: closingLink.tagName, href: closingLink.getAttribute('href'), action: closingLink.getAttribute('onclick'), callsNavigationCount, callsNavigationPrevented },
      closeRingWidth: close.querySelector('.observatory-visor-gauge').getBoundingClientRect().width,
      ringTops: [close.querySelector('.observatory-visor-gauge'), ...metrics.map((node) => node.querySelector('.observatory-visor-gauge'))].map((ring) => ring.getBoundingClientRect().top),
      trendBelowRing: !!document.querySelector('.observatory-metric-trend .glance-trend'),
      focusInUpper: focus.parentElement.classList.contains('observatory-upper'),
      focusStartsAfterHero: focusRect.top >= heroRect.bottom && focusRect.top - heroRect.bottom <= 32,
      briefChildren: focus.querySelectorAll('.coaching-brief-story').length,
      proof: focus.querySelector('.coaching-brief-proof').innerText,
      focusColumns: getComputedStyle(focus.querySelector('.coaching-brief-main')).gridTemplateColumns.split(' ').length
    };
  })()`, { width: 1920 });
  assert.equal(desktop.tracks, 3, 'Closing, OHR, and score each need a real SVG track');
  assert.equal(desktop.outerTicks, 3, 'each gauge keeps its rotating outer tick group');
  assert.equal(desktop.outerContours, 3, 'each gauge keeps its counter-rotating contour group');
  assert.deepEqual(desktop.staticNumerals, ['23%', '33%', '72'], 'the static Visor numerals retain existing metric values');
  assert.equal(desktop.values, 3, 'each measured top metric needs a proportional value arc');
  assert.equal(desktop.glows, 3, 'each measured top metric needs its glow arc');
  assert.deepEqual(desktop.arcs, ['46.00 100', '33.00 100', '72.00 100'], 'each arc must reflect its existing fixture value, not a target');
  assert.deepEqual(desktop.labels, ['Closing %', 'Objection handle rate', 'Avg call score'], 'the three gauges follow the requested left-to-right order');
  assert.equal(desktop.metrics.length, 2, 'OHR and score remain the two supporting drill targets');
  assert.deepEqual(desktop.metrics.map((metric) => metric.action), ['goObjections()', "drillCalls('analyzed','score')"], 'OHR and score keep their existing drill actions');
  desktop.metrics.forEach((metric) => assert.ok(metric.ring, 'each supporting metric must render a ring, not text-only tile'));
  assert.deepEqual(desktop.closeLink, { tag: 'A', href: '#call-library', action: 'goCallLibrary(); return false;', callsNavigationCount: 1, callsNavigationPrevented: true }, 'Closing must use the regular Calls-page navigation');
  assert.ok(Math.abs(desktop.closeRingWidth - 244) <= 1, 'Closing restores its earlier 244px desktop bounding width');
  desktop.metrics.forEach((metric) => assert.ok(Math.abs(metric.ringWidth - 216) <= 1, 'support gauges restore their earlier 216px desktop bounding width'));
  desktop.ringTops.forEach((top) => assert.ok(Math.abs(top - desktop.ringTops[0]) <= 1, 'the restored unequal bounds keep all three gauges aligned at their top edge'));
  assert.equal(desktop.trendBelowRing, true, 'the existing score trend remains present below its instrument');
  assert.equal(desktop.focusInUpper, true, 'the brief sits directly below the gauges in the main column');
  assert.equal(desktop.focusStartsAfterHero, true, 'the brief begins immediately after the hero');
  assert.equal(desktop.briefChildren, 2, 'the board has only an edge and a focus story');
  assert.match(desktop.proof, /YOUR COACHING PLAYBOOK/, 'the proof names the established coaching source');
  assert.match(desktop.proof, /Clarify the real concern before answering it/, 'the focus uses the saved objection playbook');
  assert.match(desktop.proof, /WHAT WORKED/, 'the brief names the evidence-backed move to repeat');
  assert.doesNotMatch(desktop.proof, /Let me slow down and understand/, 'a raw closer fragment is not presented as the lesson');
  assert.equal(desktop.focusColumns, 2, 'the short coaching stories sit side by side on desktop');

  const mobile = renderComputed(html, `(() => {
    const all = [document.querySelector('.observatory-close-instrument'), ...document.querySelectorAll('.observatory-metric-instrument')];
    return all.map((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  })()`, { width: 390 });
  assert.equal(mobile.length, 3);
  assert.ok(mobile[1].top > mobile[0].bottom, 'mobile Closing gets a centered first row');
  assert.ok(mobile[2].top > mobile[1].bottom, 'narrow mobile stacks OHR and Avg call score so Visor calibration stays readable');
  mobile.forEach((rect) => assert.ok(rect.left >= 0 && rect.right <= 390, 'mobile instruments stay in bounds'));
});

function alphaOf(color) {
  const match = /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}

test('overview glass panels reveal the fixed ground while retaining readable edges', () => {
  const observed = renderComputed(documentFor('overview'), `(() => {
    const panels = [...document.querySelectorAll('.observatory-coaching-brief')];
    const gauges = [...document.querySelectorAll('.observatory-metric-instrument')];
    return {
      panelColors: panels.map((panel) => getComputedStyle(panel).backgroundColor),
      panelImages: panels.map((panel) => getComputedStyle(panel).backgroundImage),
      panelBorders: panels.map((panel) => getComputedStyle(panel).borderTopColor),
      panelShadows: panels.map((panel) => getComputedStyle(panel).boxShadow),
      gaugeSurfaces: gauges.map((gauge) => { const style = getComputedStyle(gauge); return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, blur: style.backdropFilter }; }),
      hud: (() => { const node = document.querySelector('.observatory-hud'); const style = getComputedStyle(node); return { position: style.position, pointerEvents: style.pointerEvents }; })()
    };
  })()`);
  assert.equal(observed.panelColors.length, 1, 'the concise overview has one major glass coaching surface');
  observed.panelColors.forEach((color) => assert.equal(alphaOf(color), 0, 'approved Visor panels use a translucent gradient rather than a solid fill'));
  observed.panelImages.forEach((image) => assert.match(image, /linear-gradient/, 'major panels retain the approved Visor glass gradient'));
  observed.panelBorders.forEach((color) => assert.ok(alphaOf(color) >= .22, 'glass panels need a visible sage edge'));
  observed.panelShadows.forEach((shadow) => assert.notEqual(shadow, 'none', 'glass panels need their scoped emerald edge bloom'));
  assert.equal(observed.gaugeSurfaces.length, 2, 'the two support values remain distinct gauges');
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
      assert.ok(/observatory-visor-value[^>]*>—/.test(html), 'no-call overview must show an unmeasured closing value');
      assert.equal((html.match(/class="observatory-visor-arc"/g) || []).length, 0, 'no-call overview must not draw a filled value arc');
      assert.equal((html.match(/class="observatory-visor-arc-glow"/g) || []).length, 0, 'no-call overview must not draw a glow arc');
      assert.match(html, /observatory-visor-gauge observatory-visor--empty/, 'no-call overview keeps the neutral closing instrument');
      const empty = renderComputed(html, `(() => { const rings = [...document.querySelectorAll('.observatory-overview-hero .observatory-visor--empty')]; return { count: rings.length, filters: rings.map((ring) => getComputedStyle(ring).filter) }; })()`);
      assert.equal(empty.count, 3, 'all three unavailable top metrics remain neutral instruments');
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

test('Visor moves only its outer surveying detail and respects reduced motion', () => {
  const normal = renderComputed(documentFor('overview'), `(async () => {
    const tick = document.querySelector('.observatory-visor-ticks');
    const contour = document.querySelector('.observatory-visor-contours');
    const value = document.querySelector('.observatory-visor-value');
    const first = { tick: getComputedStyle(tick).transform, contour: getComputedStyle(contour).transform, value: getComputedStyle(value).transform };
    await new Promise((resolve) => setTimeout(resolve, 140));
    const second = { tick: getComputedStyle(tick).transform, contour: getComputedStyle(contour).transform, value: getComputedStyle(value).transform };
    return { first, second, tickAnimation: getComputedStyle(tick).animationName, contourAnimation: getComputedStyle(contour).animationName };
  })()`);
  assert.notEqual(normal.first.tick, normal.second.tick, 'outer tick marks must advance');
  assert.notEqual(normal.first.contour, normal.second.contour, 'outer contours must advance');
  assert.equal(normal.first.value, normal.second.value, 'the metric numeral must remain stationary');
  assert.equal(normal.tickAnimation, 'observatory-visor-tick-spin');
  assert.equal(normal.contourAnimation, 'observatory-visor-contour-spin');

  const reduced = renderComputed(documentFor('overview'), `(() => ({
    ticks: getComputedStyle(document.querySelector('.observatory-visor-ticks')).animationName,
    contours: getComputedStyle(document.querySelector('.observatory-visor-contours')).animationName,
    value: document.querySelector('.observatory-visor-value').textContent
  }))()`, { reducedMotion: true });
  assert.equal(reduced.ticks, 'none', 'reduced motion stops outer tick rotation');
  assert.equal(reduced.contours, 'none', 'reduced motion stops contour rotation');
  assert.equal(reduced.value, '23%', 'reduced motion must not change the reading');
});

function overviewAnalyticsForVisor(closeRate, avgScore) {
  return {
    calls: { analyzed: 3, total_in_range: 3, processing: 0, error: 0 },
    avg_score: { mean: avgScore, prior_mean: null, graded_calls: 3, win_mean: null, win_n: 0, other_mean: null, other_n: 0 },
    objections: { calls_with_objection: 1, total_highlights: 1 },
    gauge_policy: {
      closing: { scale: 50, target: 25, direction: 'higher_is_better', band: null },
      objections: { scale: 100, target: 35, direction: 'higher_is_better', band: null }
    },
    prospect_close_rate: closeRate, prospect_close_wins: 0, prospect_close_total: 3,
    close_wins: 0, close_decided: 0, sections: {}, weakest_section: null, strongest_section: null, latest_one_things: []
  };
}

test('Visor uses the established semantic bands, and measured zero has no cap arc', () => {
  const needsWork = (rate) => ({ available: true, bucket: { handled: rate, total: 100, rate_pct: rate }, detail: { buckets: [{ handled: rate, total: 100, rate_pct: rate }] } });
  const classes = (html) => renderComputed(html, `(() => [...document.querySelectorAll('.observatory-overview-hero .observatory-visor-gauge')].map((node) => ({ className: node.className, style: node.getAttribute('style') || '' })))()`);
  const good = classes(documentFor('overview', { analytics2: overviewAnalyticsForVisor(25, 70), needsWork: needsWork(35) }));
  const mid = classes(documentFor('overview', { analytics2: overviewAnalyticsForVisor(15, 50), needsWork: needsWork(21) }));
  const bad = classes(documentFor('overview', { analytics2: overviewAnalyticsForVisor(10, 40), needsWork: needsWork(10) }));
  good.slice(0, 2).forEach((gauge) => assert.match(gauge.className, /observatory-visor--good/, 'Closing and OHR above their canonical bars use green'));
  mid.slice(0, 2).forEach((gauge) => assert.match(gauge.className, /observatory-visor--mid/, 'Closing and OHR at their established yellow lower edge use amber'));
  bad.slice(0, 2).forEach((gauge) => assert.match(gauge.className, /observatory-visor--bad/, 'Closing and OHR below their canonical bars use red'));
  assert.match(good[2].style, /--visor-tone:\s*#09d543/, 'Avg score keeps its established 70+ green scoreColor tone');
  assert.match(mid[2].style, /--visor-tone:\s*#fbbf24/, 'Avg score keeps its established 50-point amber edge');
  assert.match(bad[2].style, /--visor-tone:\s*#f87171/, 'Avg score keeps its established below-50 red scoreColor tone');

  const zeroHtml = documentFor('overview', { analytics2: overviewAnalyticsForVisor(0, 0), needsWork: needsWork(0) });
  const zero = renderComputed(zeroHtml, `(() => {
    const gauges = [...document.querySelectorAll('.observatory-overview-hero .observatory-visor-gauge')];
    return { arcs: document.querySelectorAll('.observatory-overview-hero .observatory-visor-arc').length,
      glows: document.querySelectorAll('.observatory-overview-hero .observatory-visor-arc-glow').length,
      values: gauges.map((node) => node.querySelector('.observatory-visor-value').textContent) };
  })()`);
  assert.equal(zero.arcs, 0, 'a measured zero does not paint a rounded progress cap');
  assert.equal(zero.glows, 0, 'a measured zero does not emit a glow arc');
  assert.deepEqual(zero.values, ['0%', '0%', '0'], 'measured zeros remain visible values, not missing data');
});
