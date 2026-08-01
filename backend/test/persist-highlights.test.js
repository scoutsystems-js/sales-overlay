// House rule (data-loss prevention): a call's existing highlights are deleted
// ONLY AFTER the new set is successfully inserted, so a failed/empty extraction
// never wipes them. This tests persistHighlights' ordering against a fake admin
// that records the operation sequence.
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');
const persistHighlights = worker._persistHighlights;

// Fake supabase chain that records ops in order and lets each op's result be
// scripted. .from('call_highlights') → { select().eq(), insert(), delete().in() }.
function makeAdmin(script) {
  const ops = [];
  script = script || {};
  return {
    ops,
    from(table) {
      return {
        select() {
          return { eq() { ops.push('select'); return Promise.resolve(script.select || { data: [], error: null }); } };
        },
        insert(rows) {
          ops.push('insert:' + rows.length);
          return Promise.resolve(script.insert || { error: null });
        },
        delete() {
          return { in(col, ids) { ops.push('delete:' + ids.length); return Promise.resolve(script.delete || { error: null }); } };
        },
      };
    },
  };
}

const NEW2 = [{ timestamp_seconds: 1, sequence_order: 1 }, { timestamp_seconds: 2, sequence_order: 2 }];

test('EMPTY extract → no select/insert/delete; existing highlights preserved', async () => {
  const admin = makeAdmin();
  const r = await persistHighlights(admin, 'call-1', 'user-1', []);
  assert.deepStrictEqual(admin.ops, []);           // nothing touched
  assert.strictEqual(r.kept_existing, true);
  assert.strictEqual(r.inserted, 0);
});

test('SUCCESS path → insert happens BEFORE delete, and delete targets the old ids', async () => {
  const admin = makeAdmin({ select: { data: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], error: null } });
  const r = await persistHighlights(admin, 'call-1', 'user-1', NEW2);
  assert.deepStrictEqual(admin.ops, ['select', 'insert:2', 'delete:3']); // ORDER: insert before delete
  assert.strictEqual(r.inserted, 2);
  assert.strictEqual(r.deleted, 3);
  assert.strictEqual(r.kept_existing, false);
});

test('INSERT FAILS → delete is NEVER called; existing highlights preserved', async () => {
  const admin = makeAdmin({
    select: { data: [{ id: 'o1' }], error: null },
    insert: { error: { message: 'network hiccup' } },
  });
  const r = await persistHighlights(admin, 'call-1', 'user-1', NEW2);
  assert.deepStrictEqual(admin.ops, ['select', 'insert:2']); // NO delete
  assert.ok(admin.ops.indexOf('delete:1') === -1);
  assert.strictEqual(r.kept_existing, true);
  assert.strictEqual(r.deleted, 0);
});

test('no prior highlights → insert only, no delete', async () => {
  const admin = makeAdmin({ select: { data: [], error: null } });
  const r = await persistHighlights(admin, 'call-1', 'user-1', NEW2);
  assert.deepStrictEqual(admin.ops, ['select', 'insert:2']); // nothing old to delete
  assert.strictEqual(r.inserted, 2);
  assert.strictEqual(r.deleted, 0);
});

test('delete-old fails AFTER a successful insert → new set is saved (never a wipe)', async () => {
  const admin = makeAdmin({
    select: { data: [{ id: 'o1' }], error: null },
    delete: { error: { message: 'cleanup failed' } },
  });
  const r = await persistHighlights(admin, 'call-1', 'user-1', NEW2);
  assert.deepStrictEqual(admin.ops, ['select', 'insert:2', 'delete:1']);
  assert.strictEqual(r.inserted, 2);   // new set is in
  assert.strictEqual(r.deleted, 0);    // old cleanup failed (dupes self-heal next run) — but no data lost
  assert.strictEqual(r.kept_existing, false);
});
