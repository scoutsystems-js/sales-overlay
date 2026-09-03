/**
 * PROSPECT RENAME THAT CARRIES EVERYWHERE (H707): a human name on the PROSPECT wins over
 * the grader and reaches every call on the row; a rename onto an existing name is a MERGE,
 * confirmed naming both, never silent; a call a person renamed differently is never
 * touched; every rename is a row; the human path sits above the exact path in linking;
 * the EOD name field is this rename, not a second store.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');
const { stripComments } = require('./helpers/strip-comments');
const { planRename, cleanName } = require('../lib/prospect-rename');
const { chooseLink, PATHS } = require('../lib/prospect-link');
const { deriveCallKind } = require('../lib/call-kind');

const P = { id: 'p-anthony', display_name: 'Anthony', name_key: 'anthony' };
const EXISTING = [P, { id: 'p-davis', display_name: 'Anthony Davis', name_key: 'anthony davis' }];

test('planRename: a plain rename renames the row and moves every call; a name already in use is a MERGE naming the target', () => {
  const r = planRename({ name: 'Anthony  Hall', prospect: P, existing: EXISTING, calls: [{ id: 'c1' }, { id: 'c2' }] });
  assert.deepStrictEqual(r, { ok: true, kind: 'rename', name: 'Anthony Hall', name_key: 'anthony hall', into: null, move: ['c1', 'c2'], skip: [] });
  const m = planRename({ name: 'anthony davis', prospect: P, existing: EXISTING, calls: [{ id: 'c1' }] });
  assert.strictEqual(m.kind, 'merge'); assert.deepStrictEqual(m.into, { id: 'p-davis', display_name: 'Anthony Davis' });
  assert.strictEqual(planRename({ name: 'Anthony', prospect: P, existing: EXISTING, calls: [] }).kind, 'rename', 'renaming to its own name is not a merge');
});

test('planRename: a call a person already renamed DIFFERENTLY is skipped; one renamed to the same name moves; no prospect → create', () => {
  const r = planRename({ name: 'Anthony Hall', prospect: P, existing: EXISTING, calls: [{ id: 'c1', human_name: 'Anthony Simmons' }, { id: 'c2', human_name: 'anthony hall' }, { id: 'c3' }] });
  assert.deepStrictEqual(r.skip, ['c1']); assert.deepStrictEqual(r.move, ['c2', 'c3']);
  assert.strictEqual(planRename({ name: 'Nancy Kaur', prospect: null, existing: EXISTING, calls: [] }).kind, 'create');
});

test('silence: a device, a placeholder, an email, an empty string are not names', () => {
  ['iPhone', 'Crystal NoLastname', 'a@b.com', '   ', 'Impromptu Zoom Meeting'].forEach((n) => assert.strictEqual(planRename({ name: n, prospect: P, existing: [], calls: [] }).ok, false, n));
  assert.strictEqual(cleanName('  Todd   Erickson '), 'Todd Erickson');
});

test('⚠⚠ the HUMAN PATH sits above the exact path in linking, and a human-named link is a linked call for the follow-up flag', () => {
  const l = chooseLink({ humanName: 'Mary Smith', resolvedName: 'John', invitees: [{ name: 'John Smith', email: 'j@x.com', is_external: true }], source: 'fathom' });
  assert.deepStrictEqual(l, { path: PATHS.HUMAN, email: null, display_name: 'Mary Smith', name_key: 'mary smith' });
  assert.strictEqual(deriveCallKind({ linkPath: 'human', prospectId: 'p', callDate: '2026-09-02T00:00:00Z', earlierCalls: [{ id: 'e', call_date: '2026-08-01T00:00:00Z', call_kind: 'booked' }] }).call_kind, 'follow_up');
});

test('⚠⚠ the worker keeps a human name over the grader on re-analysis, and feeds it to the human path', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'));
  assert.ok(/prospect_name_source === 'manual'/.test(src) && /if \(humanNamed\) resolvedProspect = \{ name: existingRow\.data\.prospect_name, source: 'manual'/.test(src), 'a manual name is kept');
  assert.ok(/humanName:\s*humanNamed \? resolvedProspect\.name : null/.test(src), 'and passed to chooseLink');
  const eod = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'eod.js'), 'utf8'));
  assert.ok(/if \(field === 'prospect_name'\) \{[\s\S]{0,600}renameOnCall\(admin/.test(eod), 'the EOD name field routes through the rename');
  assert.ok(/delete edByCall\[c\.id\]\.prospect_name/.test(eod), 'a stale eod_edits name never overlays the rename');
});

/* ── the route, EXECUTED over HTTP with a forged actor ─────────────────────── */
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); } });
const PROFILES = { josh: { user_id: 'josh', role: 'user', managed_by: 'mgr' }, stranger: { user_id: 'stranger', role: 'user', managed_by: 'other' }, mgr: { user_id: 'mgr', role: 'manager', managed_by: null } };
function world() {
  const calls = { 'c-1': { id: 'c-1', user_id: 'josh', prospect_id: 'p-anthony' }, 'c-2': { id: 'c-2', user_id: 'josh', prospect_id: 'p-anthony' } };
  const prospects = { 'p-anthony': { id: 'p-anthony', user_id: 'josh', display_name: 'Anthony', name_key: 'anthony', merged_into: null }, 'p-davis': { id: 'p-davis', user_id: 'josh', display_name: 'Anthony Davis', name_key: 'anthony davis', merged_into: null } };
  const analyses = { 'c-1': { fathom_call_id: 'c-1', prospect_name: 'Anthony' }, 'c-2': { fathom_call_id: 'c-2', prospect_name: 'Anthony' } };
  const renames = [];
  const admin = { from(table) {
    const ch = { f: {}, isNull: {}, _p: null, _op: 'select',
      select() { return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; }, insert(p) { ch._op = 'insert'; ch._p = p; return ch; },
      eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch.f[k] = v; return ch; }, is(k, v) { ch.isNull[k] = v; return ch; }, order() { return ch; },
      maybeSingle() { return ch.then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res) {
        let rows = [];
        if (table === 'fathom_calls') { rows = Object.values(calls).filter((c) => (!ch.f.id || c.id === ch.f.id) && (!ch.f.user_id || c.user_id === ch.f.user_id) && (!ch.f.prospect_id || c.prospect_id === ch.f.prospect_id)); if (ch._op === 'update') rows.forEach((c) => Object.assign(c, ch._p)); }
        else if (table === 'prospects') { rows = Object.values(prospects).filter((p) => (!ch.f.id || p.id === ch.f.id) && (!ch.f.user_id || p.user_id === ch.f.user_id) && (!('merged_into' in ch.isNull) || p.merged_into === null)); if (ch._op === 'update') rows.forEach((p) => Object.assign(p, ch._p)); if (ch._op === 'insert') { const id = 'p-new-' + (Object.keys(prospects).length + 1); prospects[id] = Object.assign({ id }, ch._p); rows = [{ id }]; } }
        else if (table === 'call_analyses') { rows = Object.values(analyses).filter((a) => a.fathom_call_id === ch.f.fathom_call_id); if (ch._op === 'update') rows.forEach((a) => Object.assign(a, ch._p)); }
        else if (table === 'user_profiles') { rows = (ch.f.user_id || []).map((id) => PROFILES[id]).filter(Boolean); }
        else if (table === 'prospect_renames') { if (ch._op === 'insert') { renames.push(ch._p); rows = [ch._p]; } else rows = renames.filter((r) => r.prospect_id === ch.f.prospect_id); }
        return Promise.resolve({ data: rows, error: null }).then(res);
      } };
    return ch;
  } };
  return { admin, calls, prospects, analyses, renames };
}
function appFor(actorId, w) {
  const me = require('../routes/me'); if (me._setAdminClientForTests) me._setAdminClientForTests(() => w.admin);
  const app = express(); app.use(express.json());
  app.use(function (req, _res, next) { req.user = { id: actorId }; req.userProfileRole = (PROFILES[actorId] || {}).role || 'user'; next(); });
  app.use('/me', me); return app;
}
function post(app, p, body) { return new Promise((resolve, reject) => { const server = http.createServer(app).listen(0, () => { const payload = JSON.stringify(body);
  const req = http.request({ port: server.address().port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', () => { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); });
  req.on('error', (e) => { server.close(); reject(e); }); req.end(payload); }); }); }

test('⚠⚠ OVER HTTP: a stranger is refused; the closer renames their own prospect and it reaches every call on the row, with a rename row', async () => {
  const w = world();
  assert.strictEqual((await post(appFor('stranger', w), '/me/calls/c-1/prospect-name', { name: 'Anthony Hall' })).status, 403);
  assert.strictEqual(w.renames.length, 0, 'no row on refusal');
  const r = await post(appFor('josh', w), '/me/calls/c-1/prospect-name', { name: 'Anthony Hall' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(w.prospects['p-anthony'].display_name, 'Anthony Hall'); assert.strictEqual(w.prospects['p-anthony'].human_name_by, 'josh');
  assert.strictEqual(w.analyses['c-1'].prospect_name, 'Anthony Hall'); assert.strictEqual(w.analyses['c-2'].prospect_name, 'Anthony Hall', 'carries to the other call on the row');
  assert.strictEqual(w.analyses['c-2'].prospect_name_source, 'manual');
  assert.strictEqual(w.calls['c-2'].prospect_link_path, 'human');
  assert.deepStrictEqual({ from: w.renames[0].from_display_name, to: w.renames[0].to_display_name, by: w.renames[0].actor_id, moved: w.renames[0].calls_moved }, { from: 'Anthony', to: 'Anthony Hall', by: 'josh', moved: 2 });
});

test('⚠⚠ OVER HTTP: a rename onto an existing name is a MERGE — 409 naming both, nothing written; confirmed, the calls move and the old row is merged away', async () => {
  const w = world();
  const first = await post(appFor('mgr', w), '/me/calls/c-1/prospect-name', { name: 'Anthony Davis' });
  assert.strictEqual(first.status, 409, JSON.stringify(first.body));
  assert.deepStrictEqual(first.body.merge_required, { from: 'Anthony', into: 'Anthony Davis', calls_moving: 2, calls_skipped: 0 });
  assert.strictEqual(w.calls['c-1'].prospect_id, 'p-anthony', 'nothing moved without confirmation');
  const second = await post(appFor('mgr', w), '/me/calls/c-1/prospect-name', { name: 'Anthony Davis', confirm_merge: true });
  assert.strictEqual(second.status, 200, JSON.stringify(second.body));
  assert.strictEqual(w.calls['c-1'].prospect_id, 'p-davis'); assert.strictEqual(w.calls['c-2'].prospect_id, 'p-davis');
  assert.strictEqual(w.prospects['p-anthony'].merged_into, 'p-davis', 'the old row is merged away, not deleted');
  assert.strictEqual(w.renames[0].merged_into, 'p-davis');
});
