'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComputed } = require('./helpers/electron-render');
const { documentFor, objectionsLoadingFirstPaint } = require('./helpers/observatory-fixture');

const layoutProbe = `(() => {
  const element = (selector) => document.querySelector(selector);
  const box = (selector) => {
    const rect = element(selector).getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
  };
  const style = (selector, pseudo) => {
    const computed = getComputedStyle(element(selector), pseudo);
    return {
      animation: computed.animationName,
      attachment: computed.backgroundAttachment,
      background: computed.backgroundColor,
      border: computed.border,
      display: computed.display,
      height: computed.height,
      pointer: computed.pointerEvents,
      position: computed.position,
      radius: computed.borderRadius,
      shadow: computed.boxShadow,
      top: computed.top,
      width: computed.width,
      zIndex: computed.zIndex,
    };
  };
  return {
    documentWidth: document.documentElement.scrollWidth,
    body: style('body'),
    firstContour: style('body', '::before'),
    secondContour: style('body', '::after'),
    panels: [...document.querySelectorAll('.observatory-objections-panel')].map((panel) => {
      const computed = getComputedStyle(panel);
      const light = getComputedStyle(panel, '::before');
      return {
        border: computed.border,
        radius: computed.borderRadius,
        lightBorder: light.border,
        lightHeight: light.height,
        lightTop: light.top,
        lightWidth: light.width,
      };
    }),
    rail: box('#sidebar'),
    upper: box('.observatory-upper'),
    why: box('.observatory-objections-why-panel'),
    moments: box('.observatory-objections-moments-panel'),
    gridWidth: [element('.obj-grid').scrollWidth, element('.obj-grid').clientWidth],
    teamPicker: !!element('.observatory-company .user-select'),
    datePicker: !!element('#dp-team'),
    repFilter: !!element('#repFilterBtn'),
    leadText: element('.lead-number').textContent.trim(),
    closerRows: document.querySelectorAll('.obj-grid-row:not(.obj-grid-avg)').length,
    whyRows: document.querySelectorAll('.objsum-card').length,
    momentRows: document.querySelectorAll('.observatory-objections-moments-panel .pattern-card').length,
    currentPage: element('.workspace-team-link.is-current').textContent.trim(),
    currentPageAria: element('.workspace-team-link.is-current').getAttribute('aria-current'),
    currentPageShadow: style('.workspace-team-link.is-current').shadow,
    innerWhy: style('.objsum-card'),
    innerEvidence: style('.objsum-ev'),
  };
})()`;

test('Team Objections renders the approved shell and preserved controls without page overflow', () => {
  for (const width of [1440, 1024, 900, 768, 390]) {
    const result = renderComputed(documentFor('team-objections'), layoutProbe, { width });

    assert.ok(result.documentWidth <= width, width + 'px page overflows horizontally');
    assert.match(result.body.attachment, /fixed/);
    assert.equal(result.firstContour.position, 'fixed');
    assert.equal(result.firstContour.pointer, 'none');
    assert.equal(result.secondContour.position, 'fixed');
    assert.equal(result.secondContour.pointer, 'none');
    assert.equal(result.panels.length, 3);
    for (const panel of result.panels) {
      assert.equal(panel.radius, '14px');
      assert.match(panel.border, /^1px solid/);
      assert.equal(panel.lightTop, '14px');
      assert.equal(panel.lightWidth, '42px');
      assert.equal(panel.lightHeight, '1px');
      assert.match(panel.lightBorder, /^0px none/);
    }
    assert.equal(result.teamPicker, true);
    assert.equal(result.datePicker, true);
    assert.equal(result.repFilter, true);
    assert.match(result.leadText, /18%/);
    assert.equal(result.closerRows, 9);
    assert.equal(result.whyRows, 12);
    assert.equal(result.momentRows, 12);
    assert.equal(result.currentPage, 'Objections');
    assert.equal(result.currentPageAria, 'page');
    assert.notEqual(result.currentPageShadow, 'none');
    assert.equal(result.innerWhy.radius, '0px');
    assert.equal(result.innerWhy.background, 'rgba(0, 0, 0, 0)');
    assert.match(result.innerEvidence.border, /^0px none/);
    assert.ok(result.why.top >= result.upper.bottom);
    assert.ok(result.moments.top >= result.why.bottom);
    if (width > 900) assert.ok(result.why.top >= result.rail.bottom);
    if (width === 390) assert.ok(result.gridWidth[0] > result.gridWidth[1], 'the wide grid should scroll inside its panel');
  }
});

