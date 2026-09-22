'use strict';

// The Admin save path is the product boundary for shared manager access. Drive
// it over HTTP so a checkbox that looks right cannot silently fail to persist.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

function mount(actorRef, state) {
  const authPath = require.resolve('../middleware/auth');
  const realAuth = require(authPath);
  const saved = require.cache[authPath].exports;
  require.cache[authPath].exports = Object.assign({}, realAuth, {
    requireAuth: function (req, _res, next) {
      const actor = actorRef.current;
      req.user = { id: actor.id, role: actor.role, email: actor.id + '@test.invalid' };
      req.userProfileRole = actor.role;
      next();
    },
  });
  delete require.cache[require.resolve('../routes/admin')];
  const router = require('../routes/admin');
  router._setAdminClientForTests({
      from: function (table) {
        if (table === 'user_profiles') return {
          select: function () { return {
            eq: function () { return { maybeSingle: async function () { return { data: state.target, error: null }; } }; },
            in: async function () { return { data: state.managers, error: null }; },
          }; },
        };
        if (table === 'manager_rep_assignments') return {
          delete: function () { return { eq: async function () { state.removed = true; return { error: null }; } }; },
          upsert: async function (rows) { state.saved = rows; return { error: null }; },
        };
        throw new Error('unexpected table ' + table);
      },
  });
  const app = express();
  app.use(express.json());
  app.use('/admin', router);
  return {
    app: app,
    restore: function () {
      require.cache[authPath].exports = saved;
      delete require.cache[require.resolve('../routes/admin')];
    },
  };
}

function put(port, actor, body) {
  return new Promise(function (resolve, reject) {
    const text = JSON.stringify(body);
    const request = http.request({
      port: port,
      method: 'PUT',
      path: '/admin/users/closer-1/managers',
      agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) },
    }, function (response) {
      let output = '';
      response.on('data', function (chunk) { output += chunk; });
      response.on('end', function () { resolve({ status: response.statusCode, body: output }); });
    });
    request.on('error', reject);
    request.end(text);
  });
}

test('⚠⚠ Admin can add a second manager without changing the closer’s home manager', async function () {
  const actor = { current: { id: 'owner-1', role: 'owner' } };
  const state = {
    target: { user_id: 'closer-1', managed_by: 'home-manager' },
    managers: [{ user_id: 'second-manager', role: 'manager', active: true }],
    removed: false,
    saved: null,
  };
  const harness = mount(actor, state);
  const server = await new Promise(function (resolve) { const s = http.createServer(harness.app); s.listen(0, function () { resolve(s); }); });
  try {
    const result = await put(server.address().port, actor.current, { manager_ids: ['home-manager', 'second-manager'] });
    assert.strictEqual(result.status, 200, result.body);
    assert.strictEqual(state.target.managed_by, 'home-manager', 'shared access must never overwrite the home manager');
    assert.strictEqual(state.removed, true, 'the prior shared list is replaced as one saved set');
    assert.deepStrictEqual(state.saved, [{ manager_user_id: 'second-manager', rep_user_id: 'closer-1' }]);
    assert.deepStrictEqual(JSON.parse(result.body).manager_ids, ['home-manager', 'second-manager']);

    actor.current = { id: 'manager-1', role: 'manager' };
    const refused = await put(server.address().port, actor.current, { manager_ids: ['home-manager', 'second-manager'] });
    assert.strictEqual(refused.status, 403, 'only an Admin owner may grant cross-manager access');
  } finally {
    server.close();
    harness.restore();
  }
});
