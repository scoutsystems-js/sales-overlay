/**
 * THE FOLLOW-UP FLAG BY HAND — THE ROUTE, EXECUTED OVER HTTP (H706, H666): the
 * permission branch runs after auth, so the actor is forged at the layer below the
 * credential (the not-sales-http pattern). A stranger is refused; a closer marks
 * their own call (H352 stands); a manager marks a call inside their team; the write
 * goes through the human setter with the actor stamped.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); } });

const CALLS = {
  'call-josh': { id: 'call-josh', user_id: 'josh', prospect_id: 'p1', call_date: '2026-09-02T10:00:00Z' },
  'call-rep':  { id: 'call-rep',  user_id: 'rep',  prospect_id: null, call_date: '2026-09-02T10:00:00Z' },
};
const PROFILES = {
  josh: { user_id: 'josh', role: 'user', managed_by: 'mgr' }, rep: { user_id: 'rep', role: 'user', managed_by: 'mgr' },
  stranger: { user_id: 'stranger', role: 'user', managed_by: 'other' }, mgr: { user_id: 'mgr', role: 'manager', managed_by: null },
};
const EARLIER = [{ id: 'call-earlier', call_date: '2026-08-20T10:00:00Z', call_kind: 'booked' }];
let LAST_UPDATE = null;
function fakeAdmin() {
  return { from(table) {
    const chain = { _ids: null, _id: null, _payload: null, _prospect: null,
      select() { return chain; }, update(p) { chain._payload = p; return chain; },
      eq(col, v) { if (col === 'id') chain._id = v; if (col === 'prospect_id') chain._prospect = v; return chain; },
      in(col, v) { chain._ids = v; return chain; }, not() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; }, lt() { return chain; },
      maybeSingle() { return Promise.resolve({ data: table === 'fathom_calls' ? (CALLS[chain._id] || null) : null, error: null }); },
      single() { LAST_UPDATE = { table, id: chain._id, payload: chain._payload }; return Promise.resolve({ data: Object.assign({ id: chain._id }, chain._payload), error: null }); },
      then(resolve) {
        if (table === 'user_profiles') resolve({ data: (chain._ids || []).map((id) => PROFILES[id]).filter(Boolean), error: null });
        else if (table === 'fathom_calls' && chain._prospect) resolve({ data: EARLIER, error: null });
        else resolve({ data: [], error: null });
      } };
    return chain;
  } };
}
function appFor(actorId) {
  const meRoutes = require('../routes/me');
  const app = express(); app.use(express.json());
  app.use(function (req, _res, next) { req.user = { id: actorId }; req.userProfileRole = (PROFILES[actorId] || {}).role || 'user'; next(); });
  app.use('/me', meRoutes); return app;
}
function post(app, path, body) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app).listen(0, function () {
      const payload = JSON.stringify(body);
      const req = http.request({ port: server.address().port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        function (res) { let data = ''; res.on('data', (d) => { data += d; }); res.on('end', function () { server.close(); let j = null; try { j = JSON.parse(data); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); });
      req.on('error', function (e) { server.close(); reject(e); }); req.end(payload);
    });
  });
}
test.before(function () { const me = require('../routes/me'); if (me._setAdminClientForTests) me._setAdminClientForTests(fakeAdmin); });
const PATH = (id) => '/me/calls/' + id + '/call-kind';

test('⚠⚠ a stranger is refused OVER HTTP, and nothing is written', async () => {
  LAST_UPDATE = null;
  const res = await post(appFor('stranger'), PATH('call-josh'), { call_kind: 'follow_up' });
  assert.strictEqual(res.status, 403, 'the API must refuse — a hidden button is not a permission check');
  assert.strictEqual(LAST_UPDATE, null, 'no write on refusal');
});

test('⚠ a closer marks their OWN call a follow-up (H352 stands); the human setter stamps the actor and attributes to the earlier booked call', async () => {
  const res = await post(appFor('josh'), PATH('call-josh'), { call_kind: 'follow_up' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(LAST_UPDATE.table, 'fathom_calls'); assert.strictEqual(LAST_UPDATE.id, 'call-josh');
  assert.strictEqual(LAST_UPDATE.payload.call_kind, 'follow_up'); assert.strictEqual(LAST_UPDATE.payload.call_kind_source, 'human');
  assert.strictEqual(LAST_UPDATE.payload.call_kind_marked_by, 'josh'); assert.ok(LAST_UPDATE.payload.call_kind_marked_at);
  assert.strictEqual(LAST_UPDATE.payload.follows_call_id, 'call-earlier', 'attributes to the earliest booked call of the prospect');
});

test('⚠ a manager marks a call inside their team; booked clears follows_call_id; a bad value is a 400', async () => {
  const res = await post(appFor('mgr'), PATH('call-rep'), { call_kind: 'booked' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(LAST_UPDATE.payload.call_kind, 'booked'); assert.strictEqual(LAST_UPDATE.payload.follows_call_id, null);
  const bad = await post(appFor('mgr'), PATH('call-rep'), { call_kind: 'maybe' });
  assert.strictEqual(bad.status, 400);
});
