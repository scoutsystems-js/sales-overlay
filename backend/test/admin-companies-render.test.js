/**
 * THE ADMIN COMPANY BLOCKS — the properties a screenshot proved and a DOM
 * check did not.
 *
 * ⚠⚠ THE CLIP IS THE REASON THIS FILE EXISTS. `.users-table-wrap` carried
 * `max-height: 320px; overflow: auto`, which hid rows behind an INNER
 * scrollbar: the 8-row All Users list was already truncated before company
 * blocks existed, and a 5-member block lost its last two members.
 *
 * Every check said it was fine. The rows were in the DOM, and
 * `getBoundingClientRect` reported them visible — because they DO have size.
 * They simply sat inside a clipped container. It was caught by LOOKING at the
 * page, which is the standing lesson: a measurement answers the question you
 * thought to ask; a capture answers the one you did not.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');
// ⚠ Comments stripped before any ABSENCE check — the comment explaining the
// removal quotes the removed rule, and matching it would report a shipped fix
// as un-shipped.
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

function rule(selector) {
  const i = LIVE.indexOf(selector + ' {');
  assert.ok(i !== -1, 'stale selector anchor: ' + selector);
  const j = LIVE.indexOf('}', i);
  assert.ok(j !== -1, 'unterminated rule for ' + selector);
  return LIVE.slice(i, j);
}

test('⚠⚠ NOTHING CLIPS THE USER LIST VERTICALLY — it hid real people', () => {
  const r = rule('.users-table-wrap');
  assert.ok(!/max-height/.test(r),
    'a max-height on the user list hides rows behind an inner scrollbar. It '
    + 'already truncated All Users at ~6 of 8 and dropped 2 of 5 members from a '
    + 'company block. Vertical scrolling is the page\'s job.');
  assert.ok(!/overflow\s*:\s*auto/.test(r),
    'plain `overflow: auto` clips vertically too — scope it to overflow-x');
  assert.ok(/overflow-x/.test(r), 'horizontal scrolling is still wanted for wide tables');
});

test('⚠ NON-VACUITY: the check catches the rule that actually shipped', () => {
  const broken = '.users-table-wrap { background: var(--bg2); overflow: auto; max-height: 320px; }';
  assert.ok(/max-height/.test(broken) && /overflow\s*:\s*auto/.test(broken),
    'if this fails the assertions above prove nothing');
});

/* ── the three tabs ───────────────────────────────────────────────────────── */

test('THREE TABS: Companies, Single Users, All Users', () => {
  const i = LIVE.indexOf('var ADMIN_TABS = [');
  assert.ok(i !== -1, 'ADMIN_TABS must exist');
  const block = LIVE.slice(i, LIVE.indexOf('];', i));
  ['companies', 'singles', 'all'].forEach((k) => {
    assert.ok(block.indexOf("'" + k + "'") !== -1, 'missing tab: ' + k);
  });
  ['Companies', 'Single Users', 'All Users'].forEach((l) => {
    assert.ok(block.indexOf(l) !== -1, 'missing tab label: ' + l);
  });
});

test('⚠ TAB STATE SURVIVES A REFRESH, and is restored BEFORE the first render', () => {
  assert.ok(/readAdminTabFromHash/.test(LIVE), 'the tab must be readable from the URL');
  assert.ok(/replaceState/.test(LIVE), 'and written to it without adding history entries');

  // ⚠ Restoring AFTER loadUsers would render Companies first and then jump —
  // and on a slow load the user would watch the wrong tab paint.
  const initAt = LIVE.indexOf('async function init() {');
  const init = LIVE.slice(initAt, LIVE.indexOf('\n  }', initAt));
  const restore = init.indexOf('adminTab = readAdminTabFromHash()');
  const load = init.indexOf('await loadUsers()');
  assert.ok(restore !== -1 && load !== -1, 'both steps must be in init()');
  assert.ok(restore < load, 'the tab must be restored before the first load/render');
});

/* ── the company block ────────────────────────────────────────────────────── */

test('⚠ THE NAME IS EDITABLE AT THE TOP CENTRE OF ITS BLOCK', () => {
  assert.ok(/class="company-head"/.test(LIVE) || /company-head/.test(LIVE));
  const head = rule('.company-head');
  assert.ok(/text-align:\s*center/.test(head), 'the company name sits top CENTRE');
  assert.ok(/company-name-input/.test(LIVE), 'and is an input, not static text, for an owner');
});

