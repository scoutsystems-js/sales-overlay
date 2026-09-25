'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

const HEAD = '00000000-0000-4000-8000-00000000aaaa';

function withActor(actorRef, clients) {
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
  delete require.cache[require.resolve('../routes/billing')];
  const router = require('../routes/billing');
  router._setClientsForTests(clients);
  const app = express(); app.use(express.json()); app.use('/billing', router);
  return { app, restore() { require.cache[authPath].exports = saved; delete require.cache[require.resolve('../routes/billing')]; } };
}

function post(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({ port, method: 'POST', agent: false,
      path: '/billing/admin/companies/' + HEAD + '/checkout' }, (response) => {
      let body = ''; response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject); request.end();
  });
}

test('only an owner can create checkout, and its line item comes from the saved draft', async () => {
  const priorStandard = process.env.STRIPE_CLOSER_197_PRICE_ID;
  const priorManager = process.env.STRIPE_MANAGER_297_PRICE_ID;
  process.env.STRIPE_CLOSER_197_PRICE_ID = 'price_standard';
  process.env.STRIPE_MANAGER_297_PRICE_ID = 'price_manager';
  const draft = { company_head_id: HEAD, billing_email: 'billing@example.com', closer_seats: 9, manager_seats: 2, status: 'draft' };
  const calls = [];
  const supabase = { from(table) {
    const state = { table, payload: null, filters: {} };
    const api = {
      select() { return api; }, eq(key, value) { state.filters[key] = value; return api; },
      update(value) { state.payload = value; return api; },
      maybeSingle() {
        if (table === 'company_billing' && !state.payload) return Promise.resolve({ data: draft, error: null });
        return Promise.resolve({ data: { company_head_id: HEAD }, error: null });
      },
    };
    return api;
  } };
  const stripe = { checkout: { sessions: { create(params) { calls.push(params); return Promise.resolve({ id: 'cs_test', url: 'https://checkout.stripe.test/session' }); } } } };
  const actor = { current: { id: 'manager', role: 'manager' } };
  const h = withActor(actor, { stripe, supabase });
  const server = await new Promise((resolve) => { const value = http.createServer(h.app); value.listen(0, () => resolve(value)); });
  try {
    assert.strictEqual((await post(server.address().port)).status, 403, 'managers cannot create a charge path');
    actor.current = { id: 'owner', role: 'owner' };
    const result = await post(server.address().port);
    assert.strictEqual(result.status, 200, result.body);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].line_items[0].quantity, 9);
    assert.strictEqual(calls[0].line_items[0].price, 'price_standard');
    assert.strictEqual(calls[0].line_items[1].price, 'price_manager');
  } finally {
    server.close(); h.restore();
    if (priorStandard === undefined) delete process.env.STRIPE_CLOSER_197_PRICE_ID;
    else process.env.STRIPE_CLOSER_197_PRICE_ID = priorStandard;
    if (priorManager === undefined) delete process.env.STRIPE_MANAGER_297_PRICE_ID;
    else process.env.STRIPE_MANAGER_297_PRICE_ID = priorManager;
  }
});
