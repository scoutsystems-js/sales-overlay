/**
 * ⚠⚠ THE MANAGER IS A MEMBER OF THEIR OWN TEAM — NINTH SITE OF THE SAME DEFECT.
 *
 * `9a27979` fixed this at eight endpoints by making resolveTeam return memberIds
 * (reps + the board owner). The DAILY DIGEST never got the fix, because it does
 * not call resolveTeam — it hand-rolls the rule from `managed_by` inside
 * generateDailyDigests, and a hand-rolled copy cannot inherit a fix.
 *
 * ⚠ THE LIVE SYMPTOM, and what the first test below reproduces: Josh's digest
 * read "quiet day · 0 calls" for 2026-08-24, a day he took EIGHT real calls. His
 * four reps are three demo accounts and one test user, all with zero real calls,
 * so excluding the manager leaves literally nothing to count. A digest that says
 * "quiet day" about a day someone worked is a verdict, and a wrong one.
 *
 * ⚠ resolveTeam ITSELF CANNOT BE CALLED HERE. It takes an Express `req` (it reads
 * req.user and ?team=), and digest generation runs from the sync cron with no
 * request, iterating every manager. So the shared thing is the RULE, not the
 * route helper — hence lib/team-membership.js, which routes/team.js also uses.
 * Adding the manager to the hand-rolled list instead would be a tenth copy.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const TM = require('../lib/team-membership');

/** Josh's real shape on 2026-08-25. */
const JOSH = '8c952cc0';
const PROFILES = [
  { user_id: JOSH,        managed_by: null },
  { user_id: 'demo-ava',  managed_by: JOSH },
  { user_id: 'demo-ben',  managed_by: JOSH },
  { user_id: 'demo-cara', managed_by: JOSH },
  { user_id: 'test-user', managed_by: JOSH },
  { user_id: 'daniel',    managed_by: 'joshua' },
  { user_id: 'joshua',    managed_by: null },
];

/** The old, defective construction — kept so the test proves it was the cause. */
function handRolledRepsByManager(rows) {
  const out = {};
  rows.forEach((p) => { if (p.managed_by) (out[p.managed_by] = out[p.managed_by] || []).push(p.user_id); });
  return out;
}

test('REPRODUCES IT: the hand-rolled list excludes Josh, so his 8 calls are uncountable', () => {
  const old = handRolledRepsByManager(PROFILES);
  assert.ok(!old[JOSH].includes(JOSH), 'the manager is absent — this is the defect');
  // his four reps have no real calls, so the countable set is empty
  const realCallsBy = { [JOSH]: 8, 'demo-ava': 0, 'demo-ben': 0, 'demo-cara': 0, 'test-user': 0 };
  const counted = old[JOSH].reduce((n, id) => n + realCallsBy[id], 0);
  assert.strictEqual(counted, 0, 'this is the "quiet day · 0 calls" the digest rendered');
});

test('FIXED: membersByManager includes the manager, so the day counts 8', () => {
  const members = TM.membersByManager(PROFILES);
  assert.ok(members[JOSH].includes(JOSH), 'the manager must be in their own member list');
  const realCallsBy = { [JOSH]: 8, 'demo-ava': 0, 'demo-ben': 0, 'demo-cara': 0, 'test-user': 0 };
  const counted = members[JOSH].reduce((n, id) => n + (realCallsBy[id] || 0), 0);
  assert.strictEqual(counted, 8, 'the digest must see the manager\'s own calls');
});

test('every manager gets themselves, not just the one under test', () => {
  const m = TM.membersByManager(PROFILES);
  assert.ok(m['joshua'].includes('joshua'));
  assert.ok(m['joshua'].includes('daniel'));
});

test('a user with no reps does not become a team', () => {
  const m = TM.membersByManager(PROFILES);
  assert.ok(!Object.prototype.hasOwnProperty.call(m, 'daniel'),
    'having a manager does not make you one — only reps do');
});

test('withBoardOwner is the one rule, and it is idempotent', () => {
  assert.deepStrictEqual(TM.withBoardOwner('m', ['a', 'b']), ['a', 'b', 'm']);
  assert.deepStrictEqual(TM.withBoardOwner('m', ['a', 'm']), ['a', 'm'], 'must not duplicate the owner');
  assert.deepStrictEqual(TM.withBoardOwner('m', []), ['m']);
  assert.deepStrictEqual(TM.withBoardOwner(null, ['a']), ['a'], 'no key, no addition');
});

test('it does not mutate its input', () => {
  const reps = ['a'];
  TM.withBoardOwner('m', reps);
  assert.deepStrictEqual(reps, ['a']);
});
