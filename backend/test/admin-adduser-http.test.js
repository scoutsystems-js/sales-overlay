/**
 * POST /admin/users — the route must be INVOCABLE, not merely parseable.
 *
 * ⚠⚠ THIS EXISTS BECAUSE ADD-USER WAS COMPLETELY BROKEN FOR DAYS AND NOTHING
 * CAUGHT IT. `20ab18c` added two `normalizeName()` calls to this handler and
 * never imported the function, so every attempt threw
 * `ReferenceError: normalizeName is not defined`.
 *
 * ⚠ `node -c routes/admin.js` PASSES on that file — the syntax is perfect. An
 * identifier that resolves to nothing is only found by RUNNING the line, and
 * nothing in the suite ran this handler. The whole test suite was green
 * throughout.
 *
 * ⚠ AND THE THROW WAS OUTSIDE THE ROUTE'S OWN try/catch, so it never reached
 * the catch: no log line, and a bare failure for the admin. A dead feature that
 * is also silent.
 *
 * ⚠ NO DATABASE NEEDED, DELIBERATELY. The request below is rejected by
 * validation — but the normalizeName calls run BEFORE that rejection, so a
 * clean 400 is proof the identifier resolved. If it were undefined the handler
 * would throw before ever reaching the 400.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

function mount(actor) {
  const authPath = require.resolve('../middleware/auth');
  const realAuth = require(authPath);
  const saved = require.cache[authPath].exports;
  require.cache[authPath].exports = Object.assign({}, realAuth, {
    // ⚠ requireRole reads req.userProfileRole, not req.user.role
    requireAuth: (req, _res, next) => {
      req.user = { id: actor.id, role: actor.role, email: actor.id + '@test.invalid' };
      req.userProfileRole = actor.role;
      next();
    },
  });
  delete require.cache[require.resolve('../routes/admin')];
  const router = require('../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/admin', router);
  return { app, restore: () => {
    require.cache[authPath].exports = saved;
    delete require.cache[require.resolve('../routes/admin')];
  } };
}

function post(port, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const r = http.request({ port, method: 'POST', path: '/admin/users', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (r2) => {
      let d = ''; r2.on('data', (c) => { d += c; });
      r2.on('end', () => res({ status: r2.statusCode, body: d }));
    });
    r.on('error', rej); r.end(data);
  });
}

test('⚠⚠ POST /admin/users REACHES ITS VALIDATION — every identifier resolves', async () => {
  const h = mount({ id: 'owner-1', role: 'owner' });
  const server = await new Promise((r) => { const s = http.createServer(h.app); s.listen(0, () => r(s)); });
  const port = server.address().port;
  try {
    /* An email with no "@" must come back 400. Reaching that 400 means every
       line above it executed — including the normalizeName calls that were
       undefined for days. */
    const bad = await post(port, { email: 'not-an-email', first_name: 'A', last_name: 'B', role: 'user' });
    assert.strictEqual(bad.status, 400,
      'expected the validation 400; got ' + bad.status + ': ' + bad.body
      + '\nA 500 here means the handler threw BEFORE its own validation — which is '
      + 'exactly how add-user died silently.');
    assert.match(bad.body, /valid email/i);

    // and the name validation, which sits AFTER normalizeName and depends on it
    const noName = await post(port, { email: 'x@y.invalid', first_name: '  ', last_name: 'B', role: 'user' });
    assert.strictEqual(noName.status, 400, 'blank first_name must 400: ' + noName.body);
    assert.match(noName.body, /first_name/i,
      'the name check runs on the NORMALISED value, so this failing means normalizeName is broken');

    /* ⚠ NON-VACUITY: a request that passes validation must NOT come back 400 —
       otherwise these assertions would hold against a handler that rejects
       everything, which proves nothing about the identifiers. It gets as far as
       the database, which is absent here, so 503 is the expected outcome. */
    const good = await post(port, { email: 'x@y.invalid', first_name: 'Ada', last_name: 'Lovelace', role: 'user' });
    assert.notStrictEqual(good.status, 400,
      'a well-formed request must clear validation; got 400: ' + good.body);
  } finally { server.close(); h.restore(); }
});

test('⚠ a role a manager may not mint is refused, not thrown', async () => {
  const h = mount({ id: 'mgr-1', role: 'manager' });
  const server = await new Promise((r) => { const s = http.createServer(h.app); s.listen(0, () => r(s)); });
  const port = server.address().port;
  try {
    // a manager's role is forced to 'user' server-side, so this must not 400 on role
    const r = await post(port, { email: 'z@y.invalid', first_name: 'Ada', last_name: 'L', role: 'manager' });
    assert.notStrictEqual(r.status, 500,
      'a manager creating a rep must not throw; got: ' + r.body);
  } finally { server.close(); h.restore(); }
});
