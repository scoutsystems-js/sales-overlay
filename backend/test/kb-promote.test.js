// PATCH /kb/:source_label/scope — the promotion decision (KB Part 2, sub-stage 2a).
//
// Exercises the pure resolver that decides what a promote/demote request writes.
// The route itself is thin around this: gate → resolve → scoped UPDATE.
//
// Ruling 5 context: a MANAGER promoting a rep's material writes it into the TEAM
// KB. Provenance (uploaded_by) is never rewritten — team_owner_id carries the team.
const test = require('node:test');
const assert = require('node:assert');
const { resolvePromotion } = require('../routes/kb');

const manager = { role: 'manager', p_user_id: 'mgr-1', p_admin_id: 'mgr-1', managed_by: null };
const owner   = { role: 'owner',   p_user_id: 'own-1', p_admin_id: 'own-1', managed_by: null };
const solo    = { role: 'user',    p_user_id: 'u-1',   p_admin_id: null,    managed_by: null };
const managed = { role: 'user',    p_user_id: 'rep-1', p_admin_id: 'mgr-1', managed_by: 'mgr-1' };

test('manager promoting to team stamps their own id as the team key', () => {
  const r = resolvePromotion(manager, 'team');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.patch, { scope: 'team', team_owner_id: 'mgr-1' });
});

test('owner-as-manager promoting to team stamps the owner id (owners run teams here)', () => {
  // Live org shape: 3 owners, 5 users, 4 of them managed BY an owner. Owner-with-
  // reps is the real manager persona, so it must be able to promote.
  const r = resolvePromotion(owner, 'team');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.patch, { scope: 'team', team_owner_id: 'own-1' });
});

test('demoting to personal clears the team key', () => {
  // Leaving team_owner_id set on a personal row would be a latent leak: flipping
  // scope back to team later would silently republish to the old team.
  const r = resolvePromotion(manager, 'personal');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.patch, { scope: 'personal', team_owner_id: null });
});

test('a user with NO team cannot promote (nothing to promote INTO)', () => {
  const r = resolvePromotion(solo, 'team');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /team/i);
});

test('a MANAGED rep cannot promote — the manager curates the team KB', () => {
  // Belt-and-braces: requireKbAccess already 403s managed reps before this runs.
  const r = resolvePromotion(managed, 'team');
  assert.strictEqual(r.ok, false);
});

test('an unrecognised target scope is rejected, not coerced', () => {
  for (const bad of ['global', 'seeded', '', null, undefined, 'TEAM', 7, {}]) {
    const r = resolvePromotion(manager, bad);
    assert.strictEqual(r.ok, false, 'should reject: ' + JSON.stringify(bad));
  }
});

test('promotion NEVER rewrites uploaded_by (provenance is preserved)', () => {
  // The whole reason team_owner_id exists. If a patch ever carries uploaded_by,
  // attribution ("this came from Ava's Mar-14 call") is destroyed irreversibly.
  for (const target of ['team', 'personal']) {
    const r = resolvePromotion(manager, target);
    assert.ok(r.ok);
    assert.ok(!('uploaded_by' in r.patch), 'patch must not touch uploaded_by');
  }
});

test('global scope is not reachable through promotion', () => {
  // Owner-global is set at upload time by role mapping. Allowing it here would let
  // one click publish a rep's call material platform-wide, across every team.
  const r = resolvePromotion(owner, 'global');
  assert.strictEqual(r.ok, false);
});