test('⚠⚠ THE RENAME REPORTS SUCCESS OR FAILURE AND REVERTS ON FAILURE', () => {
  /* Three silent-save defects shipped this session — two renders that only
     fired on one view, and a cached list re-rendering stale content over a
     successful write. A save that says nothing is the fourth. */
  const i = LIVE.indexOf('async function saveCompanyName(');
  assert.ok(i !== -1, 'saveCompanyName must exist');
  const fn = LIVE.slice(i, LIVE.indexOf('\n  }', i));
  assert.ok(/'✓'/.test(fn), 'success must be shown');
  assert.ok(/'✗ '/.test(fn), 'failure must be shown');
  assert.ok(/input\.value = original/.test(fn),
    'a failed save must REVERT the field — leaving the typed value on screen '
    + 'tells the user it saved when it did not');
  assert.ok(/status\.textContent = '…'/.test(fn), 'and an in-flight state');
});

test('⚠ THE PAGE DOES NOT REIMPLEMENT "WHAT IS A COMPANY"', () => {
  /* The grouping is done server-side by lib/company.js precisely so this page
     cannot grow a second, drifting copy of the rule. */
  assert.ok(/companiesArray = \(data && data\.companies\)/.test(LIVE),
    'the page must consume the server grouping');
  /* ⚠ THE FIRST VERSION OF THIS ASSERTION WAS WRONG, and in the exact way this
     codebase keeps getting caught: it forbade `managed_by === x.user_id`
     anywhere in the file, and matched `managedByControlHtml` — which compares
     those two to mark a dropdown option SELECTED. That is a legitimate use and
     nothing to do with grouping. The check's scope was wider than its claim.
     What must be forbidden is the page BUILDING the buckets itself. */
  assert.ok(/companiesArray\s*=\s*\(data && data\.companies\)/.test(LIVE),
    'companiesArray must come from the server payload and nowhere else');
  assert.ok(!/function\s+bucketUsers/.test(LIVE),
    'the page must not carry its own copy of the grouping rule');
  const assigns = (LIVE.match(/companiesArray\s*=\s*/g) || []).length;
  assert.strictEqual(assigns, 2,
    'companiesArray should be declared once and assigned once (from the server); '
    + 'a third assignment means the page is computing groups somewhere. Found ' + assigns);
});

/* ── password reset diagnostics: REMOVED 2026-08-24 ───────────────────────── */

test('⚠⚠ THE RESET-DIAGNOSTICS SURFACE IS GONE — UI **AND** ENDPOINT', () => {
  /* Justin: "that was in there a while ago for some testing I did and needs to
     be removed completely." Removing only the UI would leave a live owner-only
     endpoint mounted with nothing watching it. */
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  ['runResetDiagnose', 'resetDiagSection', 'rdEmail', 'rdBtn', 'rdResult', 'Password reset diagnostics']
    .forEach((m) => assert.strictEqual(LIVE.indexOf(m), -1, 'admin.html still contains ' + m));
  assert.strictEqual(routes.indexOf('reset-diagnose'), -1, 'the endpoint is still mounted');

  // ⚠ CUT-TOO-DEEP CHECK: the surrounding page must survive the removal.
  ['renderUsersTable', 'usersTableWrap', 'loadUsers'].forEach((m) =>
    assert.ok(LIVE.indexOf(m) !== -1, 'the removal took ' + m + ' with it'));
});

test('⚠ ADD COMPANY EXISTS, AND ITS HEAD COMES FROM SINGLE USERS', () => {
  assert.ok(/submitAddCompany/.test(LIVE), 'the create flow must exist');
  const i = LIVE.indexOf('function addCompanyBarHtml(');
  assert.ok(i !== -1);
  const fn = LIVE.slice(i, LIVE.indexOf('\n  }', i));
  assert.ok(/singlesArray/.test(fn),
    'the head must be picked from SINGLE USERS — offering someone already in a '
    + 'company would silently remove them from it');

  const j = LIVE.indexOf('async function submitAddCompany(');
  const save = LIVE.slice(j, LIVE.indexOf('\n  }', j));
  assert.ok(/'✓'/.test(save) && /'✗ '/.test(save), 'the create must report success AND failure');
  assert.ok(/await loadUsers\(\)/.test(save),
    'it must reload from the server — creating a company moves its head out of '
    + 'Single Users, so both tab counts change and recomputing locally would be '
    + 'a second copy of the bucketing rule');
});
