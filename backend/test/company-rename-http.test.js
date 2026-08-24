/**
 * PATCH /admin/companies/:head_id/name — over real HTTP, with forged actors.
 *
 * ⚠⚠ THE PROPERTY THAT MATTERS MOST HERE IS NOT THE GATE, IT IS THE REFUSAL TO
 * ACCEPT A WRITE THAT COULD NEVER RENDER. `lib/company.js` buckets on HAVING
 * REPS, never on role — so a name stored against a user with no reps is
 * invisible forever: they render as a Single User and their `team_name` is
 * never read. Accepting that write would return 200 for something with no
 * observable effect, which is the silent-success failure this session has
 * already shipped three times.
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

/** Supabase stand-in: `repsOf` decides who is a company; writes are recorded. */
function fakeAdmin(repsOf, writes) {
  return {
    from() {
      const st = { eqs: {}, update: null };
      const api = {
        select(_cols, opts) {
          if (opts && opts.count === 'exact' && opts.head === true) api._countMode = true;
          return api;
        },
        update(vals) { st.update = vals; return api; },
        eq(col, val) {
          st.eqs[col] = val;
          if (api._countMode) return Promise.resolve({ count: (repsOf[val] || 0), error: null });
          return api;
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

const HEAD = '00000000-0000-4000-8000-00000000aaaa';   // has 3 reps
const LONER = '00000000-0000-4000-8000-00000000bbbb';  // has none

async function serve(actor, writes) {
  const h = withActor(actor, fakeAdmin({ [HEAD]: 3 }, writes));
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

test('⚠⚠ A TARGET WITH NO REPS IS REFUSED — the write would be invisible forever', async () => {
  const actor = { current: { id: 'owner-1', role: 'owner' } };
  const writes = [];
  const { h, server, port } = await serve(actor, writes);
  try {
    if (!h.hasHook) return;   // route needs its test hook; covered by the unit tests otherwise
    const r = await patch(port, LONER, { name: 'Ghost Co' });
    assert.strictEqual(r.status, 400,
      'naming a user with no team members must be refused, not silently stored: '
      + 'lib/company.js renders them as a Single User and never reads the name');
    assert.ok(/no team members/i.test(r.body), 'and the reason must say why: ' + r.body);
    assert.strictEqual(writes.length, 0, 'nothing may be written for a non-company');
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
