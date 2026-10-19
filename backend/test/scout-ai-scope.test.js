'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleUserIds } = require('../lib/scout-ai-scope');

const PROFILES = [
  { user_id: 'owner', role: 'owner', active: true, managed_by: null },
  { user_id: 'manager-a', role: 'manager', active: true, managed_by: null },
  { user_id: 'closer-a', role: 'user', active: true, managed_by: 'manager-a' },
  { user_id: 'manager-b', role: 'manager', active: true, managed_by: null },
  { user_id: 'closer-b', role: 'user', active: true, managed_by: 'manager-b' },
  { user_id: 'inactive-closer', role: 'user', active: false, managed_by: 'manager-a' },
];

test('a closer can ask only about their own saved Scout data', () => {
  assert.deepEqual(visibleUserIds({ id: 'closer-a', role: 'user' }, PROFILES, []), ['closer-a']);
});

test('a manager can ask about their team, including a closer shared to them', () => {
  assert.deepEqual(
    visibleUserIds({ id: 'manager-a', role: 'manager' }, PROFILES, [{ manager_user_id: 'manager-a', rep_user_id: 'closer-b' }]).sort(),
    ['closer-a', 'closer-b', 'manager-a']
  );
});

test('an owner can ask about every active non-owner plus themselves', () => {
  assert.deepEqual(
    visibleUserIds({ id: 'owner', role: 'owner' }, PROFILES, []).sort(),
    ['closer-a', 'closer-b', 'manager-a', 'manager-b', 'owner']
  );
});
