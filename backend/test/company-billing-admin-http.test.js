'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

const HEAD = '00000000-0000-4000-8000-00000000aaaa';

function withActor(actorRef, adminClient) {
  const authPath = require.resolve('../middleware/auth');
  const realAuth = require(authPath);
  const saved = require.cache[authPath].exports;
  require.cache[authPath].exports = Object.assign({}, realAuth, {
    requireAuth(req, _res, next) {
      const actor = actorRef.current;
      req.user = { id: actor.id, role: actor.role, email: actor.id + '@test.invalid' };
      req.userProfileRole = actor.role;
      next();
    },
  });
  delete require.cache[require.resolve('../routes/admin')];
  const router = require('../routes/admin');
  router._setAdminClientForTests(adminClient);
  const app = express();
  app.use(express.json());
  app.use('/admin', router);
  return { app, restore() { require.cache[authPath].exports = saved; delete require.cache[require.resolve('../routes/admin')]; } };
}

function fakeAdmin(writes, currentStatus) {
  return {
    from(table) {
      const state = { table, filters: {}, payload: null };
      const api = {
        select() { return api; },
        eq(key, value) { state.filters[key] = value; return api; },
        limit() { return api; },
        upsert(payload) { state.payload = payload; return api; },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({
            data: { user_id: HEAD, role: 'manager', team_name: 'Acme' }, error: null,
          });
          if (table === 'company_billing') return Promise.resolve({
            data: currentStatus ? { status: currentStatus } : null, error: null,
          });
          return Promise.resolve({ data: null, error: null });
        },
        single() { return Promise.resolve({ data: state.payload, error: null }); },
      };
      return api;
    },
  };
}

function put(port, actor, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      port, method: 'PUT', agent: false,
      path: '/admin/companies/' + HEAD + '/billing',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text, actor }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function serve(actor, writes, status) {
  const h = withActor(actor, fakeAdmin(writes, status));
  const server = await new Promise((resolve) => {
    const value = http.createServer(h.app);
    value.listen(0, () => resolve(value));
  });
  return { h, server, port: server.address().port };
}

test('company billing draft is owner-only and saves closer and manager access seats', async () => {
  const actor = { current: { id: 'manager', role: 'manager' } };
  const writes = [];
  const { h, server, port } = await serve(actor, writes);
  try {
    const body = { billing_email: 'billing@example.com', closer_seats: 9, manager_seats: 2 };
    assert.strictEqual((await put(port, actor, body)).status, 403, 'a manager cannot create a charge path');

    actor.current = { id: 'owner', role: 'owner' };
    const good = await put(port, actor, body);
    assert.strictEqual(good.status, 200, good.body);
    const saved = JSON.parse(good.body).billing;
    assert.strictEqual(saved.closer_seats, 9);
    assert.strictEqual(saved.manager_seats, 2);
    assert.strictEqual(saved.status, 'draft');

    const invalid = await put(port, actor, Object.assign({}, body, { closer_seats: 0, manager_seats: 0 }));
    assert.strictEqual(invalid.status, 400, 'an empty company subscription must be refused');
  } finally {
    server.close();
    h.restore();
  }
});
