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

test('deleteBlockReason: any recorded call blocks delete', () => {
  assert.ok(um.deleteBlockReason(3, 0));               // fathom calls
  assert.ok(um.deleteBlockReason(0, 5));               // sessions
  assert.ok(um.deleteBlockReason(1, 0));               // one call still blocks
  assert.match(um.deleteBlockReason(3, 0), /3 recorded calls/);
  assert.match(um.deleteBlockReason(1, 0), /1 recorded call\b/); // singular
});

test('deleteBlockReason: zero history allows delete (returns null)', () => {
  assert.strictEqual(um.deleteBlockReason(0, 0), null);
  assert.strictEqual(um.deleteBlockReason(null, undefined), null);
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
