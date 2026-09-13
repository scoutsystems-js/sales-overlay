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
  }
  const desktop = renderComputed(html, probePage(), { width: 1920 });
  assert.ok(desktop.page.left <= 32 && 1920 - desktop.page.right <= 32, 'overview desktop gutters must be at most 32px');
  assert.ok(desktop.page.left < desktop.rail.right, 'overview page must retain the established under-rail alignment');
  assert.ok(desktop.focus && desktop.focus.left === desktop.page.left, 'overview focus grid must align to the page edge');
  assert.ok(desktop.focus.top >= desktop.rail.bottom, 'overview focus grid must clear the expanded rail');
  assert.equal(desktop.hudPosition, 'fixed', 'overview HUD must be viewport-fixed');
  assert.ok(desktop.backgroundAttachment.split(',').every((layer) => layer.trim() === 'fixed'), 'overview ground layers must stay fixed');
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
      assert.equal((html.match(/class="observatory-ring-value"/g) || []).length, 0, 'no-call overview must not draw a filled closing arc');
      assert.equal((html.match(/class="observatory-ring-glow"/g) || []).length, 0, 'no-call overview must not draw a closing glow arc');
      assert.match(html, /class="observatory-ring overview-close-ring observatory-ring--empty"/, 'no-call overview keeps the neutral closing instrument');
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
