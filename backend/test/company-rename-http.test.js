/**
 * PATCH /admin/companies/:head_id/name — over real HTTP, with forged actors.
 *
 * ⚠⚠ THE PROPERTY THAT MATTERS MOST HERE IS NOT THE GATE, IT IS THE REFUSAL TO
 * ACCEPT A HEAD WHO CANNOT LEAD A TEAM. A plain `user` heading a company
 * contradicts the role model — PATCH /users/:id/managed_by already requires
 * manager|owner as a target — so accepting it would produce a company nobody
 * could legitimately be moved into.
 *
 * ⚠ THIS GUARD CHANGED 2026-08-24. It previously refused a target with NO REPS,
 * because naming a repless user stored something that could never render. Now
 * naming IS how a company is created, so that reasoning is gone; the role
 * check is what survived. See the converted test below.
 *
 * ⚠ A predicate proven in isolation is not an API boundary. `sanitizeCompanyName`
 * is unit-tested next door; neither that nor a grep tells you whether the ROUTE
 * refuses a manager.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/* Mount the REAL admin router with only the token decode stubbed.
   ⚠ requireRole reads `req.userProfileRole`, NOT `req.user.role` — stamping
   only the latter sends the request to a DB lookup and returns 503, which reads
   exactly like a passing gate failing for an unrelated reason. */
function withActor(actorRef, adminClient) {
  const authPath = require.resolve('../middleware/auth');
  const realAuth = require(authPath);
  const saved = require.cache[authPath].exports;
  require.cache[authPath].exports = Object.assign({}, realAuth, {
    requireAuth: function (req, _res, next) {
      const a = actorRef.current;
      req.user = { id: a.id, role: a.role, email: a.id + '@test.invalid' };
      req.userProfileRole = a.role;
      next();
    },
  });
  delete require.cache[require.resolve('../routes/admin')];
  const router = require('../routes/admin');
  if (adminClient && router._setAdminClientForTests) router._setAdminClientForTests(adminClient);
  const app = express();
  app.use(express.json());
  app.use('/admin', router);
  return {
    app,
    hasHook: !!router._setAdminClientForTests,
    restore: () => {
      require.cache[authPath].exports = saved;
      delete require.cache[require.resolve('../routes/admin')];
    },
  };
}

/* ⚠ `agent: false` — a fresh socket per request. A reused keep-alive socket
   across these calls produced an ECONNRESET that looked like a route failure
   and was purely a harness artifact. */
