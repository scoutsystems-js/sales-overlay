/**
 * THE SPLITTING PASS (H702) — the guard Justin asked for: plant a one-word prospect
 * with two surnames and assert two prospects come out; plant a company-name title
 * and assert NO split. Plus the silences, and the apply/undo executed against a
 * fake admin (call kept + effect dropped is the plant that must fail).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { planSplits, applySplits, undoSplits, surnameOf } = require('../lib/prospect-split');

const U = 'user-josh';
const P = { id: 'p-anthony', user_id: U, display_name: 'Anthony' };
const call = (id, title, pid) => ({ id, user_id: U, prospect_id: pid || P.id, title });

test('a one-word prospect with two title surnames splits into two prospects', () => {
  const plan = planSplits({ prospects: [P], calls: [
    call('c1', 'IH - Sober Living Riches | Anthony Ehikhamhen'),
    call('c2', 'JH  Sober Living Riches | Anthony  Simmons'),
    call('c3', 'PS Sober Living Riches | Anthony Ehikhamhen'),
  ] });
  assert.strictEqual(plan.prospects_split, 1);
  assert.strictEqual(plan.moves.length, 3, 'every eligible call moves');
  const targets = new Set(plan.moves.map(m => m.to_name_key));
  assert.deepStrictEqual([...targets].sort(), ['anthony ehikhamhen', 'anthony simmons'], 'two prospects come out');
  assert.strictEqual(plan.moves.find(m => m.call_id === 'c2').to_display_name, 'Anthony Simmons', 'whitespace collapsed');
  plan.moves.forEach(m => {
    assert.strictEqual(m.from_prospect_id, P.id);
    assert.strictEqual(m.reason.rule, 'one_word_prospect_two_title_surnames');
    assert.ok(m.reason.title && m.reason.surname && m.reason.first_token === 'Anthony');
  });
});

test('a company-name title produces NO split, and neither does a first-name mismatch', () => {
  const plan = planSplits({ prospects: [P], calls: [
    call('c1', 'PS Sober Living Riches | Anthony Ehikhamhen'),
    call('c2', 'Check up With Dre | Sober Living Riches'),        // the company in the slot
    call('c3', 'PS Sober Living Riches | Carrie Banks Wright'),   // another person's title on this prospect
  ] });
  assert.strictEqual(plan.moves.length, 0, 'one usable surname is not a collision');
  assert.strictEqual(plan.prospects_split, 0);
  assert.strictEqual(plan.skipped.first_token_mismatch, 2, 'the company name and the wrong-person title both fail the first-token test');
  assert.strictEqual(plan.skipped.one_surname, 1);
});

test('untitled calls stay where they are; a two-word prospect is never a candidate; one surname never splits', () => {
  const plan = planSplits({ prospects: [P, { id: 'p-full', user_id: U, display_name: 'Anthony Hall' }], calls: [
    call('c1', 'PS Sober Living Riches | Anthony Ehikhamhen'),
    call('c2', 'PS Sober Living Riches | Anthony Simmons'),
    call('c3', 'Impromptu Zoom Meeting'),
    call('c4', "Anthony's Personal Meeting Room"),
    call('c5', 'PS Sober Living Riches | Anthony Hall', 'p-full'),
    call('c6', 'PS Sober Living Riches | Anthony Davis', 'p-full'),
  ] });
  assert.deepStrictEqual(plan.moves.map(m => m.call_id).sort(), ['c1', 'c2']);
  assert.strictEqual(plan.skipped.untitled, 2, 'c3 and c4 stay — untitled');
  assert.strictEqual(plan.moves.some(m => m.from_prospect_id === 'p-full'), false, 'a full-name prospect is never split even with disagreeing titles');
});

test('the digit / email / device silences and the suffix rule', () => {
  const plan = planSplits({ prospects: [P], calls: [
    call('c1', 'PS Sober Living Riches | Anthony Ehikhamhen'),
    call('c2', 'PS Sober Living Riches | Anthony 5551234'),
    call('c3', "PS Sober Living Riches | Anthony's iPhone"),
    call('c4', 'PS Sober Living Riches | anthony@example.com'),
  ] });
  assert.strictEqual(plan.moves.length, 0);
  assert.strictEqual(plan.skipped.unusable_segment, 3);
  assert.strictEqual(surnameOf(['Mathew', 'A', 'Penov', 'Jr']), 'penov');
  assert.strictEqual(surnameOf(['Keen-Yah', 'E.', 'Bostic']), 'bostic');
});

/* ── apply / undo, EXECUTED against a fake admin ───────────────────────────── */
function fakeAdmin() {
  const log = [];
  const prospects = [];
  const builder = (table, op, payload) => {
    const rec = { table, op, payload, filters: [] };
    const b = {
      eq(k, v) { rec.filters.push([k, v]); return b; },
      select() { return b; },
      maybeSingle() {
        if (table === 'prospects' && op === 'select') {
          const uid = rec.filters.find(f => f[0] === 'user_id')[1], key = rec.filters.find(f => f[0] === 'name_key')[1];
          const hit = prospects.find(p => p.user_id === uid && p.name_key === key);
          return Promise.resolve({ data: hit ? { id: hit.id } : null, error: null });
        }
        if (table === 'prospects' && op === 'insert') {
          const id = 'np-' + (prospects.length + 1); prospects.push(Object.assign({ id }, payload)); log.push(rec);
          return Promise.resolve({ data: { id }, error: null });
        }
        if (table === 'prospect_splits' && op === 'select') return Promise.resolve({ data: log.filter(r => r.table === 'prospect_splits' && r.op === 'insert').map((r, i) => Object.assign({ id: 'split-' + (i + 1), undone_at: null }, r.payload)).find(r => r.id === rec.filters[0][1]) || null, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(res) { log.push(rec); return Promise.resolve({ error: null }).then(res); },
    };
    return b;
  };
  return { log, prospects, from(table) { return {
    select: () => builder(table, 'select'),
    insert: (p) => builder(table, 'insert', p),
    update: (p) => builder(table, 'update', p),
  }; } };
}

test('applySplits (EXECUTED): creates the target prospect once per key, repoints each call scoped by id AND user_id, records a split row', async () => {
  const admin = fakeAdmin();
  const plan = planSplits({ prospects: [P], calls: [
    call('c1', 'PS Sober Living Riches | Anthony Ehikhamhen'),
    call('c2', 'PS Sober Living Riches | Anthony Simmons'),
    call('c3', 'IH Sober Living Riches | Anthony Ehikhamhen'),
  ] });
  const out = await applySplits(admin, plan.moves);
  assert.deepStrictEqual(out, { moved: 3, prospects_created: 2, failed: 0 });
  const updates = admin.log.filter(r => r.table === 'fathom_calls' && r.op === 'update');
  assert.strictEqual(updates.length, 3);
  updates.forEach(u => {
    assert.ok(u.payload.prospect_id && u.payload.prospect_id.startsWith('np-'), 'repointed to the new prospect');
    assert.deepStrictEqual(u.filters.map(f => f[0]), ['id', 'user_id'], 'scoped by id AND user_id');
  });
  const c1 = updates.find(u => u.filters[0][1] === 'c1').payload.prospect_id, c3 = updates.find(u => u.filters[0][1] === 'c3').payload.prospect_id;
  assert.strictEqual(c1, c3, 'same surname → same prospect');
  const rows = admin.log.filter(r => r.table === 'prospect_splits' && r.op === 'insert');
  assert.strictEqual(rows.length, 3, 'one reversal row per move');
  rows.forEach(r => { assert.strictEqual(r.payload.from_prospect_id, P.id); assert.ok(r.payload.to_prospect_id && r.payload.reason.title); });
});

test('undoSplits (EXECUTED): puts the call back on from_prospect_id and stamps undone_at', async () => {
  const admin = fakeAdmin();
  const plan = planSplits({ prospects: [P], calls: [
    call('c1', 'PS Sober Living Riches | Anthony Ehikhamhen'),
    call('c2', 'PS Sober Living Riches | Anthony Simmons'),
  ] });
  await applySplits(admin, plan.moves);
  const out = await undoSplits(admin, ['split-1']);
  assert.deepStrictEqual(out, { undone: 1, failed: 0 });
  const back = admin.log.filter(r => r.table === 'fathom_calls' && r.op === 'update').pop();
  assert.deepStrictEqual(back.payload, { prospect_id: P.id });
  assert.deepStrictEqual(back.filters, [['id', 'c1'], ['user_id', U]]);
  const stamp = admin.log.filter(r => r.table === 'prospect_splits' && r.op === 'update').pop();
  assert.ok(stamp && stamp.payload.undone_at);
});
