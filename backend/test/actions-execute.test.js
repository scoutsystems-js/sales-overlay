/**
 * H739 — THE CLOSER'S WRITES CANNOT FAIL SILENTLY: every Tier 1 action route is EXECUTED on a fake wire that records
 * its writes, and the CONSEQUENCE is asserted — the outcome stored, the name written, the mark set, the password
 * updated, the ticket inserted — never only a status. The Supabase package is stubbed at the module edge (the auth,
 * fathom, zoom and support routers build their own client); the model seam and the embedding provider are stubbed.
 * Each guard is kept only after its plant (a require the route needs, removed) made it fail.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('stream');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
process.env.VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || 'test-voyage';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test-resend';
/* the email provider is stubbed at the network edge: a reset link's send is a fetch to Resend */
const SENT = []; const realFetch = global.fetch;
global.fetch = async (url, opts) => { if (/resend\.com/.test(String(url))) { SENT.push({ url: String(url), body: opts && opts.body }); return { ok: true, status: 200, json: async () => ({ id: 'email-1' }), text: async () => '{}' }; } return realFetch(url, opts); };
const muPath = require.resolve('../lib/model-usage'); const realMu = require(muPath);
require.cache[muPath].exports = Object.assign({}, realMu, { createWithUsage: async () => ({ content: [{ text: '{}' }] }), usageFor: () => async () => ({ content: [{ text: '{}' }] }), setUsageRecorder() {} });
const voyPath = require.resolve('../lib/voyage'); const realVoy = require(voyPath);
require.cache[voyPath].exports = Object.assign({}, realVoy, { getVoyageEmbedding: async () => new Array(512).fill(0.01), getVoyageEmbeddings: async (texts) => texts.map(() => new Array(512).fill(0.01)), embeddingCapability: () => ({ ok: true }) });
const D = require('../lib/doctrine');
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
const REP = { user_id: 'rep', role: 'user', managed_by: 'mgr', first_name: 'Ava', last_name: 'Reyes', active: true };
const MGR = { user_id: 'mgr', role: 'manager', managed_by: null, first_name: 'Mia', last_name: 'M', team_name: 'SLR', active: true };
function rows() { return {
  user_profiles: [REP, MGR],
  fathom_calls: [{ id: 'c1', fathom_call_id: 'c1', user_id: 'rep', title: 'AF | Someone', call_date: '2026-08-20T10:00:00Z', not_a_sales_call: false, duplicate_of: null, prospect_id: 'p1', prospect_name: 'Old Name', call_kind: null, call_kind_marked_by: null, not_sales_marked_by: null, source: 'fathom' }],
  call_analyses: [{ id: 'a1', fathom_call_id: 'c1', user_id: 'rep', status: 'done', outcome: 'lost', outcome_source: 'analysis', close_score: 60, close_score_earned: 60, prospect_name: 'Old Name', prospect_name_source: 'grader', analyzed_at: '2026-08-20T11:00:00Z' }],
  call_highlights: [], prospects: [{ id: 'p1', user_id: 'rep', display_name: 'Old Name', email: null }], prospect_renames: [],
  fathom_connections: [{ user_id: 'rep', access_token: 't', refresh_token: 'r', fathom_email: null, last_sync_at: null, sync_window: null }],
  call_connections: [], knowledge_base: DOCTRINE_ROWS.concat([{ id: 'kb1', source_label: 'My Offer.pdf', category: 'user_upload', uploaded_by: 'mgr', scope: 'team', team_owner_id: 'mgr', metadata: { category: 'offer_document' } }]),
  support_tickets: [], eod_edits: [],
}; }
let STORE = rows(); const WRITES = []; const AUTHCALLS = [];
function fakeAdmin() {
  const store = new Proxy({}, { get: (_, k) => STORE[k], set: (_, k, v) => { STORE[k] = v; return true; }, has: (_, k) => k in STORE, ownKeys: () => Reflect.ownKeys(STORE), getOwnPropertyDescriptor: (_, k) => Object.getOwnPropertyDescriptor(STORE, k) });
  const writes = WRITES;
  const build = (table, f, op, payload) => { f = f || {}; const match = (r) => Object.keys(f).every((k) => !(k in r) || r[k] === f[k]);
    const data = () => (table === 'knowledge_base' && f.category === 'doctrine') ? DOCTRINE_ROWS : (store[table] || []).filter(match);
    const perform = () => { let out = { data: data(), error: null, count: data().length };
        if (op === 'update') { const hit = data(); hit.forEach((r) => Object.assign(r, payload)); writes.push({ table, op, patch: payload, f }); out = { data: hit, error: null, count: hit.length }; }
        else if (op === 'insert' || op === 'upsert') { const arr = Array.isArray(payload) ? payload : [payload]; const made = arr.map((r, i) => Object.assign({ id: table + '-new-' + (writes.length + i), created_at: new Date().toISOString() }, r)); (store[table] = store[table] || []).push(...made); writes.push({ table, op, rows: arr, f }); out = { data: made, error: null, count: made.length }; }
        else if (op === 'delete') { const hit = data(); store[table] = (store[table] || []).filter((r) => !match(r)); writes.push({ table, op, f, n: hit.length }); out = { data: hit, error: null, count: hit.length }; }
        return out; };
    const target = {
      maybeSingle: () => { const o = perform(); return Promise.resolve({ data: (o.data && o.data[0]) || null, error: null }); },
      single: () => { const o = perform(); return Promise.resolve({ data: (o.data && o.data[0]) || null, error: null }); },
      eq: (k, v) => build(table, Object.assign({}, f, { [k]: v }), op, payload),
      update: (p) => build(table, f, 'update', p), insert: (p) => build(table, f, 'insert', p), upsert: (p) => build(table, f, 'upsert', p), delete: () => build(table, f, 'delete', null),
      select: () => build(table, f, op, payload),
      then: (res, rej) => Promise.resolve(perform()).then(res, rej) };
    return new Proxy(target, { get(t, prop) { if (prop in t) return t[prop]; if (typeof prop === 'symbol') return undefined; return () => build(table, f, op, payload); } }); };
  const authCalls = AUTHCALLS;
  return { writes, authCalls, from: (t) => build(t), rpc: async () => ({ data: [{ id: 'kb1', category: 'user_upload', label: 'My Offer', content: 'text', triggers: [], metadata: {}, similarity: 0.9, uploaded_by: 'mgr', scope: 'team', team_owner_id: 'mgr' }], error: null }),
    auth: { getUser: async () => ({ data: { user: { id: 'rep', email: 'ava@x' } }, error: null }), signInWithPassword: async (p) => { authCalls.push(['signIn', p]); return { data: { user: { id: 'rep' } }, error: null }; },
      admin: { updateUserById: async (id, p) => { authCalls.push(['updateUserById', id, p]); return { data: { user: { id } }, error: null }; }, generateLink: async (p) => { authCalls.push(['generateLink', p]); return { data: { properties: { action_link: 'https://www.scoutsystems.io/set-password#access_token=abc&type=recovery' } }, error: null }; }, listUsers: async () => ({ data: { users: [{ id: 'rep', email: 'ava@x' }, { id: 'mgr', email: 'm@x' }] } }), getUserById: async () => ({ data: { user: { id: 'rep', email: 'ava@x' } }, error: null }) } },
    storage: { from: () => ({ upload: async (p, buf, o) => { writes.push({ table: 'storage', op: 'upload', path: p, bytes: buf.length, contentType: o && o.contentType }); return { data: { path: p }, error: null }; } }) } };
}
let current = null;
const sbPath = require.resolve('@supabase/supabase-js'); const savedSb = require.cache[sbPath];
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { createClient: () => current } };
const rsPath = (() => { try { return require.resolve('../lib/welcome-email'); } catch (e) { return null; } })();
['../routes/auth', '../routes/fathom', '../routes/eod', '../routes/kb', '../routes/me', '../routes/zoom', '../routes/support', '../lib/email-map'].forEach((m) => { try { delete require.cache[require.resolve(m)]; } catch (e) {} });
const R = { auth: require('../routes/auth'), fathom: require('../routes/fathom'), kb: require('../routes/kb'), me: require('../routes/me'), zoom: require('../routes/zoom'), support: require('../routes/support') };
function fresh() { STORE = rows(); WRITES.length = 0; AUTHCALLS.length = 0; current = fakeAdmin(); if (R.kb._setAdminClientForTests) R.kb._setAdminClientForTests(() => current); if (R.me._setAdminClientForTests) R.me._setAdminClientForTests(() => current); return current; }
function call(router, method, path, req) {
  const l = router.stack.find((x) => x.route && x.route.path === path && x.route.methods[method]);
  if (!l) return Promise.resolve({ code: 'no-route', body: path });
  const handler = l.route.stack[l.route.stack.length - 1].handle;
  return new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, setHeader() { return this; }, json(b) { resolve({ code: this.code, body: b }); }, send(b) { resolve({ code: this.code, body: b }); }, end() { resolve({ code: this.code, body: null }); } };
    const base = { user: { id: 'rep', email: 'ava@x' }, query: {}, params: {}, body: {}, headers: {}, get() { return ''; } };
    Promise.resolve().then(() => handler(Object.assign(base, req || {}), res, (e) => resolve({ code: 'next', body: String(e) }))).catch((e) => resolve({ code: 'threw', body: String(e && e.stack) })); });
}
const DEBUG = !!process.env.ACTIONS_DEBUG;
function dbg(name, r, admin) { if (DEBUG) console.log(name, r.code, JSON.stringify(r.body).slice(0, 160), '| writes:', JSON.stringify(admin.writes).slice(0, 220), '| auth:', JSON.stringify(admin.authCalls).slice(0, 120)); }

