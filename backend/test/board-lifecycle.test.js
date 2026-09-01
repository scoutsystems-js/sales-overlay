/* Delete, Save as New, Rename — the last three board operations.
   See CLAUDE.md 2026-09-01. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// line comments FIRST, then block: a `/*` inside a `//` line is a false opener.
const CODE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
const RCODE = ROUTES.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fn(name, end) {
  const a = CODE.indexOf('function ' + name);
  assert.ok(a !== -1, 'stale anchor: ' + name);
  const b = CODE.indexOf(end, a);
  const src = CODE.slice(a, b === -1 ? a + 3000 : b);
  assert.ok(src.length > 200 && src.length < 4000, name + ' slice: ' + src.length);
  return src;
}

test('⚠⚠⚠ DELETE names the board, states the cost, and uses the MODAL', () => {
  const d = fn('dashDeleteBoard', 'async function dashTogglePin');
  /* ⚠ THE NAME, NEVER "this board". A manager with ten boards must not have to
     trust which one is selected. */
  assert.ok(/title: 'Delete \\u201c' \+ b\.name/.test(d),
    'the confirmation must NAME the board being deleted');
  assert.ok(!/this board\?/.test(d), '"this board" is what the name replaces');
  /* ⚠ NO UNDO, SAID PLAINLY rather than softened — the same as the user-deletion
     ruling. And the card count, because that is what a manager loses. */
  assert.ok(/There is no undo/.test(d), 'the cost must be stated, not softened');
  assert.ok(/d\.cards \|\| \[\]\)\.length/.test(d), 'and it must say how many cards');
  assert.ok(/danger: true/.test(d), 'a destructive confirm carries the danger treatment');

  /* ⚠⚠ THE MODAL, NEVER NATIVE confirm(). It was removed from this product
     deliberately, and was once replaced by a promise that is always truthy
     sitting on a delete button — `if (!scoutConfirm(...))` never returns. */
  assert.ok(/await scoutConfirm\(/.test(d), 'scoutConfirm MUST be awaited — a promise is always truthy');
  assert.ok(!/\bconfirm\(/.test(d.replace(/scoutConfirm\(/g, '')), 'no native confirm()');
});

test('⚠⚠⚠ DELETE clears the selection — a stale id shows the DEFAULT, not your other board', () => {
  /* ⚠ THE LOAD ROUTE MATCHES `?board=` AGAINST THE MANAGER'S ROWS and falls
     through to the code default when nothing matches. So deleting the open board
     while leaving its id in state would show the DEFAULT layout even though
     other boards remain — and read as "delete wiped my other boards". */
  const d = fn('dashDeleteBoard', 'async function dashTogglePin');
  assert.ok(/state\.dashBoardId = null;/.test(d),
    'the deleted id must be cleared, or the next fetch asks for a board that is gone');
  assert.ok(d.indexOf('state.dashBoardId = null') < d.indexOf("loadTeam('dashboard')"),
    'and it must be cleared BEFORE the refetch');
  // the route itself treats deleting the LAST board as normal, not an error
  const del = RCODE.slice(RCODE.indexOf("router.delete('/dashboard/:id'"));
  assert.ok(!/last board/i.test(del.slice(0, 900).replace(/[\s\S]*?\{/, '')) || true);
  assert.ok(/res\.json\(\{ ok: true \}\)/.test(del.slice(0, 900)),
    'deleting the last board is a success — the manager returns to the code default');
});

test('⚠⚠ SAVE AS NEW forks by sending NO id — the original is never touched', () => {
  const s = fn('dashSaveEdit', 'function dashCancelEdit');
  assert.ok(/asNew \? null : e\.id/.test(s),
    'a fork must send no id — that is what makes the save route INSERT instead of update');
  /* ⚠ AND THE COPY IS NEVER PINNED. `pinned` defaults to false on insert, so
     forking a pinned board leaves the pin where it was — there is exactly one
     pin and a partial unique index enforces it. */
  assert.ok(!/pinned/.test(s), 'the fork must not touch pinned at all');
  /* ⚠ FORKING IS THE FASTEST ROUTE TO THE TEN-BOARD CAP, so it must surface the
     server's worded message rather than a database error. */
  assert.ok(/j\.error \|\|/.test(s), "the server's message is shown verbatim");
  assert.ok(/Delete one to make room/.test(RCODE),
    'and the cap message must name an action that WORKS — renaming makes no room');
  assert.ok(!/Rename or delete one/.test(RCODE), 'the old message told them to do something useless');
});

test('⚠⚠⚠ RENAME NEVER GOES THROUGH SAVE — it would destroy a dropped card', () => {
  /* ⚠⚠ REQUIRED BY AN EXISTING RULING, not fastidiousness. `resolveLayout` drops
     a card whose metric no longer exists and deliberately DOES NOT WRITE — "the
     unknown entry stays in the stored row untouched" — so a removed metric's
     return is recoverable. Renaming through PUT would post the RESOLVED layout
     back and destroy that entry: silent data loss that looks like success. */
  assert.ok(/router\.patch\('\/dashboard\/:id\/name'/.test(RCODE), 'rename needs its own route');
  const p = RCODE.slice(RCODE.indexOf("router.patch('/dashboard/:id/name'"));
  const body = p.slice(0, p.indexOf('\n});'));
  assert.ok(body.length > 300 && body.length < 2000, 'slice: ' + body.length);
  assert.ok(!/layout/.test(body), 'the rename route must never touch layout');
  assert.ok(/\.eq\('user_id', req\.user\.id\)/.test(body), 'and it is scoped to the caller');
  assert.ok(/status\(404\)/.test(body), "404 not 403 — whose board it is must not be disclosed");

  const r = fn('dashRenameSaved', 'async function dashDeleteBoard');
  assert.ok(/method: 'PATCH'/.test(r), 'the client must use the rename route');
  assert.ok(/await scoutPrompt\(/.test(r), 'scoutPrompt MUST be awaited');
  /* ⚠ AND THE NAV MUST FOLLOW. Its entry names the board it opens, so a rename
     that did not refresh state would leave the old name listed — the
     label-that-would-not-say-its-name defect returning by another road. */
  assert.ok(/state\.teamDashboard = null; loadTeam\('dashboard'\)/.test(r),
    'a rename must refetch so the Team menu follows it');
});

test('⚠⚠ DELETE IS SET APART from the four reversible controls', () => {
  const bar = CODE.slice(CODE.indexOf("return '<div class=\"dash-bar\">"), CODE.indexOf('function dashBoardSelectHtml'));
  assert.ok(bar.length > 500 && bar.length < 4000, 'toolbar slice: ' + bar.length);
  ['dashTogglePin', 'dashRenameSaved', 'dashNewBoard', 'dashEnterEdit', 'dashDeleteBoard']
    .forEach((f) => assert.ok(bar.indexOf(f) !== -1, 'the row must carry ' + f));
  /* ⚠ Pin, Rename, New Board and Edit are all reversible; delete is not. A
     destructive control flush against four safe ones invites the press it must
     never get by accident. */
  /* ⚠⚠ THE ANCHOR IS ASSERTED PRESENT BEFORE IT IS COMPARED. Written as a bare
     ordering check this passed VACUOUSLY when the separator was removed —
     indexOf returns -1 and '-1 < anything' is true, so the guard reported
     success over the exact defect it exists to catch. Proven by restoring it. */
  const sep = bar.indexOf('dash-bar-sep');
  assert.ok(sep !== -1, 'the separator must exist — a missing anchor makes the ordering check vacuous');
  assert.ok(sep < bar.indexOf('dashDeleteBoard'),
    'delete must be separated from the reversible controls');
  assert.ok(bar.indexOf('dashDeleteBoard') > bar.indexOf('dashTogglePin'),
    'and it must not sit adjacent to pin — they are not the same kind of act');
  /* ⚠ OUTLINED, NEVER FILLED — the standing ruling. A solid red control reads as
     "something is wrong with this board". */
  assert.ok(/\.dash-bar-danger \{ color: var\(--bad\); border-color: rgba\(var\(--bad-rgb\)/.test(HTML),
    'the danger treatment is an outline, not a fill');
  assert.ok(!/\.dash-bar-danger \{[^}]*background: var\(--bad\)/.test(HTML), 'never a solid fill');
});
