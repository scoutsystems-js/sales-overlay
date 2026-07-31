// kbReadRowVisible — the read-scope predicate deciding which knowledge_base rows a
// caller may SEE. Security-critical: a managed rep must see their own team's KB
// (what they're graded against) and global framework, but NEVER another team's
// uploads. Mirrors the /kb/search visibility filter; now the single source of
// truth for both search and the read-only /kb/list.
const test = require('node:test');
const assert = require('node:assert');
const { kbReadRowVisible } = require('../lib/kb-visibility');

// A managed rep: their team key (p_admin_id) is their manager's id.
const rep = { p_user_id: 'rep-1', p_admin_id: 'mgr-1' };

test('seeded framework rows (uploaded_by null) are visible to everyone', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: null, scope: null }, rep), true);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: undefined, scope: 'team' }, rep), true);
});

test('global (owner) uploads are visible to everyone', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'owner-9', scope: 'global' }, rep), true);
});

test("a rep sees their OWN team's uploads (uploaded_by === manager)", () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1', scope: 'team' }, rep), true);
});

test("a rep must NOT see a DIFFERENT team's uploads (no cross-team leak)", () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-2', scope: 'team' }, rep), false);
});

test('a rep sees their own personal uploads but not another user’s personal', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'rep-1', scope: 'personal' }, rep), true);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'someone-else', scope: 'personal' }, rep), false);
});

test('a team row is not visible when the caller has no team (p_admin_id null)', () => {
  const solo = { p_user_id: 'u-1', p_admin_id: null };
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1', scope: 'team' }, solo), false);
  // ...but they still see global + their own personal.
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'x', scope: 'global' }, solo), true);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'u-1', scope: 'personal' }, solo), true);
});

test('unknown/other scopes are not visible by default', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1', scope: 'weird' }, rep), false);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1' }, rep), false); // no scope
});
