'use strict';

/* Calls is still a working list, so this guard renders the real Calls producer
 * under its actual view hook. It pins the visual shell around the rows without
 * turning the rows themselves into cards or weakening their existing click test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComputed } = require('./helpers/electron-render');
const { documentFor, callsLoadingFirstPaint } = require('./helpers/observatory-fixture');

const PROBE = `(() => {
  const box = (selector) => {
    const node = document.querySelector(selector);
    const rect = node && node.getBoundingClientRect();
    return rect && { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
  };
  const style = (selector, pseudo) => {
    const node = document.querySelector(selector);
    const css = node && getComputedStyle(node, pseudo);
    return css && { background: css.backgroundImage, backgroundColor: css.backgroundColor, border: css.border, radius: css.borderRadius, shadow: css.boxShadow, position: css.position, pointer: css.pointerEvents, display: css.display, top: css.top };
  };
  return {
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyBefore: style('body', '::before'),
    bodyAfter: style('body', '::after'),
    header: style('.page-header'),
    queue: style('.vq'),
    list: style('.library-list'),
    headerLight: style('.page-header', '::before'),
    queueLight: style('.vq', '::before'),
    listLight: style('.library-list', '::before'),
    row: style('.library-card'),
    rowOverflow: [...document.querySelectorAll('.library-card, .library-card-side, .vq-row, .vq-main, .vq-actions')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.className),
    page: box('#page'), rail: box('#sidebar'), upper: box('.call-library-upper'), listBox: box('.library-list')
  };
})()`;

test('Calls cold loading paint stamps its view and retains the real skeleton host', () => {
  const first = callsLoadingFirstPaint();
  assert.equal(first.startedWithoutView, true, 'the cold fixture begins without a body view hook');
  assert.equal(first.view, 'call-library', 'renderCallLibrary stamps its view before adding the loading shell');
  assert.match(first.markup, /call-library-upper/, 'loading keeps the measured upper layout host');
  assert.match(first.markup, /library-list--loading/, 'loading keeps the established list skeletons');
});

test('Calls uses a fixed contour ground and compact glass shells while preserving a single list', () => {
  for (const width of [1453, 900, 390]) {
    const observed = renderComputed(documentFor('call-library'), PROBE, { width });
    assert.ok(observed.documentWidth <= width, width + 'px Calls must not overflow horizontally');
    assert.deepEqual(observed.rowOverflow, [], width + 'px Calls rows and queue controls must wrap within their own width');
    for (const layer of [observed.bodyBefore, observed.bodyAfter]) {
      assert.equal(layer.position, 'fixed', width + 'px contour is fixed behind scrolling content');
      assert.equal(layer.pointer, 'none', width + 'px contour cannot intercept row controls');
    }
    for (const [name, panel] of [['header', observed.header], ['queue', observed.queue], ['list', observed.list]]) {
      assert.equal(panel.radius, '14px', width + 'px ' + name + ' uses the approved glass radius');
      assert.match(panel.border, /^1px solid /, width + 'px ' + name + ' has a real panel edge, not only an edge color');
      assert.match(panel.border, /rgba\(118, 255, 171, 0\.36\)/, width + 'px ' + name + ' keeps the mint edge');
      assert.notEqual(panel.shadow, 'none', width + 'px ' + name + ' keeps the restrained bloom');
    }
    for (const [name, light] of [['header', observed.headerLight], ['queue', observed.queueLight], ['list', observed.listLight]]) {
      assert.equal(light.top, '14px', width + 'px ' + name + ' top light sits inside the panel, clear of its border');
    }
    assert.equal(observed.row.radius, '0px', width + 'px individual call rows remain list rows, never cards');
    assert.equal(observed.row.background, 'none', width + 'px individual call rows stay transparent at rest');
    if (width > 900) {
      assert.ok(observed.upper.left >= observed.rail.right - 1, width + 'px upper controls overlap the rail');
      assert.ok(observed.listBox.top >= observed.rail.bottom + 8, width + 'px list must reclaim full width only below the rail');
      assert.ok(Math.abs(observed.listBox.left - observed.page.left) <= 2, width + 'px list must reclaim the left page edge');
      assert.ok(Math.abs(observed.listBox.right - observed.page.right) <= 2, width + 'px list must span the page width');
    }
  }
});

test('Calls background-off removes both fixed contours', () => {
  const probe = `(() => { document.documentElement.setAttribute('data-bg', 'off'); return [getComputedStyle(document.body, '::before').display, getComputedStyle(document.body, '::after').display]; })()`;
  assert.deepEqual(renderComputed(documentFor('call-library'), probe, { width: 1453 }), ['none', 'none']);
});

test('Calls keeps the active outcome filter visibly selected after its scoped field treatment', () => {
  const observed = renderComputed(documentFor('call-library', { callLibraryFilter: 'closed' }), `(() => {
    const css = (selector) => { const s = getComputedStyle(document.querySelector(selector)); return { border:s.border, backgroundColor:s.backgroundColor, shadow:s.boxShadow }; };
    return { active:css('.calls-outcome-btn.active'), inactive:css('.calls-outcome-btn:not(.active)') };
  })()`, { width: 1453 });
  assert.equal(observed.active.border, '1px solid rgb(9, 213, 67)', 'the active Closed filter keeps the Scout-green edge');
  assert.notEqual(observed.active.backgroundColor, observed.inactive.backgroundColor, 'the selected filter adds a distinct restrained green fill');
  assert.notEqual(observed.active.shadow, observed.inactive.shadow, 'the selected filter keeps its subtle inner emphasis');
});
