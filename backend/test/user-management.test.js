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

test('⚠⚠ HISTORY IS DESTROYED WITH THE USER — the tombstone is SUPERSEDED', () => {
  /* ⚠⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and that is not a bug that was
     found — it is a RULING that changed (Justin, 2026-08-26). Deleting a user
     now takes their calls and history with it, the same blast radius as
     deleting a company. **DEACTIVATE is the safeguard**: it keeps every number
     and is reversible, and it is why only admins may delete.
     ⚠ Recorded here rather than only in CLAUDE.md, because whoever finds this
     inverted assertion cold would otherwise read it as a regression. */
  assert.strictEqual(um.deletePlan({ callCount: 3, sessionCount: 0 }).mode, 'purge');
  assert.strictEqual(um.deletePlan({ callCount: 0, sessionCount: 5 }).mode, 'purge', 'sessions count too');
  assert.strictEqual(um.deletePlan({ callCount: 3, sessionCount: 2 }).calls, 5, 'both sources still sum');
  // ⚠ THE COUNT IS THE COST NOW, NOT A ROUTING SIGNAL — the dialog names it.
  assert.strictEqual(um.deletePlan({ callCount: 12 }).calls, 12);
});

test('⚠⚠ RENAMED hard -> purge ON PURPOSE — the meaning changed, the type did not', () => {
  /* 'hard' meant "no history, so nothing to preserve". It would now mean
     "destroy the history too". A value whose meaning moves while its type stays
     put is the silent-semantic-change trap: every caller keeps working and keeps
     producing confident wrong output. The rename forces each one to be found. */
  ['hard', 'tombstone'].forEach(function (dead) {
    assert.notStrictEqual(um.deletePlan({ callCount: 3 }).mode, dead, dead + ' must not come back');
    assert.notStrictEqual(um.deletePlan({ callCount: 0 }).mode, dead, dead + ' must not come back');
  });
});

test('⚠ no history is the SAME path — one destructive mode, not two', () => {
  // Nothing to destroy is not a different KIND of delete, and treating it as one
  // is how the two paths drift.
  assert.strictEqual(um.deletePlan({ callCount: 0, sessionCount: 0 }).mode, 'purge');
  assert.strictEqual(um.deletePlan({}).mode, 'purge');
  assert.strictEqual(um.deletePlan().mode, 'purge', 'a missing argument must not change the mode');
});

test('⚠⚠ THE CONFIRMATION NAMES THE COST AND THE OTHER DOOR', () => {
  var t = um.deleteUserConfirmation('rep@example.com', 12);
  assert.match(t, /rep@example\.com/, 'who');
  assert.match(t, /12 calls/, 'how many');
  assert.match(t, /CANNOT be undone/, 'and that there is no recovery');
  // ⚠ Deactivate is the safeguard, so the destructive dialog must point at it —
  // someone about to delete may simply not want this.
  assert.match(t, /Deactivate/, 'must offer the reversible door');
  assert.match(um.deleteUserConfirmation('a@b.com', 1), /1 call\b/, 'singular');
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
