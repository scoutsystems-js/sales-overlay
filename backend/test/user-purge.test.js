/**
 * ONE BLAST RADIUS, TWO CALLERS.
 *
 * ⚠⚠ Justin's ruling 2026-08-26: deleting a user deletes their calls and history
 * too — the same thing deleting a company already did. **REUSE THAT PATH, do not
 * write a second one.** Two copies of an unrecoverable operation is how they come
 * to differ, and the difference would only be discovered after the data was gone.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const purge = require('../lib/user-purge');
const ADMIN_SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

// A supabase double that records the calls in order.
function fakeAdmin(over) {
  const log = [];
  const del = (table) => ({
    delete: () => ({
      in(col, vals) { log.push({ op: 'delete', table, col, vals }); return this; },
      select: () => Promise.resolve({ data: [{ id: 'k1' }, { id: 'k2' }], error: null }),
      then(res) { res({ data: null, error: null }); },
    }),
  });
  return {
    _log: log,
    from: (t) => del(t),
    auth: { admin: { deleteUser: async (id) => {
      log.push({ op: 'deleteUser', id });
      return (over && over.failFor === id) ? { error: { message: 'boom' } } : { error: null };
    } } },
  };
}

test('⚠⚠ KB GOES FIRST — those rows have NO foreign key and would be orphaned', async () => {
  const a = fakeAdmin();
  await purge.purgeUsers(a, ['u1', 'u2']);
  // ⚠ COLLAPSE CONSECUTIVE ENTRIES FOR THE SAME TABLE — the KB delete chains two
  // .in() calls (uploaded_by, then scope), so a raw list is not the visit order.
  const order = a._log.map((e) => e.table || e.op).filter((v, i, arr) => v !== arr[i - 1]);
  assert.strictEqual(order[0], 'knowledge_base',
    'deleting the users first orphans KB rows beyond the reach of this scope, permanently');
  assert.strictEqual(order[1], 'profiles',
    'the vestigial profiles row has a NO ACTION FK that BLOCKS the auth delete');
  assert.ok(order.indexOf('deleteUser') > 1, 'the auth row goes last — everything else cascades from it');
});

test('⚠ GLOBAL KB ROWS ARE KEPT — they are shared material others are graded against', async () => {
  const a = fakeAdmin();
  await purge.purgeUsers(a, ['u1']);
  const kb = a._log.filter((e) => e.table === 'knowledge_base' && e.col === 'scope')[0];
  assert.ok(kb, 'the scope filter must be applied');
  assert.deepStrictEqual(kb.vals.slice().sort(), ['personal', 'team'],
    'global must NOT be in the delete set');
});

test('one failure is REPORTED, not thrown — the rest must not be abandoned half-done', async () => {
  const a = fakeAdmin({ failFor: 'u2' });
  const r = await purge.purgeUsers(a, ['u1', 'u2', 'u3']);
  assert.deepStrictEqual(r.deleted, ['u1', 'u3']);
  assert.strictEqual(r.failed.length, 1);
  assert.strictEqual(r.failed[0].user_id, 'u2');
});

test('an empty set touches nothing — a bad caller must not delete by accident', async () => {
  const a = fakeAdmin();
  const r = await purge.purgeUsers(a, []);
  assert.strictEqual(a._log.length, 0, 'no query may run for an empty id list');
  assert.deepStrictEqual(r, { deleted: [], failed: [], kb_rows_deleted: 0 });
});

test('⚠⚠ BOTH ROUTES CALL IT — neither may keep its own copy', () => {
  const live = ADMIN_SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const calls = (live.match(/purgeUsers\(/g) || []).length;
  assert.strictEqual(calls, 2, 'exactly two callers: the company delete and the user delete');
  // The company route's inline copy must be gone, not merely unused beside it.
  assert.strictEqual(/auth\.admin\.deleteUser\(ids\[i\]\)/.test(live), false,
    'a second inline copy of the loop would drift from the shared one');
});

test('⚠⚠ THE DESTRUCTIVE DOOR IS BEHIND THE ADMIN ROLE, SERVER-SIDE', () => {
  /* Justin: "we have deactivate as the safeguard and it's why only admins can
     actually delete people." The safeguard is not the dialog and not a
     recoverable copy — it is the role check, and it must be enforced HERE
     rather than by hiding a button. A hidden control is a suggestion. */
  const at = ADMIN_SRC.indexOf("router.delete('/users/:user_id'");
  assert.ok(at !== -1, 'stale anchor');
  const head = ADMIN_SRC.slice(at, at + 200);
  assert.ok(/requireAuth/.test(head) && /requireRole\('owner'\)/.test(head),
    'the delete route must be owner-gated on the server');
  const at2 = ADMIN_SRC.indexOf("router.delete('/companies/:head_id'");
  assert.ok(/requireRole\('owner'\)/.test(ADMIN_SRC.slice(at2, at2 + 200)), 'and so must the company delete');
});
