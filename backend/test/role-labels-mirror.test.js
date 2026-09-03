'use strict';
/* ⚠⚠ FIX #8 — ONE ROLE MAP, EXECUTED ON EVERY PAGE THAT RENDERS A ROLE. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const lib = require('../lib/role-labels');
const PAGES = ['web/dashboard.html', 'web/admin.html', 'web/coaching.html'];
function pageRoleLabel(file) {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const a = src.indexOf('var ROLE_LABELS = {'); assert.ok(a > -1, file + ': the mirror is missing');
  const b = src.indexOf('\n  }', src.indexOf('function roleLabel(role)', a)); assert.ok(b > a, file + ': roleLabel not found after the map');
  return new Function(src.slice(a, b + 4) + '\n return roleLabel;')();
}
test('the ruling: user → Rep, manager → Manager, owner → Admin; the stored value is untouched', () => {
  assert.deepStrictEqual(lib.ROLE_LABELS, { user: 'Rep', manager: 'Manager', owner: 'Admin' });
  assert.strictEqual(lib.roleLabel('user'), 'Rep'); assert.strictEqual(lib.roleLabel('OWNER'), 'Admin'); assert.strictEqual(lib.roleLabel(null), 'Rep');
});
PAGES.forEach((file) => {
  test('⚠⚠ EXECUTED: ' + file + "'s copy answers exactly as the lib for every role and for garbage", () => {
    const fn = pageRoleLabel(file);
    ['user', 'manager', 'owner', 'OWNER', 'ghost', null, undefined].forEach((r) => assert.strictEqual(fn(r), lib.roleLabel(r), file + ' differs on ' + JSON.stringify(r)));
  });
});
test('⚠ every role render site passes the value THROUGH the map (stripped source) — never the stored word', () => {
  const dash = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  assert.ok(/<td>' \+ escapeHtml\(roleLabel\(m\.role \|\| 'user'\)\) \+ '<\/td>/.test(dash), 'My Team table');
  assert.ok(/scope-pill">' \+ escapeHtml\(roleLabel\(state\.me\.role \|\| ''\)\) \+ ' view/.test(dash), 'the pivot pill');
  assert.ok(!/escapeHtml\(m\.role \|\| 'user'\)/.test(dash) && !/escapeHtml\(state\.me\.role \|\| ''\)/.test(dash), 'no raw role reaches a text position');
  const coach = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'coaching.html'), 'utf8'));
  assert.ok(/badge\.textContent = roleLabel\(currentUser\.role\) \+ ' view'/.test(coach), 'coaching page badge');
  assert.ok(!/currentUser\.role \+ ' view'/.test(coach));
  const admin = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8'));
  assert.ok(!/return r === 'owner' \? 'admin \(owner\)' : r;/.test(admin), "admin's partial map is folded in — 'admin (owner)' is gone");
  assert.ok(/escapeHtml\(roleLabel\(u\.role\)\)/.test(admin), 'the admin badge still goes through the map');
});
