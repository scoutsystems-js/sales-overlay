// provisionUser — atomic create-user orchestration. RULING (2026-07-31): a create
// must either FULLY succeed or leave NOTHING new behind. This encodes that across
// the two-system (auth + user_profiles) create, plus orphan handling: a prior
// failed create can leave an auth row with no profile ("already registered" on a
// seemingly-fresh email); provisionUser reclaims such an orphan instead of failing
// or stacking another one. Pure orchestration over injected deps → fully testable.
const test = require('node:test');
const assert = require('node:assert');
const provisionUser = require('../lib/provision-user');

// A configurable fake dep set. Each fn records calls.
function makeDeps(overrides) {
  const calls = { created: [], inserted: [], deleted: [], pw: [], lookedUp: [] };
  const base = {
    createAuthUser: async (email) => { calls.created.push(email); return { id: 'new-id' }; },
    findAuthUserByEmail: async (email) => { calls.lookedUp.push(email); return null; },
    profileExists: async () => false,
    setPassword: async (id) => { calls.pw.push(id); return {}; },
    insertProfile: async (id, fields) => { calls.inserted.push({ id, fields }); return {}; },
    deleteAuthUser: async (id) => { calls.deleted.push(id); return {}; },
  };
  return { deps: Object.assign(base, overrides || {}), calls };
}
const OPTS = { email: 'x@y.com', role: 'user', managedBy: 'mgr-1', firstName: 'A', lastName: 'B', password: 'pw' };

test('fresh create: auth + profile both succeed → ok, profile gets the right fields', async () => {
  const { deps, calls } = makeDeps();
  const r = await provisionUser(deps, OPTS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.user_id, 'new-id');
  assert.strictEqual(r.reclaimed, false);
  assert.deepStrictEqual(calls.inserted[0], { id: 'new-id', fields: { role: 'user', managed_by: 'mgr-1', firstName: 'A', lastName: 'B' } });
  assert.strictEqual(calls.deleted.length, 0);
});

test('profile insert fails on a FRESH create → auth user rolled back (nothing left behind)', async () => {
  const { deps, calls } = makeDeps({ insertProfile: async () => ({ error: 'db down' }) });
  const r = await provisionUser(deps, OPTS);
  assert.ok(r.error);
  assert.strictEqual(r.code, 'profile_failed');
  assert.deepStrictEqual(calls.deleted, ['new-id']); // rolled back
});

test('profile insert fails AND rollback delete fails → reports the orphan, never silent', async () => {
  const { deps } = makeDeps({
    insertProfile: async () => ({ error: 'db down' }),
    deleteAuthUser: async () => ({ error: 'delete failed' }),
  });
  const r = await provisionUser(deps, OPTS);
  assert.strictEqual(r.code, 'rollback_failed');
  assert.strictEqual(r.orphanId, 'new-id');
});

test('createAuthUser fails and NO existing auth row → surfaces create error', async () => {
  const { deps, calls } = makeDeps({ createAuthUser: async () => ({ error: 'boom' }) });
  const r = await provisionUser(deps, OPTS);
  assert.strictEqual(r.code, 'create_failed');
  assert.strictEqual(calls.inserted.length, 0);
});

test('email collision with a REAL user (auth + profile exist) → clean duplicate error, no writes', async () => {
  const { deps, calls } = makeDeps({
    createAuthUser: async () => ({ error: 'already registered' }),
    findAuthUserByEmail: async () => ({ id: 'existing' }),
    profileExists: async () => true,
  });
  const r = await provisionUser(deps, OPTS);
  assert.strictEqual(r.code, 'duplicate');
  assert.strictEqual(calls.inserted.length, 0);
  assert.strictEqual(calls.deleted.length, 0);
});

test('email collision with an ORPHAN (auth, no profile) → RECLAIMED: set password + insert profile', async () => {
  const { deps, calls } = makeDeps({
    createAuthUser: async () => ({ error: 'already registered' }),
    findAuthUserByEmail: async () => ({ id: 'orphan-id' }),
    profileExists: async () => false,
  });
  const r = await provisionUser(deps, OPTS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.user_id, 'orphan-id');
  assert.strictEqual(r.reclaimed, true);
  assert.deepStrictEqual(calls.pw, ['orphan-id']);                 // password (re)set so the invite works
  assert.strictEqual(calls.inserted[0].id, 'orphan-id');
  assert.strictEqual(calls.deleted.length, 0);                     // never deletes; it adopts
});

test('orphan reclaim: profile insert fails → does NOT delete the pre-existing auth row', async () => {
  const { deps, calls } = makeDeps({
    createAuthUser: async () => ({ error: 'already registered' }),
    findAuthUserByEmail: async () => ({ id: 'orphan-id' }),
    profileExists: async () => false,
    insertProfile: async () => ({ error: 'db down' }),
  });
  const r = await provisionUser(deps, OPTS);
  assert.strictEqual(r.code, 'profile_failed');
  assert.strictEqual(calls.deleted.length, 0); // we didn't create it → we don't delete it
});
