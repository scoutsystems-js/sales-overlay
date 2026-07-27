// Tests for the outcome-tag permission + Close=100 rules (Threads 1 & 2).
// Security-critical: a MANAGED rep must not be able to tag their own outcome.
const test = require('node:test');
const assert = require('node:assert');
const ot = require('../lib/outcome-tag');

test('effectiveCloseScore: 100 when closed, else the earned score', () => {
  assert.strictEqual(ot.effectiveCloseScore('closed', 73, 88), 100);
  assert.strictEqual(ot.effectiveCloseScore('follow_up', 73, 88), 73);   // earned wins over displayed
  assert.strictEqual(ot.effectiveCloseScore('lost', 41, 41), 41);
  assert.strictEqual(ot.effectiveCloseScore('follow_up', null, 55), 55); // pre-027 fallback to current
});

test('canTagOutcome: owner may tag any call', () => {
  assert.strictEqual(ot.canTagOutcome({ id: 'o', role: 'owner' }, { user_id: 'anyone', managed_by: 'someone' }), true);
});

test('canTagOutcome: manager may tag own + managed reps, not others', () => {
  var mgr = { id: 'm', role: 'manager' };
  assert.strictEqual(ot.canTagOutcome(mgr, { user_id: 'm', managed_by: null }), true);       // own call
  assert.strictEqual(ot.canTagOutcome(mgr, { user_id: 'rep', managed_by: 'm' }), true);        // their rep
  assert.strictEqual(ot.canTagOutcome(mgr, { user_id: 'rep2', managed_by: 'otherMgr' }), false); // not theirs
});

test('canTagOutcome: an UNMANAGED user may tag their own calls', () => {
  assert.strictEqual(ot.canTagOutcome({ id: 'u', role: 'user' }, { user_id: 'u', managed_by: null }), true);
});

test('canTagOutcome: a MANAGED rep may NOT tag their own (no self-inflation)', () => {
  assert.strictEqual(ot.canTagOutcome({ id: 'rep', role: 'user' }, { user_id: 'rep', managed_by: 'mgr' }), false);
});

test('canTagOutcome: a user may never tag someone else', () => {
  assert.strictEqual(ot.canTagOutcome({ id: 'u', role: 'user' }, { user_id: 'other', managed_by: null }), false);
});

test('VALID_OUTCOMES is the enum', () => {
  assert.deepStrictEqual(ot.VALID_OUTCOMES, ['closed', 'follow_up', 'lost', 'no_show']);
});