test('Team Objections date and rep popovers stay inside narrow viewports and above their panel', () => {
  for (const width of [768, 390]) {
    const date = renderComputed(documentFor('team-objections', {}, { datePickerOpen: true }), `(() => {
      const panel = document.querySelector('.dp-panel');
      const rect = panel.getBoundingClientRect();
      return { left: rect.left, right: rect.right, zIndex: getComputedStyle(panel).zIndex, documentWidth: document.documentElement.scrollWidth };
    })()`, { width });
    assert.ok(date.left >= 0 && date.right <= width, width + 'px date picker leaves the viewport');
    assert.equal(date.zIndex, '80');
    assert.ok(date.documentWidth <= width);

    const reps = renderComputed(documentFor('team-objections', { repFilterOpen: true }), `(() => {
      const panel = document.querySelector('.rep-filter-menu');
      const rect = panel.getBoundingClientRect();
      return { left: rect.left, right: rect.right, zIndex: getComputedStyle(panel).zIndex, documentWidth: document.documentElement.scrollWidth };
    })()`, { width });
    assert.ok(reps.left >= 0 && reps.right <= width, width + 'px rep filter leaves the viewport');
    assert.ok(Number(reps.zIndex) >= 60);
    assert.ok(reps.documentWidth <= width);
  }
});

test('Team Objections preserves populated, empty, loading, and error states in all three panels', () => {
  const states = [
    { overrides: {}, selector: '.objsum-card' },
    {
      overrides: {
        teamObjections: { category: '', instances: [], instance_count: 0, truncated: false, grid: [], strict: true, excluded: { disqualifications: 0, logistical: 0 }, board_size: 12, closers: [], totals: { total: 0, handled: 0, credited: 0, partial: 0, unhandled: 0, rate: null } },
        teamObjSummary: { available: true, state: 'no_volume', card_text: 'No objection moments were found in this range.' },
      },
      selector: '.empty',
    },
    { overrides: { teamObjections: null, teamObjectionsLoading: true, teamObjSummary: null, teamObjSummaryLoading: false }, selector: '.lane-wait' },
    { overrides: { teamObjections: { _error: true }, teamObjectionsLoading: false, teamObjSummary: { _error: true }, teamObjSummaryLoading: false }, selector: '.error' },
  ];

  for (const fixture of states) {
    const result = renderComputed(documentFor('team-objections', fixture.overrides), `(() => ({
      panels: document.querySelectorAll('.observatory-objections-panel').length,
      state: !!document.querySelector('${fixture.selector}'),
      emptyBackgrounds: [...document.querySelectorAll('.observatory-objections-panel .empty')].map((node) => getComputedStyle(node).backgroundColor)
    }))()`);
    assert.equal(result.panels, 3);
    assert.equal(result.state, true, fixture.selector + ' did not render');
    result.emptyBackgrounds.forEach((background) => assert.equal(background, 'rgba(0, 0, 0, 0)'));
  }
});

test('Team Objections background-off removes both contours and reduced motion stays still', () => {
  const offDocument = documentFor('team-objections').replace('<html>', '<html data-bg="off">');
  const off = renderComputed(offDocument, `(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    before: getComputedStyle(document.body, '::before').display,
    after: getComputedStyle(document.body, '::after').display
  }))()`);
  assert.equal(off.background, 'rgb(9, 10, 11)');
  assert.equal(off.before, 'none');
  assert.equal(off.after, 'none');

  const reduced = renderComputed(documentFor('team-objections'), `(() => ({
    before: getComputedStyle(document.body, '::before').animationName,
    after: getComputedStyle(document.body, '::after').animationName
  }))()`, { reducedMotion: true });
  assert.equal(reduced.before, 'none');
  assert.equal(reduced.after, 'none');
});

test('Team Objections cold loading paint stamps its view before inserting markup', () => {
  const firstPaint = objectionsLoadingFirstPaint();
  assert.equal(firstPaint.startedWithoutView, true);
  assert.equal(firstPaint.view, 'team-objections');
  assert.match(firstPaint.markup, /observatory-objections/);
  assert.match(firstPaint.markup, /lane-wait/);
});
