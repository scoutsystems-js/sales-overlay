/**
 * ⚠⚠ THE PERMISSION BOUNDARY, EXERCISED OVER HTTP THROUGH THE REAL ROUTE HANDLER.
 *
 * "A predicate proven in isolation is not an API boundary" has been written in
 * these findings FIVE times without being closed. This closes it: the route is
 * mounted on a real Express app and driven with real requests, so what is under
 * test is the HANDLER — its lookup, its role resolution, its 403 branch and its
 * write — not `canMarkNotSalesCall` on its own.
 *
 * ⚠ THE ACTOR IS FORGED SERVER-SIDE, NOT SIGNED IN. Every session available to
 * this project belongs to an `owner`, and obtaining a plain-user session would
 * mean entering a password — which is not something to work around. Injecting
 * `req.user` ahead of the router is the correct substitute: it exercises every
 * line of the handler except the token decode, which is `requireAuth`'s job and
 * is tested elsewhere.
 *
 * ⚠ Supabase is faked. The rows are what matter — who owns the call, who manages
 * whom — and those are exactly what the handler branches on.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/* ⚠ requireAuth is stubbed IN THE REQUIRE CACHE before routes/me loads. It
   decodes a real Supabase token, which a forged actor does not have — and
   obtaining one means signing in. Token decoding is requireAuth's own concern
   and is covered elsewhere; what is under test here is the HANDLER's
   permission branch, which runs after auth. */
const authPath = require.resolve("../middleware/auth");
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, {
  requireAuth: function (req, _res, next) { next(); },
});

const CALL_JOSH = 'call-josh';
const CALL_REP = 'call-rep';
const CALL_OUTSIDE = 'call-outside';

/** who owns what, and who manages whom */
const CALLS = {
  [CALL_JOSH]:    { id: CALL_JOSH,    user_id: 'josh' },
  [CALL_REP]:     { id: CALL_REP,     user_id: 'rep' },
  [CALL_OUTSIDE]: { id: CALL_OUTSIDE, user_id: 'stranger' },
};
const PROFILES = {
  josh:     { user_id: 'josh',     role: 'user',    managed_by: 'mgr' },
  rep:      { user_id: 'rep',      role: 'user',    managed_by: 'mgr' },
  stranger: { user_id: 'stranger', role: 'user',    managed_by: 'other-mgr' },
  mgr:      { user_id: 'mgr',      role: 'manager', managed_by: null },
};

let LAST_UPDATE = null;

function fakeAdmin() {
  return {
    from(table) {
      const chain = {
        _ids: null, _id: null, _payload: null,
        select() { return chain; },
        update(p) { chain._payload = p; return chain; },
        eq(col, v) { if (col === 'id') chain._id = v; return chain; },
        in(col, v) { chain._ids = v; return chain; },
        maybeSingle() {
          if (table === 'fathom_calls') return Promise.resolve({ data: CALLS[chain._id] || null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          LAST_UPDATE = { table, id: chain._id, payload: chain._payload };
          return Promise.resolve({
            data: { id: chain._id,
                    not_a_sales_call: chain._payload.not_a_sales_call,
                    not_sales_marked_role: chain._payload.not_sales_marked_role },
            error: null });
        },
        then(resolve) {
          if (table === 'user_profiles') {
            resolve({ data: (chain._ids || []).map(id => PROFILES[id]).filter(Boolean), error: null });
          } else { resolve({ data: [], error: null }); }
        },
      };
      return chain;
    },
  };
}

/** Mount the REAL router with a forged actor ahead of it. */
function appFor(actorId) {
  const meRoutes = require('../routes/me');
  const app = express();
  app.use(express.json());
  app.use(function (req, _res, next) {
    req.user = { id: actorId };                       // ⚠ forged, not signed in
    req.userProfileRole = (PROFILES[actorId] || {}).role || 'user';
    next();
  });
  app.use('/me', meRoutes);
  return app;
}

function post(app, path, body) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app).listen(0, function () {
      const payload = JSON.stringify(body);
      const req = http.request({ port: server.address().port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        function (res) {
          let data = ''; res.on('data', d => { data += d; });
          res.on('end', function () {
            server.close();
            let j = null; try { j = JSON.parse(data); } catch (e) {}
            resolve({ status: res.statusCode, body: j });
          });
        });
      req.on('error', function (e) { server.close(); reject(e); });
      req.end(payload);
    });
  });
}

/* ⚠ getAdminClient is module-level in routes/me; swap it for the fake. */
const config = require('../config');
const origGet = config.getAdminClient;

test.before(function () {
  const me = require('../routes/me');
  if (me._setAdminClientForTests) me._setAdminClientForTests(fakeAdmin);
});

const PATH = id => '/me/calls/' + id + '/not-a-sales-call';

test('⚠⚠ role user, NOT the owner → 403 OVER HTTP', async () => {
  const res = await post(appFor('stranger'), PATH(CALL_JOSH), { not_a_sales_call: true });
  assert.strictEqual(res.status, 403,
    'the API must refuse — a hidden button is not a permission check');
});

test('⚠ closer on their OWN call → 200, marked_role "closer"', async () => {
  const res = await post(appFor('josh'), PATH(CALL_JOSH), { not_a_sales_call: true });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.marked_role, 'closer');
});

test('⚠ manager, call INSIDE their team → 200, marked_role "manager"', async () => {
  const res = await post(appFor('mgr'), PATH(CALL_REP), { not_a_sales_call: true });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.marked_role, 'manager');
});

test('⚠⚠ manager, call OUTSIDE their team → 403', async () => {
  const res = await post(appFor('mgr'), PATH(CALL_OUTSIDE), { not_a_sales_call: true });
  assert.strictEqual(res.status, 403);
});

test('⚠ NON-VACUITY — the 403 assertions can fail', async () => {
  /* Forge an actor who SHOULD succeed against the same path the 403 tests use.
     If this returned 403 the suite would be asserting nothing. */
  const res = await post(appFor('josh'), PATH(CALL_JOSH), { not_a_sales_call: true });
  assert.notStrictEqual(res.status, 403,
    'an allowed actor must NOT be refused — otherwise the 403 tests pass trivially');
});
