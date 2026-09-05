/**
 * H734 — DOCTRINE IS INVISIBLE INFRASTRUCTURE (Justin, 2026-09-05): never a search result, always read by
 * the lanes. The JS predicate is EXECUTED on a doctrine row for the three scopes; the SQL conjunct is pinned
 * in migration 072 beside the unchanged visibility clause; the lanes' retrieval is executed on a fake wire
 * and still receives all eleven units.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { kbReadRowVisible, KB_VISIBILITY_SQL, KB_HIDDEN_FROM_SEARCH_SQL, hiddenFromSearch } = require('../lib/kb-scope');
const D = require('../lib/doctrine');

const DOC = { id: 'd1', category: 'doctrine', scope: 'global', uploaded_by: null, team_owner_id: null, label: 'Isolation is the correct first move' };
const SCOPES = { owner: { p_user_id: 'o', p_admin_id: 'o' }, head: { p_user_id: 'h', p_admin_id: 'h' }, rep: { p_user_id: 'r', p_admin_id: 'h' }, nobody: null };

test('⚠⚠ the JS predicate refuses a doctrine row for every scope — and still admits a global upload and a team row (not a vacuous refusal)', () => {
  Object.keys(SCOPES).forEach((k) => assert.strictEqual(kbReadRowVisible(DOC, SCOPES[k]), false, 'doctrine visible to ' + k));
  assert.strictEqual(kbReadRowVisible({ id: 'g', category: 'user_upload', scope: 'global', uploaded_by: 'o' }, SCOPES.rep), true, 'a global upload stays visible');
  assert.strictEqual(kbReadRowVisible({ id: 't', category: 'user_upload', scope: 'team', uploaded_by: 'h', team_owner_id: 'h' }, SCOPES.rep), true, 'the team row stays visible');
  assert.ok(hiddenFromSearch(DOC) && !hiddenFromSearch({ category: 'user_upload', uploaded_by: null }));
});
test('⚠⚠ migration 072 carries the conjunct BEFORE the unchanged visibility clause, and the JS constant mirrors it verbatim', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '072_doctrine_invisible_to_search.sql'), 'utf8');
  assert.ok(sql.includes(KB_HIDDEN_FROM_SEARCH_SQL), 'the conjunct text in the migration is the JS constant');
  assert.ok(sql.includes(KB_VISIBILITY_SQL), 'the visibility clause is unchanged (the 029 mirror still holds)');
  assert.ok(sql.indexOf(KB_HIDDEN_FROM_SEARCH_SQL) < sql.indexOf(KB_VISIBILITY_SQL), 'the conjunct sits before the OR block, as an AND');
  assert.ok(/AND kb\.category IS DISTINCT FROM 'doctrine'\n\s+AND \(/.test(sql), 'as a conjunct of the WHERE, not inside the OR');
});
test('⚠⚠ invisible to users, never to the lanes: the retrieval still returns all eleven units', async () => {
  const rows = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
  const fake = { from(t) { const ch = { f: {}, select() { return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, order() { return ch; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: (t === 'knowledge_base' && ch.f.category === 'doctrine') ? rows : [], error: null }).then(res, rej); } }; return ch; } };
  const d = await D.loadDoctrine(fake);
  assert.strictEqual(d.units.length, 11);
  assert.strictEqual(rows.filter((r) => kbReadRowVisible(r, SCOPES.rep)).length, 0, 'the same eleven rows are invisible to the search predicate');
  assert.ok(D.doctrineBlock(d, 'coaching').indexOf('Isolation is the correct first move') !== -1, 'and reach a lane prompt');
});