test('tagging an outcome stores it as manual on the analysis row', async () => {
  const a = fresh(); const r = await call(R.me, 'patch', '/calls/:call_id/outcome', { user: { id: 'mgr', email: 'm@x' }, params: { call_id: 'c1' }, body: { outcome: 'closed' } }); dbg('outcome', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  const w = a.writes.find((x) => x.table === 'call_analyses' && x.op === 'update');
  assert.ok(w && w.patch.outcome === 'closed' && w.patch.outcome_source === 'manual' && w.f.fathom_call_id === 'c1', 'the outcome is STORED, manual, on that call: ' + JSON.stringify(a.writes));
});
test('renaming a prospect writes the name and records the rename', async () => {
  const a = fresh(); const r = await call(R.me, 'post', '/calls/:id/prospect-name', { params: { id: 'c1' }, body: { name: 'New Name' } }); dbg('rename', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.writes.some((x) => x.op === 'update' && x.patch && (x.patch.prospect_name === 'New Name' || x.patch.display_name === 'New Name')), 'the name is WRITTEN: ' + JSON.stringify(a.writes));
  assert.ok(a.writes.some((x) => x.table === 'prospect_renames' && x.op === 'insert'), 'and the rename is on record');
});
test('marking a call not-a-sales-call sets the flag on the call', async () => {
  const a = fresh(); const r = await call(R.me, 'post', '/calls/:id/not-a-sales-call', { params: { id: 'c1' }, body: { not_a_sales_call: true } }); dbg('not-sales', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.writes.some((x) => x.table === 'fathom_calls' && x.op === 'update' && x.patch.not_a_sales_call === true), 'the flag is SET: ' + JSON.stringify(a.writes));
});
test('setting the call type writes it and who set it', async () => {
  const a = fresh(); const r = await call(R.me, 'post', '/calls/:id/call-kind', { params: { id: 'c1' }, body: { call_kind: 'follow_up' } }); dbg('call-kind', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.writes.some((x) => x.table === 'fathom_calls' && x.op === 'update' && x.patch.call_kind === 'follow_up' && x.patch.call_kind_marked_by), 'the type is WRITTEN with the marker: ' + JSON.stringify(a.writes));
});
test('changing the password updates the user after the current one is verified', async () => {
  const a = fresh(); const r = await call(R.auth, 'post', '/change-password', { body: { current_password: 'old-pass-123', new_password: 'new-pass-1234' } }); dbg('change-password', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.authCalls.some((c) => c[0] === 'signIn'), 'the current password is verified first');
  assert.ok(a.authCalls.some((c) => c[0] === 'updateUserById' && c[1] === 'rep' && c[2].password === 'new-pass-1234'), 'the password is UPDATED: ' + JSON.stringify(a.authCalls));
});
test('setting the password from the invite link updates the user the token names', async () => {
  const a = fresh(); const r = await call(R.auth, 'post', '/set-password', { headers: { authorization: 'Bearer tok' }, get(h) { return h.toLowerCase() === 'authorization' ? 'Bearer tok' : ''; }, body: { password: 'new-pass-1234' } }); dbg('set-password', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.authCalls.some((c) => c[0] === 'updateUserById' && c[2].password === 'new-pass-1234'), 'UPDATED: ' + JSON.stringify(a.authCalls));
});
test('forgot password answers the same sentence and mints the link off the response path', async () => {
  const a = fresh(); const r = await call(R.auth, 'post', '/forgot-password', { body: { email: 'ava@example.com' }, ip: '1.2.3.4' }); dbg('forgot', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.ok(r.body && /reset link/i.test(r.body.message || JSON.stringify(r.body)));
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(a.authCalls.some((c) => c[0] === 'generateLink'), 'the link is minted after the answer: ' + JSON.stringify(a.authCalls));
  assert.ok(SENT.length >= 1 && /ava@example\.com/.test(String(SENT[SENT.length - 1].body)), 'and the email is SENT to that address: ' + JSON.stringify(SENT).slice(0, 200));
});
test('deleting a knowledge-base entry deletes its rows and says how many', async () => {
  const a = fresh(); const r = await call(R.kb, 'delete', '/:source_label', { user: { id: 'mgr', email: 'm@x' }, params: { source_label: 'My Offer.pdf' } }); dbg('kb-delete', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.writes.some((x) => x.table === 'knowledge_base' && x.op === 'delete' && x.f.source_label === 'My Offer.pdf'), 'the rows are DELETED: ' + JSON.stringify(a.writes));
});
test('searching the knowledge base returns results', async () => {
  const a = fresh(); const r = await call(R.kb, 'post', '/search', { body: { query: 'money objection' } }); dbg('kb-search', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.ok(Array.isArray(r.body.results) && r.body.results.length === 1);
});
test('uploading text to the knowledge base inserts embedded rows under the team', async () => {
  const a = fresh(); const r = await call(R.kb, 'post', '/upload', { user: { id: 'mgr', email: 'm@x' }, body: { type: 'paste', category: 'offer_document', label: 'Our offer', text: 'The offer is a done-for-you programme. '.repeat(40) } }); dbg('kb-upload', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  const ins = a.writes.find((x) => x.table === 'knowledge_base' && x.op === 'insert');
  assert.ok(ins && ins.rows.length >= 1 && ins.rows[0].scope === 'team' && ins.rows[0].embedding, 'rows INSERTED, team scope, embedded: ' + JSON.stringify(a.writes).slice(0, 300));
});
test('saving the Fathom identity writes the email on the connection', async () => {
  const a = fresh(); const r = await call(R.fathom, 'post', '/identity', { body: { email: 'ava@example.com' } }); dbg('identity', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.writes.some((x) => x.table === 'fathom_connections' && x.op === 'update' && x.patch.fathom_email === 'ava@example.com'), 'WRITTEN: ' + JSON.stringify(a.writes));
});
test('the identity options answer with the current value and suggestions', async () => {
  const a = fresh(); const r = await call(R.fathom, 'get', '/identity-options', {}); dbg('identity-options', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.ok('current' in r.body && Array.isArray(r.body.suggestions));
});
test('sync without an identity says so instead of syncing; the history sync writes the window first', async () => {
  const a = fresh(); const r = await call(R.fathom, 'get', '/sync', {}); dbg('sync', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.needs_identity, true);
  const b = fresh(); const r2 = await call(R.fathom, 'post', '/sync-history', { body: { window: '90d' } }); dbg('sync-history', r2, b);
  assert.strictEqual(r2.code, 200, JSON.stringify(r2.body));
  assert.ok(b.writes.some((x) => x.table === 'fathom_connections' && x.op === 'update' && x.patch.sync_window), 'the window is WRITTEN before the sync: ' + JSON.stringify(b.writes));
});
test('disconnecting deletes the connection (Fathom and Zoom)', async () => {
  const a = fresh(); const r = await call(R.fathom, 'delete', '/disconnect', {}); dbg('fathom-disconnect', r, a);
  assert.strictEqual(r.code, 200); assert.ok(a.writes.some((x) => x.table === 'fathom_connections' && x.op === 'delete' && x.f.user_id === 'rep'), 'DELETED: ' + JSON.stringify(a.writes));
  const b = fresh(); const r2 = await call(R.zoom, 'delete', '/disconnect', {}); dbg('zoom-disconnect', r2, b);
  assert.strictEqual(r2.code, 200); assert.ok(b.writes.some((x) => x.table === 'call_connections' && x.op === 'delete'), 'DELETED: ' + JSON.stringify(b.writes));
});
test('zoom sync with no connection answers a body, not a crash', async () => {
  const a = fresh(); const r = await call(R.zoom, 'post', '/sync', {}); dbg('zoom-sync', r, a);
  assert.ok(r.code !== 'threw' && r.code !== 500 && r.body && typeof r.body === 'object', JSON.stringify(r).slice(0, 300));
});
test('raising a support ticket inserts it and answers a reference', async () => {
  const a = fresh(); const r = await call(R.support, 'post', '/tickets', { body: { message: 'The calls page is empty for me', page: 'calls' } }); dbg('support', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  const ins = a.writes.find((x) => x.table === 'support_tickets' && x.op === 'insert');
  assert.ok(ins && ins.rows[0].message === 'The calls page is empty for me' && ins.rows[0].user_id === 'rep', 'the ticket is INSERTED: ' + JSON.stringify(a.writes));
  assert.ok(r.body.reference, 'a reference comes back');
});
test('attaching an image to a ticket uploads the bytes', async () => {
  const a = fresh(); const req = Readable.from([Buffer.from('fakepngbytes-'.repeat(20))]); Object.assign(req, { user: { id: 'rep', email: 'ava@x' }, query: {}, params: {}, body: {}, headers: { 'content-type': 'image/png' }, get(h) { return h.toLowerCase() === 'content-type' ? 'image/png' : ''; } });
  const l = R.support.stack.find((x) => x.route && x.route.path === '/attachments' && x.route.methods.post); const handler = l.route.stack[l.route.stack.length - 1].handle;
  const r = await new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; Promise.resolve().then(() => handler(req, res)).catch((e) => resolve({ code: 'threw', body: String(e && e.stack) })); }); dbg('attach', r, a);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.writes.some((x) => x.table === 'storage' && x.bytes === 260), 'the bytes are UPLOADED: ' + JSON.stringify(a.writes));
});
test.after(() => { global.fetch = realFetch; if (savedSb) require.cache[sbPath] = savedSb; else delete require.cache[sbPath]; });