function patch(port, headId, body) {
  return new Promise((res, rej) => {
    const payload = JSON.stringify(body);
    const r = http.request({
      port, method: 'PATCH', agent: false,
      path: '/admin/companies/' + headId + '/name',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (r2) => {
      let d = ''; r2.on('data', (c) => { d += c; });
      r2.on('end', () => res({ status: r2.statusCode, body: d }));
    });
    r.on('error', rej); r.end(payload);
  });
}

/** Supabase stand-in: `roleOf` decides who may head a company; writes recorded. */
function fakeAdmin(roleOf, writes) {
  return {
    from() {
      const st = { eqs: {}, update: null };
      const api = {
        select() { return api; },
        update(vals) { st.update = vals; return api; },
        eq(col, val) { st.eqs[col] = val; return api; },
        maybeSingle() {
          const id = st.eqs.user_id;
          return Promise.resolve({
            data: roleOf[id] ? { user_id: id, role: roleOf[id] } : null, error: null,
          });
        },
        then(res) {
          if (st.update) {
            writes.push({ user_id: st.eqs.user_id, team_name: st.update.team_name });
            return Promise.resolve({ data: [{ user_id: st.eqs.user_id, team_name: st.update.team_name }], error: null }).then(res);
          }
          return Promise.resolve({ data: [], error: null }).then(res);
        },
      };
      return api;
    },
  };
}

const HEAD = '00000000-0000-4000-8000-00000000aaaa';   // a manager: may head a company
const PLAIN = '00000000-0000-4000-8000-00000000bbbb';  // a plain user: may not

async function serve(actor, writes) {
  const h = withActor(actor, fakeAdmin({ [HEAD]: 'manager', [PLAIN]: 'user' }, writes));
  const server = await new Promise((r) => { const s = http.createServer(h.app); s.listen(0, () => r(s)); });
  return { h, server, port: server.address().port };
}

test('⚠⚠ THE GATE: a closer and a manager are refused; an owner clears it', async () => {
  const actor = { current: { id: 'closer-1', role: 'user' } };
  const { h, server, port } = await serve(actor, []);
  try {
    assert.strictEqual((await patch(port, HEAD, { name: 'Acme' })).status, 403,
      'a closer must be refused');

    actor.current = { id: 'mgr-1', role: 'manager' };
    assert.strictEqual((await patch(port, HEAD, { name: 'Acme' })).status, 403,
      'a manager must be refused too — company naming is owner-only, matching '
      + 'the other admin-console field edits (role, billing)');

    /* ⚠ NON-VACUITY: an actor who SHOULD pass must not be refused, or this
       passes against a route that refuses everyone. */
    actor.current = { id: 'owner-1', role: 'owner' };
    const owner = await patch(port, HEAD, { name: 'Acme' });
    assert.notStrictEqual(owner.status, 403,
      'an owner must clear the gate; got 403, so this proves nothing about roles');
  } finally { server.close(); h.restore(); }
});

test('⚠⚠ A TARGET WHO CANNOT LEAD A TEAM IS REFUSED', async () => {
  /* ⚠ THIS TEST WAS CONVERTED, NOT DELETED (2026-08-24). It used to assert that
     a target with NO REPS was refused, because a name stored there was
     invisible forever. Naming now CREATES a company, so that reasoning is gone
     and refusing it would make "Add company" impossible.
     ⚠ The property that OUTLIVED the old rule is the one still asserted here:
     a user who cannot lead a team must not end up heading a company. A plain
     `user` heading one contradicts the role model, and PATCH
     /users/:id/managed_by already requires manager|owner as a target. */
  const actor = { current: { id: 'owner-1', role: 'owner' } };
  const writes = [];
  const { h, server, port } = await serve(actor, writes);
  try {
    if (!h.hasHook) return;
    const r = await patch(port, PLAIN, { name: 'Ghost Co' });
    assert.strictEqual(r.status, 400, 'a plain user must not head a company: ' + r.body);
    assert.ok(/manager or admin/i.test(r.body), 'and the reason must say why: ' + r.body);
    assert.strictEqual(writes.length, 0, 'nothing may be written for an ineligible head');
  } finally { server.close(); h.restore(); }
});

test('⚠ A REAL COMPANY SAVES, AND THE RESPONSE CARRIES WHAT WILL RENDER', async () => {
  const actor = { current: { id: 'owner-1', role: 'owner' } };
  const writes = [];
  const { h, server, port } = await serve(actor, writes);
  try {
    if (!h.hasHook) return;
    const r = await patch(port, HEAD, { name: '  Sober Living Riches  ' });
    assert.strictEqual(r.status, 200, r.body);
    const d = JSON.parse(r.body);
    assert.strictEqual(d.team_name, 'Sober Living Riches', 'trimmed on the way in');
    assert.strictEqual(d.display_name, 'Sober Living Riches');
    assert.deepStrictEqual(writes, [{ user_id: HEAD, team_name: 'Sober Living Riches' }]);
  } finally { server.close(); h.restore(); }
});

test('⚠⚠ CLEARING (null) IS ALLOWED; JUNK (non-string) IS A 400 — they are different', async () => {
  const actor = { current: { id: 'owner-1', role: 'owner' } };
  const writes = [];
  const { h, server, port } = await serve(actor, writes);
  try {
    if (!h.hasHook) return;

    const cleared = await patch(port, HEAD, { name: null });
    assert.strictEqual(cleared.status, 200, 'an explicit clear is a legitimate edit: ' + cleared.body);
    const d = JSON.parse(cleared.body);
    assert.strictEqual(d.team_name, null);
    assert.strictEqual(d.display_name, 'Unnamed company',
      'and it lands back on the fallback, never blank');

    /* ⚠ If junk were treated as a clear, a malformed payload would silently
       wipe a company's name — so the two must stay distinguishable. */
    const junk = await patch(port, HEAD, { name: 42 });
    assert.strictEqual(junk.status, 400, 'a non-string is a 400, not a clear: ' + junk.body);

    const missing = await patch(port, HEAD, {});
    assert.strictEqual(missing.status, 400, 'an absent field is a 400 too');

    assert.strictEqual(writes.length, 1, 'only the legitimate clear may write');
  } finally { server.close(); h.restore(); }
});
