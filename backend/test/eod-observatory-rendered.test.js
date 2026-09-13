'use strict';

/* EOD remains an editable daily record. Render the real producer under its
 * own view hook so this visual pass cannot accidentally turn its fields,
 * picker, copy action, or call ordering into mock presentation. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComputed } = require('./helpers/electron-render');
const { documentFor, eodLoadingFirstPaint } = require('./helpers/observatory-fixture');

const PROBE = `(() => {
  const node = (selector) => document.querySelector(selector);
  const box = (selector) => {
    const item = node(selector);
    const rect = item && item.getBoundingClientRect();
    return rect && { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
  };
  const style = (selector, pseudo) => {
    const item = node(selector);
    const css = item && getComputedStyle(item, pseudo);
    return css && { border: css.border, radius: css.borderRadius, background: css.backgroundColor, shadow: css.boxShadow, minHeight: css.minHeight, position: css.position, pointer: css.pointerEvents, top: css.top };
  };
  const idleEditedInput = style('.eod-input.edited');
  return {
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyBefore: style('body', '::before'),
    bodyAfter: style('body', '::after'),
    header: style('.eod-header-panel'),
    headerLight: style('.eod-header-panel', '::before'),
    call: style('.eod-first-call'),
    callLight: style('.eod-first-call', '::before'),
    input: style('.eod-input'),
    idleEditedInput,
    summary: style('.eod-textarea'),
    first: box('.eod-first-call'),
    list: box('.eod-call-list'),
    headerBox: box('.eod-header-panel'),
    rail: box('#sidebar'),
    page: box('#page'),
    upper: box('.eod-upper'),
    callCount: document.querySelectorAll('.eod-call').length,
    remainingCount: document.querySelectorAll('.eod-call-list .eod-call').length,
    callOrder: [...document.querySelectorAll('.eod-call')].map((call) => call.querySelector('.eod-row:nth-child(2) input').value),
    handlers: [...document.querySelectorAll('.eod-call input, .eod-call textarea')].map((item) => item.getAttribute('onchange')),
    toolbar: [...document.querySelectorAll('.eod-toolbar button')].map((item) => item.getAttribute('onclick')),
    outcomeInput: [...document.querySelectorAll('.eod-row')].some((row) => row.textContent.includes('Outcome') && row.querySelector('input,textarea')),
    overflow: [...document.querySelectorAll('.eod-observatory, .eod-call, .eod-row, .eod-input, .eod-textarea, .eod-toolbar')]
      .filter((item) => item.scrollWidth > item.clientWidth + 1).map((item) => item.className)
  };
})()`;

test('EOD cold loading stamps the view and keeps the real report toolbar', () => {
  const first = eodLoadingFirstPaint();
  assert.equal(first.startedWithoutView, true, 'the fixture starts without a body view hook');
  assert.equal(first.view, 'eod', 'direct EOD first paint stamps its own visual scope');
  assert.match(first.markup, /eod-observatory/, 'loading uses the EOD layout host');
  assert.match(first.markup, /Building today&#39;s report/, 'loading keeps its established copy');
  assert.match(first.markup, /onclick="eodShiftDay\(-1\)"/, 'loading keeps the existing day controls');
});

test('EOD glass layout keeps fields editable and clears a real tall rail', () => {
  const observed = renderComputed(documentFor('eod'), PROBE, { width: 1453 });
  assert.equal(observed.documentWidth, 1453, 'desktop EOD has no horizontal overflow');
  for (const layer of [observed.bodyBefore, observed.bodyAfter]) {
    assert.equal(layer.position, 'fixed', 'the approved contour stays fixed behind report controls');
    assert.equal(layer.pointer, 'none', 'the contour cannot intercept editable fields');
  }
  for (const [name, panel] of [['header', observed.header], ['first call', observed.call]]) {
    assert.equal(panel.radius, '14px', name + ' uses the approved panel radius');
    assert.match(panel.border, /^1px solid rgba\(118, 255, 171, 0\.36\)/, name + ' has a real mint edge');
    assert.notEqual(panel.shadow, 'none', name + ' retains the restrained glass bloom');
  }
  assert.equal(observed.headerLight.top, '14px', 'the header top light sits inside its panel');
  assert.equal(observed.callLight.top, '14px', 'the report top light sits inside its panel');
  assert.equal(observed.input.background, 'rgba(2, 16, 8, 0.58)', 'text inputs retain the scoped translucent field surface');
  assert.equal(observed.idleEditedInput.border, '1px solid rgb(9, 213, 67)', 'an edited input keeps its green edge at rest');
  assert.equal(observed.summary.minHeight, '100px', 'summary fields stay readable rather than clipping at one line');
  assert.equal(observed.callCount, 2, 'the fixture retains both real report calls');
  assert.equal(observed.remainingCount, 1, 'only later calls move to the full-width continuation');
  assert.deepEqual(observed.callOrder, ['Morgan Blake', 'Avery Cole'], 'presentation preserves the server call order');
  assert.ok(observed.handlers.every((handler) => /^eodSaveField\(/.test(handler || '')), 'each editable field keeps the existing save handler');
  assert.equal(observed.outcomeInput, false, 'canonical outcome remains read-only');
  assert.deepEqual(observed.toolbar, ['eodShiftDay(-1)', "datePickerToggle('eod')", 'eodShiftDay(1)', 'eodToday()', 'eodCopyForSlack()'], 'the existing picker and report actions remain intact');
  assert.ok(observed.first.left >= observed.rail.right - 1, 'the first real report starts beside the tall owner rail');
  assert.ok(observed.first.top >= observed.headerBox.bottom + 14 && observed.first.top - observed.headerBox.bottom < 90, 'the first report follows the compact header without rail-sized dead space');
  assert.ok(observed.list.top >= observed.rail.bottom + 14, 'later reports clear the actual tall rail before expanding');
  assert.ok(Math.abs(observed.list.left - observed.page.left) <= 2 && Math.abs(observed.list.right - observed.page.right) <= 2, 'later reports reclaim the full approved page width');
  assert.deepEqual(observed.overflow, [], 'all report controls fit their own layout host');
});

test('EOD empty, loading, and phone layouts keep their established states usable', () => {
  const empty = renderComputed(documentFor('eod', { eodData: { date: '2026-09-13', sync: { connected: true, complete: true }, calls: [] } }), `(() => ({ empty: !!document.querySelector('.empty'), calls: document.querySelectorAll('.eod-call').length, list: !!document.querySelector('.eod-call-list'), border: getComputedStyle(document.querySelector('.empty')).border }))()`, { width: 1453 });
  assert.equal(empty.empty, true, 'no-call EOD keeps its established empty state');
  assert.equal(empty.calls, 0, 'the empty state does not invent a report row');
  assert.equal(empty.list, false, 'the full-width continuation only exists for real later calls');
  assert.match(empty.border, /^1px solid rgba\(118, 255, 171, 0\.36\)/, 'the empty state uses the reviewed glass shell');

  const loading = renderComputed(documentFor('eod', { eodData: null, eodLoading: true }), `(() => ({ wait: !!document.querySelector('.lane-wait'), upper: !!document.querySelector('.eod-upper'), list: !!document.querySelector('.eod-call-list') }))()`, { width: 1453 });
  assert.deepEqual(loading, { wait: true, upper: true, list: false }, 'loading stays beside the rail without a fabricated list panel');

  const phone = renderComputed(documentFor('eod'), PROBE, { width: 390 });
  assert.ok(phone.documentWidth <= 390, 'phone EOD has no horizontal overflow');
  assert.deepEqual(phone.overflow, [], 'phone report fields and toolbar wrap inside the viewport');
  assert.ok(phone.first.width <= 354.1 && phone.list.width <= 354.1, 'phone report panels respect the 18px page gutters');
});
