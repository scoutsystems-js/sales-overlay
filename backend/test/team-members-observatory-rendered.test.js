'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComputed } = require('./helpers/electron-render');
const {
  documentFor,
  membersLoadingFirstPaint,
  membersManagerBase,
} = require('./helpers/observatory-fixture');

const DASHBOARD = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

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
      width: computed.width,
    };
  };
  const panel = element('.team-members-panel');
  const panelStyle = getComputedStyle(panel);
  const panelLight = getComputedStyle(panel, '::before');
  const table = element('.members-table');
  const tableScroll = table.parentElement;
  tableScroll.scrollLeft = tableScroll.scrollWidth;
  const finalAction = element('.members-actions .danger');
  const finalActionBox = finalAction.getBoundingClientRect();
  const scrollBox = tableScroll.getBoundingClientRect();
  return {
    documentWidth: document.documentElement.scrollWidth,
    body: style('body'),
    firstContour: style('body', '::before'),
    secondContour: style('body', '::after'),
    panel: {
      border: panelStyle.border,
      radius: panelStyle.borderRadius,
      lightBorder: panelLight.border,
      lightHeight: panelLight.height,
      lightWidth: panelLight.width,
    },
    rail: box('#sidebar'),
    main: box('.team-members-main'),
    tableScrolls: tableScroll.scrollWidth > tableScroll.clientWidth,
    finalActionVisible: finalActionBox.left >= scrollBox.left - 1 && finalActionBox.right <= scrollBox.right + 1,
    teamPicker: !!element('.observatory-company .user-select'),
    datePicker: !!element('#dp-team'),
    backgroundSwitch: style('#bgSwitch').display,
    currentPage: element('.workspace-team-link.is-current').textContent.trim(),
    currentPageAria: element('.workspace-team-link.is-current').getAttribute('aria-current'),
    currentPageShadow: style('.workspace-team-link.is-current').shadow,
    pageTitle: element('.observatory-title-row h2').textContent.trim(),
    company: element('.observatory-company h1').textContent.trim(),
    seats: element('.members-seats').textContent.replace(/\\s+/g, ' ').trim(),
    rows: document.querySelectorAll('.members-table tbody tr').length,
    inactiveRows: document.querySelectorAll('.members-table tbody tr.inactive').length,
    deletes: document.querySelectorAll('.members-act.danger').length,
    deactivates: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Deactivate').length,
    reactivates: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Reactivate').length,
    emails: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Email').length,
    resets: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Reset Link').length,
    managers: document.querySelectorAll('.members-move').length,
    calendarHref: element('.team-members-panel a[href^="/team-calendar.html"]').getAttribute('href'),
    panelText: panel.textContent,
  };
})()`;

test('My Team renders the approved shell and keeps every owner roster action usable', () => {
  for (const width of [1440, 1024, 900, 768, 390]) {
    const result = renderComputed(documentFor('team-members'), layoutProbe, { width });

    assert.ok(result.documentWidth <= width, width + 'px page overflows horizontally');
    assert.match(result.body.attachment, /fixed/);
    assert.equal(result.firstContour.position, 'fixed');
    assert.equal(result.firstContour.pointer, 'none');
    assert.equal(result.secondContour.position, 'fixed');
    assert.equal(result.secondContour.pointer, 'none');
    assert.equal(result.panel.radius, '14px');
    assert.match(result.panel.border, /^1px solid/);
    assert.equal(result.panel.lightWidth, '42px');
    assert.equal(result.panel.lightHeight, '1px');
    assert.match(result.panel.lightBorder, /^0px none/);
    assert.equal(result.teamPicker, true);
    assert.equal(result.datePicker, true);
    assert.equal(result.backgroundSwitch, 'none');
    assert.equal(result.currentPage, 'My Team');
    assert.equal(result.currentPageAria, 'page');
    assert.notEqual(result.currentPageShadow, 'none');
    assert.equal(result.pageTitle, 'My Team');
    assert.equal(result.company, 'Northstar Sales');
    assert.match(result.seats, /3 active/);
    assert.match(result.seats, /1 inactive/);
    assert.equal(result.rows, 4);
    assert.equal(result.inactiveRows, 1);
    assert.equal(result.deletes, 4);
    assert.equal(result.deactivates, 3);
    assert.equal(result.reactivates, 1);
    assert.equal(result.emails, 4);
    assert.equal(result.resets, 4);
    assert.equal(result.managers, 4);
    assert.equal(result.calendarHref, '/team-calendar.html');
    assert.doesNotMatch(result.panelText, /Fathom|Zoom|calls analyzed|appointment count/i);
    if (width > 900) assert.ok(result.main.left >= result.rail.right - 3, 'desktop roster must sit beside the rail');
    else assert.ok(result.main.top >= result.rail.bottom - 2, 'narrow roster must stack below the rail');
    if (width <= 768) {
      assert.equal(result.tableScrolls, true, width + 'px roster table should scroll inside its panel');
      assert.equal(result.finalActionVisible, true, width + 'px final action cannot be reached inside the table scroller');
    }
  }
});

test('My Team keeps manager permissions and selected-company loading honest', () => {
  const manager = renderComputed(documentFor('team-members', membersManagerBase()), `(() => ({
    rows: document.querySelectorAll('.members-table tbody tr').length,
    deletes: document.querySelectorAll('.members-act.danger').length,
    deactivates: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Deactivate').length,
    reactivates: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Reactivate').length,
    emails: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Email').length,
    resets: [...document.querySelectorAll('.members-act')].filter((button) => button.textContent.trim() === 'Reset Link').length,
    managers: document.querySelectorAll('.members-move').length,
    teamPicker: !!document.querySelector('.observatory-company .user-select')
  }))()`);
  assert.deepEqual(manager, { rows: 3, deletes: 0, deactivates: 2, reactivates: 1, emails: 3, resets: 3, managers: 3, teamPicker: false });

  const unresolved = renderComputed(documentFor('team-members', {
    teamSelected: 'team-other',
    teamOverview: null,
    teamOverviewLoading: true,
  }), `(() => ({
    company: document.querySelector('.observatory-company h1').textContent.trim(),
    waiting: !!document.querySelector('.team-members-panel .lane-wait'),
    rows: document.querySelectorAll('.members-table tbody tr').length,
    calendarHref: document.querySelector('.team-members-panel a[href^="/team-calendar.html"]').getAttribute('href')
  }))()`);
  assert.deepEqual(unresolved, { company: 'Second Team', waiting: true, rows: 0, calendarHref: '/team-calendar.html?team=team-other' });
});

test('My Team date picker fits tablet and phone viewports above the roster panel', () => {
  for (const width of [768, 390]) {
    const result = renderComputed(documentFor('team-members', {}, { datePickerOpen: true }), `(() => {
      const picker = document.querySelector('.dp-panel');
      const pickerBox = picker.getBoundingClientRect();
      const roster = document.querySelector('.team-members-panel');
      return {
        left: pickerBox.left,
        right: pickerBox.right,
        zIndex: Number(getComputedStyle(picker).zIndex),
        rosterZ: Number(getComputedStyle(roster).zIndex),
        documentWidth: document.documentElement.scrollWidth,
        expanded: document.getElementById('dp-btn-team').getAttribute('aria-expanded')
      };
    })()`, { width });
    assert.ok(result.left >= 0 && result.right <= width, width + 'px date picker leaves the viewport');
    assert.ok(result.zIndex > result.rosterZ, width + 'px date picker must stay above the roster');
    assert.ok(result.documentWidth <= width);
    assert.equal(result.expanded, 'true');
  }
});

test('My Team preserves empty, loading, background-off, and reduced-motion states', () => {
  const empty = renderComputed(documentFor('team-members', {
    users: [{ user_id: 'owner-1', first_name: 'Olivia', last_name: 'Owner', email: 'olivia@example.test', role: 'owner', active: true, managed_by: null }],
  }), `(() => ({
    empty: !!document.querySelector('.team-members-panel .empty'),
    background: getComputedStyle(document.querySelector('.team-members-panel .empty')).backgroundColor,
    border: getComputedStyle(document.querySelector('.team-members-panel .empty')).border
  }))()`);
  assert.equal(empty.empty, true);
  assert.equal(empty.background, 'rgba(0, 0, 0, 0)');
  assert.match(empty.border, /^0px none/);

  const loading = renderComputed(documentFor('team-members', { users: null }), `(() => ({
    waiting: !!document.querySelector('.team-members-panel .lane-wait'),
    panel: !!document.querySelector('.team-members-panel')
  }))()`);
  assert.deepEqual(loading, { waiting: true, panel: true });

  const offDocument = documentFor('team-members').replace('<html>', '<html data-bg="off">');
  const off = renderComputed(offDocument, `(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    before: getComputedStyle(document.body, '::before').display,
    after: getComputedStyle(document.body, '::after').display
  }))()`);
  assert.equal(off.background, 'rgb(9, 10, 11)');
  assert.equal(off.before, 'none');
  assert.equal(off.after, 'none');

  const reduced = renderComputed(documentFor('team-members'), `(() => ({
    before: getComputedStyle(document.body, '::before').animationName,
    after: getComputedStyle(document.body, '::after').animationName
  }))()`, { reducedMotion: true });
  assert.deepEqual(reduced, { before: 'none', after: 'none' });
});

test('My Team keeps its action renderer unchanged and stamps cold loading before markup', () => {
  const bodyStart = DASHBOARD.indexOf('function teamMembersBodyHtml()');
  const bodyEnd = DASHBOARD.indexOf('/**\n   * THE OFFER PRICE', bodyStart);
  assert.ok(bodyStart > -1 && bodyEnd > bodyStart);
  const body = DASHBOARD.slice(bodyStart, bodyEnd);
  for (const behavior of ['openAddMember()', 'deactivateMember', 'reactivateMember', 'editMemberEmail', 'sendMemberReset', 'deleteMember', 'moveMember']) {
    assert.match(body, new RegExp(behavior.replace(/[()]/g, '\\$&')), behavior + ' was removed from the roster');
  }
  assert.match(body, /isOwner \? '<button class="members-act danger"/, 'Delete must remain owner-gated');
  assert.match(body, /roleLabel\(m\.role \|\| 'user'\)/, 'stored roles must still use the ruled display labels');

  const renderStart = DASHBOARD.indexOf('function renderTeamMembersView()');
  const renderEnd = DASHBOARD.indexOf('function teamMembersScope()', renderStart);
  const renderer = DASHBOARD.slice(renderStart, renderEnd);
  assert.ok(renderer.indexOf("var membersHeader = observatoryTitleHtml('My Team', 'My Team')")
      < renderer.indexOf('var membersControls = teamControlsHtml()'),
    'the company header must register before the shared controls');

  const firstPaint = membersLoadingFirstPaint();
  assert.equal(firstPaint.startedWithoutView, true);
  assert.equal(firstPaint.view, 'team-members');
  assert.match(firstPaint.markup, /team-members-observatory/);
  assert.match(firstPaint.markup, /lane-wait/);
});
