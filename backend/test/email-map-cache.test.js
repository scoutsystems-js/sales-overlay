'use strict';
/* ⚠ `auth.admin.listUsers` RAN ON EVERY TEAM REQUEST — a full auth-table
   round trip (~1s on production) to build a {user_id: email} map that changes
   only when a user is provisioned. One module, a short TTL, every team route
   reads it. A stale map costs a new user their email as a name fallback for
   at most TTL; a fresh one on every request cost every manager a second on
   every page. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const em = require('../lib/email-map');
const { stripComments } = require('./helpers/strip-comments');

function fakeAdmin(counter, fail) {
  return { auth: { admin: { listUsers() {
    counter.n++;
    if (fail) return Promise.resolve({ data: null, error: { message: 'boom' } });
    return Promise.resolve({ data: { users: [{ id: 'u1', email: 'u1@x.io' }, { id: 'u2', email: null }] }, error: null });
  } } } };
}

test('⚠ two reads inside the TTL cost ONE listUsers; the map is the map', async () => {
  em._reset();
  const c = { n: 0 };
  const a = fakeAdmin(c);
  const m1 = await em.emailMapFor(a, { now: 1000 });
  const m2 = await em.emailMapFor(a, { now: 1000 + em.TTL_MS - 1 });
  assert.strictEqual(c.n, 1, 'one auth round trip for two reads');
  assert.deepStrictEqual(m1, { u1: 'u1@x.io', u2: null });
  assert.deepStrictEqual(m2, m1);
});

test('⚠ past the TTL it re-reads; an error is thrown AND not cached', async () => {
  em._reset();
  const c = { n: 0 };
  await em.emailMapFor(fakeAdmin(c), { now: 1000 });
  await em.emailMapFor(fakeAdmin(c), { now: 1000 + em.TTL_MS + 1 });
  assert.strictEqual(c.n, 2, 'a second read past the TTL');
  em._reset();
  const f = { n: 0 };
  await assert.rejects(() => em.emailMapFor(fakeAdmin(f, true), { now: 5 }), /listUsers/);
  const ok = { n: 0 };
  await em.emailMapFor(fakeAdmin(ok), { now: 6 });
  assert.strictEqual(ok.n, 1, 'the failure left nothing cached, so the next read fetched');
  assert.ok(em.TTL_MS >= 15000 && em.TTL_MS <= 120000, 'TTL is a short window, saw ' + em.TTL_MS);
});

test('⚠⚠ routes/team.js reads the SHARED map — no private listUsers left', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8'));
  assert.ok(src.indexOf('emailMapFor(') !== -1, 'the route file must call the shared reader');
  assert.strictEqual((src.match(/auth\.admin\.listUsers/g) || []).length, 0, 'no private listUsers in routes/team.js');
});
