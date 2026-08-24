// Tests for the User Management guard logic (lib/user-management). These are the
// security-critical rules per Justin's rulings: rep-scope (a manager may only act
// on their own reps; delete is owner-only), the zero-history delete gate (call
// history is the company asset — never erasable via the UI), and the deactivation
// guards (not self, not an owner, not a manager who still has reps).
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const um = require('../lib/user-management');

test('canManageTarget: owner can manage anyone', () => {
  assert.strictEqual(um.canManageTarget('owner', 'o1', { managed_by: 'someone-else' }), true);
  assert.strictEqual(um.canManageTarget('owner', 'o1', { managed_by: null }), true);
});

test('canManageTarget: manager only their own reps', () => {
  assert.strictEqual(um.canManageTarget('manager', 'm1', { managed_by: 'm1' }), true);
  assert.strictEqual(um.canManageTarget('manager', 'm1', { managed_by: 'm2' }), false); // another manager's rep
  assert.strictEqual(um.canManageTarget('manager', 'm1', { managed_by: null }), false); // unmanaged
  assert.strictEqual(um.canManageTarget('manager', 'm1', null), false);
});

test('canManageTarget: plain user can manage nobody', () => {
  assert.strictEqual(um.canManageTarget('user', 'u1', { managed_by: 'u1' }), false);
});

/* ⚠ CONVERTED, NOT DELETED (2026-08-24). The two tests here asserted that any
   recorded call BLOCKS a delete — a rule Justin overruled. But what they were
   really protecting is that a user's history is never destroyed by a delete,
   and that property still exists; only its mechanism moved from "refuse" to
   "tombstone". A test whose SUBJECT outlives its VEHICLE gets rewritten, not
   dropped — deleting it is how a property silently stops being covered. */

test('⚠⚠ HISTORY ROUTES TO A TOMBSTONE — a delete must never destroy calls', () => {
  assert.strictEqual(um.deletePlan({ callCount: 3, sessionCount: 0 }).mode, 'tombstone');
  assert.strictEqual(um.deletePlan({ callCount: 0, sessionCount: 5 }).mode, 'tombstone', 'sessions count too');
  assert.strictEqual(um.deletePlan({ callCount: 1, sessionCount: 0 }).mode, 'tombstone', 'ONE call is history');
  assert.strictEqual(um.deletePlan({ callCount: 3, sessionCount: 2 }).calls, 5, 'both sources sum');
});

test('⚠ zero history hard-deletes — there is nothing to preserve', () => {
  assert.strictEqual(um.deletePlan({ callCount: 0, sessionCount: 0 }).mode, 'hard');
  assert.strictEqual(um.deletePlan({}).mode, 'hard');
  assert.strictEqual(um.deletePlan().mode, 'hard', 'a missing argument must not become a tombstone');
});

test('⚠ still managing reps BLOCKS — they would be managed by a deleted person', () => {
  var p = um.deletePlan({ callCount: 9, sessionCount: 0, repCount: 2 });
  assert.strictEqual(p.mode, 'blocked');
  assert.match(p.reason, /move them to another manager first/);
  // ⚠ the rep guard outranks history: a manager WITH calls is still blocked
  assert.strictEqual(um.deletePlan({ callCount: 0, repCount: 1 }).mode, 'blocked');
  assert.match(um.deletePlan({ repCount: 1 }).reason, /that rep\b/, 'singular');
});

test('⚠⚠ THE TOMBSTONE IDENTITY IS DISTINCT PER USER AND NEVER BLANK', () => {
  var a = um.tombstoneIdentity('49711e7d-0dc0-4c6d-959d-f2a5bfe9a20a');
  var b = um.tombstoneIdentity('8bda1aac-6404-46a8-a353-de83606b298f');
  assert.notStrictEqual(a.email, b.email, 'two deleted people must not collide on one address');
  assert.notStrictEqual(a.last_name, b.last_name, 'nor render as the same person');

  /* ⚠ WHAT A MANAGER ACTUALLY SEES. resolveDisplayName reads first+last before
     falling back to the email, so this is the rendered string — not blank, not
     "undefined", not somebody else. */
  var rendered = (a.first_name + ' ' + a.last_name).trim();
  assert.strictEqual(rendered, 'Deleted user (49711e7d)');

  // ⚠ .invalid is RFC 2606 reserved — a scrubbed address can never become a
  // real mailbox belonging to a stranger.
  assert.match(a.email, /@deleted\.invalid$/);
  assert.ok(um.tombstoneIdentity(null).email.indexOf('@deleted.invalid') !== -1,
    'even a missing id must produce a usable, non-blank identity');
});

test('deactivateBlockReason: cannot deactivate yourself', () => {
  assert.match(um.deactivateBlockReason({ actorId: 'x', targetId: 'x', targetRole: 'user', repCount: 0 }), /your own account/);
});

test('deactivateBlockReason: cannot deactivate an owner', () => {
  assert.match(um.deactivateBlockReason({ actorId: 'a', targetId: 'b', targetRole: 'owner', repCount: 0 }), /Owners can/);
});

test('deactivateBlockReason: a manager with reps must move them first', () => {
  assert.match(um.deactivateBlockReason({ actorId: 'a', targetId: 'b', targetRole: 'manager', repCount: 4 }), /manages 4 reps/);
  assert.match(um.deactivateBlockReason({ actorId: 'a', targetId: 'b', targetRole: 'manager', repCount: 1 }), /manages 1 rep\b/);
});

test('deactivateBlockReason: a normal rep with no reports is deactivatable (null)', () => {
  assert.strictEqual(um.deactivateBlockReason({ actorId: 'a', targetId: 'b', targetRole: 'user', repCount: 0 }), null);
});
