/**
 * DEACTIVATE / REACTIVATE / DELETE A COMPANY (Justin's ruling, 2026-08-24):
 * deactivate keeps the data, delete destroys it.
 *
 * ⚠⚠ THE PROPERTY THIS FILE EXISTS FOR: reactivating a COMPANY must not
 * resurrect someone who was deactivated INDIVIDUALLY beforehand. `active=false`
 * looks identical either way, so without a record of which rows the company
 * action switched off, no later inspection could tell you it had happened.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/company-lifecycle');

const ACTIVE = { user_id: 'a', active: true, deactivated_with_company: false };
const OFF_BY_HAND = { user_id: 'b', active: false, deactivated_with_company: false };
const OFF_BY_COMPANY = { user_id: 'c', active: false, deactivated_with_company: true };

test('⚠ DEACTIVATE touches only the currently active — and does not re-flag the rest', () => {
  assert.deepStrictEqual(L.membersToDeactivate([ACTIVE, OFF_BY_HAND]), ['a'],
    'someone already deactivated by hand must be left exactly as they are; '
    + 'flagging them here is what would resurrect them later');
});

test('⚠⚠ REACTIVATE RESTORES ONLY WHAT THE COMPANY ACTION SWITCHED OFF', () => {
  const members = [ACTIVE, OFF_BY_HAND, OFF_BY_COMPANY];
  assert.deepStrictEqual(L.membersToReactivate(members), ['c'],
    'the hand-deactivated user (b) MUST stay off — reactivating "everyone who '
    + 'is inactive" is the obvious rule and is wrong');
});

test('⚠ THE FULL ROUND TRIP PRESERVES A HAND-DEACTIVATED USER', () => {
  let members = [
    { user_id: 'a', active: true, deactivated_with_company: false },
    { user_id: 'b', active: false, deactivated_with_company: false },   // off on purpose
  ];
  // deactivate the company
  const off = L.membersToDeactivate(members);
  members = members.map((m) => (off.indexOf(m.user_id) !== -1
    ? { user_id: m.user_id, active: false, deactivated_with_company: true } : m));
  assert.ok(members.every((m) => m.active === false), 'everyone is off while deactivated');

  // reactivate it
  const on = L.membersToReactivate(members);
  members = members.map((m) => (on.indexOf(m.user_id) !== -1
    ? { user_id: m.user_id, active: true, deactivated_with_company: false } : m));

  assert.strictEqual(members.filter((m) => m.user_id === 'a')[0].active, true, 'a comes back');
  assert.strictEqual(members.filter((m) => m.user_id === 'b')[0].active, false,
    'b was deactivated on purpose before the company was, and must STAY off');
});

test('a company READS as deactivated only when every member is off', () => {
  const head = { user_id: 'h', active: true };
  assert.strictEqual(L.isCompanyDeactivated({ head, members: [ACTIVE] }), false);
  assert.strictEqual(L.isCompanyDeactivated({
    head: { user_id: 'h', active: false }, members: [OFF_BY_COMPANY],
  }), true);
  assert.strictEqual(L.isCompanyDeactivated({
    head: { user_id: 'h', active: false }, members: [ACTIVE],
  }), false, 'one active member means the company is not deactivated');
  assert.strictEqual(L.isCompanyDeactivated({ head: null, members: [] }), false,
    'an empty company is not "deactivated"');
});

test('the head counts as a member of their own company', () => {
  assert.deepStrictEqual(L.allMemberIds({ head: { user_id: 'h' }, members: [{ user_id: 'r' }] }), ['h', 'r']);
});

/* ── delete ───────────────────────────────────────────────────────────────── */

test('⚠⚠ GLOBAL KB ROWS ARE NOT DELETED — they belong to every other company', () => {
  /* Measured 2026-08-24: one account owns 583 `global` rows, which every other
     company can see and search. Deleting them because their uploader churned
     would move a figure OUTSIDE the company being deleted. */
  assert.deepStrictEqual(L.KB_SCOPES_TO_DELETE, ['personal', 'team']);
  assert.strictEqual(L.KB_SCOPES_TO_DELETE.indexOf('global'), -1,
    'global KB is shared platform content, not company data');
});

test('⚠⚠ THE CONFIRMATION NAMES THE COST AND SAYS IT CANNOT BE UNDONE', () => {
  const c = L.deleteConfirmation('Acme Roofing', 4, 137);
  assert.ok(/Acme Roofing/.test(c), 'names the company');
  assert.ok(/4 people/.test(c), 'names how many people');
  assert.ok(/137 calls/.test(c), 'names how many calls');
  assert.ok(/CANNOT be undone/.test(c), 'says plainly that it is final');
  assert.ok(/no recovery/i.test(c));
  // singulars read correctly — "1 people" undermines every other number on screen
  const one = L.deleteConfirmation('Solo', 1, 1);
  assert.ok(/1 person\b/.test(one) && /1 call\b/.test(one), one);
});

test('degenerate input never throws', () => {
  [null, undefined, 'x', {}].forEach((v) => {
    assert.ok(Array.isArray(L.membersToDeactivate(v)));
    assert.ok(Array.isArray(L.membersToReactivate(v)));
    assert.strictEqual(typeof L.isCompanyDeactivated(v), 'boolean');
  });
});
