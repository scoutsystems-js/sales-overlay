/**
 * THE OFFER FORM (H730, Justin's ruling 2026-09-05): managers and above, and single users, edit niche,
 * offer, qualifications and script. A MANAGED REP CANNOT — the head's row feeds every rep's grading,
 * and a rep editing it would change how their own calls are graded, which a graded person must never
 * control. ENFORCED SERVER-SIDE on both doors and EXECUTED here over HTTP with forged actors: the
 * consequence asserted is the WRITE (none on refusal), so a plant that removes the lock, or keeps the
 * lock and discards its answer, fails here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); }, requireSubscription: function (_req, _res, next) { next(); } });

function world() {
  const P = {
    head:   { user_id: 'head',   role: 'manager', managed_by: null,   first_name: 'Josh', niche: null, offer: null, qualifications: null, script_raw: null, price_pif: 9800 },
    rep:    { user_id: 'rep',    role: 'user',    managed_by: 'head', first_name: 'Godwin', niche: null, offer: null, qualifications: null, script_raw: null },
    single: { user_id: 'single', role: 'user',    managed_by: null,   first_name: 'Solo', niche: null, offer: null, qualifications: null, script_raw: null },
    other:  { user_id: 'other',  role: 'manager', managed_by: null,   first_name: 'Other', niche: null, offer: null, qualifications: null, script_raw: null },
    owner:  { user_id: 'owner',  role: 'owner',   managed_by: null,   first_name: 'Justin' },
  };
  const writes = [];
  const admin = { from(table) {
    const ch = { f: {}, _p: null, _op: 'select', _count: false,
      select(cols, opts) { ch._count = !!(opts && opts.count); return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; },
      eq(k, v) { ch.f[k] = v; return ch; }, in() { return ch; }, is() { return ch; }, order() { return ch; }, limit() { return ch; },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles' ? (P[ch.f.user_id] ? Object.assign({}, P[ch.f.user_id]) : null) : null, error: null }); },
      then(res, rej) {
        if (table === 'user_profiles' && ch._op === 'update') { writes.push({ id: ch.f.user_id, patch: ch._p }); Object.assign(P[ch.f.user_id] || {}, ch._p); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        if (table === 'user_profiles' && ch._count) { const n = Object.values(P).filter((x) => x.managed_by === ch.f.managed_by).length; return Promise.resolve({ data: null, count: n, error: null }).then(res, rej); }
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      } };
    return ch;
  } };
  return { P, writes, admin };
}
function appFor(actorId, w) {
  const me = require('../routes/me'); const adminRoutes = require('../routes/admin');
  me._setAdminClientForTests(() => w.admin); adminRoutes._setAdminClientForTests(w.admin);   // me.js calls the factory, admin.js stores the client
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: actorId, role: w.P[actorId].role, email: actorId + '@x.io' }; req.userProfileRole = w.P[actorId].role; next(); });
  a.use('/me', me); a.use('/admin', adminRoutes); return a;
}
function call(app, method, p, body) { return new Promise((resolve, reject) => { const server = http.createServer(app).listen(0, () => { const payload = body ? JSON.stringify(body) : null;
  const req = http.request({ port: server.address().port, path: p, method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); });
  req.on('error', (e) => { server.close(); reject(e); }); if (payload) req.write(payload); req.end(); }); }); }
const OFFER = { niche: 'Sober Living Homes Investing', offer: 'Done-for-you market research and a full education on the blueprint', qualifications: '10k saved, not living paycheck to paycheck, 640 or above credit score', script_raw: 'Hi! How are you? '.repeat(20) };

test('⚠⚠ a MANAGED REP is refused on the account route and NOTHING is written (the consequence, not the status alone)', async () => {
  const w = world();
  const r = await call(appFor('rep', w), 'PATCH', '/me/account', OFFER);
  assert.strictEqual(r.status, 403); assert.strictEqual(w.writes.length, 0, 'no write on refusal');
  assert.strictEqual(w.P.rep.offer, null);
});

test('⚠⚠ the HEAD writes the four fields; a SINGLE USER writes their own — the same rule; the payload carries them and the one sentence', async () => {
  const w = world();
  const r = await call(appFor('head', w), 'PATCH', '/me/account', OFFER);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(w.writes.length, 1); assert.strictEqual(w.P.head.qualifications, OFFER.qualifications); assert.strictEqual(w.P.head.script_raw, OFFER.script_raw.trim());
  const s = await call(appFor('single', w), 'PATCH', '/me/account', { offer: 'My own thing, long enough to count' });
  assert.strictEqual(s.status, 200); assert.strictEqual(w.P.single.offer, 'My own thing, long enough to count');
  const g = await call(appFor('head', w), 'GET', '/me/account');
  assert.strictEqual(g.body.qualifications, OFFER.qualifications); assert.strictEqual(g.body.team_size, 1);
  assert.strictEqual(g.body.offer_save_sentence, 'This changes how your team’s calls are graded from the next call on.');
  const g2 = await call(appFor('single', w), 'GET', '/me/account');
  assert.strictEqual(g2.body.offer_save_sentence, 'This changes how your calls are graded from the next call on.');
  const bad = await call(appFor('head', w), 'PATCH', '/me/account', { niche: 'x'.repeat(201) });
  assert.strictEqual(bad.status, 400);
  const clear = await call(appFor('head', w), 'PATCH', '/me/account', { niche: '' });
  assert.strictEqual(clear.status, 200); assert.strictEqual(w.P.head.niche, null, 'empty clears the field');
});

test('⚠⚠ the ADMIN door: an owner edits a HEAD; an owner is refused on a MANAGED REP with nothing written; a manager edits only their own row', async () => {
  const w = world();
  assert.strictEqual((await call(appFor('owner', w), 'GET', '/admin/users/head/offer')).status, 200);
  const ok = await call(appFor('owner', w), 'PATCH', '/admin/users/head/offer', { qualifications: OFFER.qualifications });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.strictEqual(w.P.head.qualifications, OFFER.qualifications);
  const no = await call(appFor('owner', w), 'PATCH', '/admin/users/rep/offer', { qualifications: 'anything' });
  assert.strictEqual(no.status, 403); assert.match(no.body.error, /inherited/); assert.strictEqual(w.P.rep.qualifications, null, 'a rep-level value is never written');
  assert.strictEqual((await call(appFor('owner', w), 'GET', '/admin/users/rep/offer')).status, 403);
  const self = await call(appFor('head', w), 'PATCH', '/admin/users/head/offer', { niche: 'Sober living' });
  assert.strictEqual(self.status, 200); assert.strictEqual(w.P.head.niche, 'Sober living');
  const other = await call(appFor('head', w), 'PATCH', '/admin/users/other/offer', { niche: 'x' });
  assert.strictEqual(other.status, 403); assert.strictEqual(w.P.other.niche, null);
  assert.strictEqual(w.writes.length, 2, 'exactly the two allowed writes happened');
});
