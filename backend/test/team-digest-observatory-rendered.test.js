'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComputed } = require('./helpers/electron-render');
const { documentFor, digestLoadingFirstPaint } = require('./helpers/observatory-fixture');

const layoutProbe = `(() => {
  const element = (selector) => document.querySelector(selector);
  const box = (selector) => {
    const rect = element(selector).getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
  };
  const style = (selector, pseudo) => {
    const computed = getComputedStyle(element(selector), pseudo);
    return {
      border: computed.border,
      radius: computed.borderRadius,
      top: computed.top,
      position: computed.position,
      pointer: computed.pointerEvents,
      display: computed.display,
      shadow: computed.boxShadow,
    };
  };
  const currentTeamPage = element('.workspace-team-link.is-current');
  return {
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    header: style('.page-header'),
    panel: style('.team-digest-panel'),
    panelLight: style('.team-digest-panel', '::before'),
    firstContour: style('body', '::before'),
    secondContour: style('body', '::after'),
    picker: style('.page-header-side .user-select'),
    pickerBox: box('.page-header-side .user-select'),
    companyBox: box('.page-header-main h1'),
    companyName: element('.page-header-main h1').textContent.trim(),
    currentPage: currentTeamPage && currentTeamPage.textContent.trim(),
    currentPageAria: currentTeamPage && currentTeamPage.getAttribute('aria-current'),
    currentPageStyle: style('.workspace-team-link.is-current'),
    activeTeamNav: element('#navTeam').classList.contains('nav-active'),
    links: [...document.querySelectorAll('.digest-notable a')].map((link) => link.href),
    dayButtons: [...document.querySelectorAll('.digest-day-btn')].map((button) => button.disabled),
  };
})()`;

test('Daily Digest renders its real glass shell, team controls, and active navigation without overflow', () => {
  for (const width of [1440, 1024, 900, 768, 390]) {
    const result = renderComputed(documentFor('team'), layoutProbe, { width });

    assert.ok(result.documentWidth <= width, width + 'px layout overflows horizontally');
    assert.equal(result.header.radius, '14px');
    assert.equal(result.panel.radius, '14px');
    assert.match(result.panel.border, /^1px solid/);
    assert.equal(result.panelLight.top, '14px');
    assert.equal(result.firstContour.position, 'fixed');
    assert.equal(result.firstContour.pointer, 'none');
    assert.equal(result.secondContour.position, 'fixed');
    assert.equal(result.secondContour.pointer, 'none');
    assert.notEqual(result.picker.display, 'none');
    assert.equal(result.companyName, 'Northstar Sales');
    assert.equal(result.currentPage, 'Daily Digest');
    assert.equal(result.currentPageAria, 'page');
    assert.notEqual(result.currentPageStyle.shadow, 'none');
    assert.equal(result.activeTeamNav, true);
    assert.equal(result.links.length, 3);
    assert.equal(result.dayButtons.length, 2);

    const boxesOverlap = result.companyBox.right > result.pickerBox.left
      && result.pickerBox.right > result.companyBox.left
      && result.companyBox.bottom > result.pickerBox.top
      && result.pickerBox.bottom > result.companyBox.top;
    assert.equal(boxesOverlap, false, width + 'px company name overlaps its team picker');
  }
});

test('Daily Digest preserves empty, no-material, and loading states inside the real panel', () => {
  const states = [
    {
      overrides: { teamDigest: { available: false, date: '2026-09-13', recent_dates: [], reason: 'Later' } },
      selector: '.empty',
    },
    {
      overrides: { teamDigest: { available: true, date: '2026-09-12', recent_dates: ['2026-09-12'], stats: { closed: 1, calls: 21, follow_up: 17, lost: 0 }, no_material: true, copy: 'Nothing on file to judge the team against yet.' } },
      selector: '.no-material',
    },
    {
      overrides: { teamDigest: null, teamDigestLoading: true },
      selector: '.lane-wait',
    },
  ];

  for (const fixture of states) {
    const probe = `(() => ({
      panel: !!document.querySelector('.team-digest-panel'),
      state: !!document.querySelector('${fixture.selector}'),
      emptyBackground: document.querySelector('.empty') ? getComputedStyle(document.querySelector('.empty')).backgroundColor : null,
      emptyBorder: document.querySelector('.empty') ? getComputedStyle(document.querySelector('.empty')).border : null
    }))()`;
    const result = renderComputed(documentFor('team', fixture.overrides), probe);
    assert.equal(result.panel, true);
    assert.equal(result.state, true, fixture.selector + ' did not render');
    if (fixture.selector === '.empty') {
      assert.equal(result.emptyBackground, 'rgba(0, 0, 0, 0)', 'empty Digest content stays transparent inside the glass panel');
      assert.equal(result.emptyBorder, '0px none rgb(237, 237, 237)', 'empty Digest content adds no second panel border');
    }
  }
});

test('Daily Digest cold loading paint stamps the team view before inserting markup', () => {
  const firstPaint = digestLoadingFirstPaint();
  assert.equal(firstPaint.startedWithoutView, true);
  assert.equal(firstPaint.view, 'team');
  assert.match(firstPaint.markup, /team-digest-observatory/);
  assert.match(firstPaint.markup, /lane-wait/);
});
