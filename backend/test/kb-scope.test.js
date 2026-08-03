// lib/kb-scope.js — THE single source of truth for knowledge_base visibility.
//
// Before 2a this predicate existed in FOUR places (match_knowledge RPC,
// lib/kb-visibility.js, the inline filter in routes/kb.js /kb/search, and the
// team branch of lib/selling-context.js). This suite pins the one canonical
// implementation; kb-scope-sql-mirror.test.js pins the SQL copy that can't import it.
//
// Security-critical: a rep must see their own team's KB and global framework,
// but NEVER another team's material.
const test = require('node:test');
const assert = require('node:assert');
const { kbReadRowVisible, teamKeyOf, KB_VISIBILITY_SQL } = require('../lib/kb-scope');

// A managed rep: their team key (p_admin_id) is their manager's id.
const rep = { p_user_id: 'rep-1', p_admin_id: 'mgr-1' };

// ── teamKeyOf: which id owns a team row ──────────────────────────────────
// team_owner_id is the new (2a) explicit team key. Rows written before it
// existed fall back to uploaded_by, which was the OLD implicit rule — that
// fallback is what makes the migration non-breaking.
test('teamKeyOf prefers team_owner_id when present', () => {
  assert.strictEqual(teamKeyOf({ team_owner_id: 'mgr-1', uploaded_by: 'rep-1' }), 'mgr-1');
});

test('teamKeyOf falls back to uploaded_by when team_owner_id is absent (legacy rows)', () => {
  assert.strictEqual(teamKeyOf({ uploaded_by: 'mgr-1' }), 'mgr-1');
  assert.strictEqual(teamKeyOf({ team_owner_id: null, uploaded_by: 'mgr-1' }), 'mgr-1');
});

test('teamKeyOf is null for a row with neither', () => {
  assert.strictEqual(teamKeyOf({}), null);
  assert.strictEqual(teamKeyOf(null), null);
});

// ── The predicate — legacy behaviour preserved ───────────────────────────
test('seeded framework rows (uploaded_by null) are visible to everyone', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: null, scope: null }, rep), true);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: undefined, scope: 'team' }, rep), true);
});

test('global (owner) uploads are visible to everyone', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'owner-9', scope: 'global' }, rep), true);
});

test('a rep sees their own personal uploads but not another user’s personal', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'rep-1', scope: 'personal' }, rep), true);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'someone-else', scope: 'personal' }, rep), false);
});

test('LEGACY team row (no team_owner_id, uploaded_by = manager) stays visible', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1', scope: 'team' }, rep), true);
});

test("a rep must NOT see a DIFFERENT team's legacy uploads (no cross-team leak)", () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-2', scope: 'team' }, rep), false);
});

// ── The predicate — the NEW promotion case (this is why 2a exists) ───────
test('PROMOTED row: uploaded_by is the REP, team_owner_id is the manager → visible to the team', () => {
  // This is the case the old predicate got wrong: flipping scope to 'team' on a
  // rep's own entry made it visible to NOBODY, because visibility demanded
  // uploaded_by BE the manager. Provenance (uploaded_by) is now preserved.
  const promoted = { uploaded_by: 'rep-1', team_owner_id: 'mgr-1', scope: 'team' };
  assert.strictEqual(kbReadRowVisible(promoted, rep), true);
  // ...and a teammate of the same manager sees it too.
  const teammate = { p_user_id: 'rep-2', p_admin_id: 'mgr-1' };
  assert.strictEqual(kbReadRowVisible(promoted, teammate), true);
});

test('a promoted row does NOT leak to another team', () => {
  const promoted = { uploaded_by: 'rep-1', team_owner_id: 'mgr-1', scope: 'team' };
  const otherTeam = { p_user_id: 'rep-9', p_admin_id: 'mgr-2' };
  assert.strictEqual(kbReadRowVisible(promoted, otherTeam), false);
});

test('team_owner_id OVERRIDES uploaded_by — a row uploaded by mgr-1 but keyed to mgr-2 belongs to mgr-2', () => {
  const row = { uploaded_by: 'mgr-1', team_owner_id: 'mgr-2', scope: 'team' };
  assert.strictEqual(kbReadRowVisible(row, rep), false);                                  // mgr-1's rep: no
  assert.strictEqual(kbReadRowVisible(row, { p_user_id: 'x', p_admin_id: 'mgr-2' }), true); // mgr-2's rep: yes
});

// ── Degenerate / defensive ───────────────────────────────────────────────
test('a team row is not visible when the caller has no team (p_admin_id null)', () => {
  const solo = { p_user_id: 'u-1', p_admin_id: null };
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1', scope: 'team' }, solo), false);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'r', team_owner_id: null, scope: 'team' }, solo), false);
  // ...but they still see global + their own personal.
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'x', scope: 'global' }, solo), true);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'u-1', scope: 'personal' }, solo), true);
});

test('unknown/other scopes are not visible by default', () => {
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1', scope: 'weird' }, rep), false);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'mgr-1' }, rep), false); // no scope
});

test('null row / null scope object never throw and never grant access', () => {
  assert.strictEqual(kbReadRowVisible(null, rep), false);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'rep-1', scope: 'personal' }, null), false);
  assert.strictEqual(kbReadRowVisible({ uploaded_by: 'r', team_owner_id: 'mgr-1', scope: 'team' }, null), false);
});

test('KB_VISIBILITY_SQL is exported for the RPC mirror guard', () => {
  assert.strictEqual(typeof KB_VISIBILITY_SQL, 'string');
  assert.ok(KB_VISIBILITY_SQL.includes('team_owner_id'), 'SQL constant must carry the new team key');
});
