/**
 * ⚠⚠ /team/why-prose HAS NEVER WORKED. Two defects on two adjacent lines, and it
 * is the ONLY one of the ten team routes with either:
 *
 *     var admin = getAdminClient();            // never defined in team.js
 *     var team  = await resolveTeam(req, admin);  // arguments REVERSED
 *
 * `getAdminClient` is defined in auth.js, admin.js, fathom.js and me.js — but
 * not team.js, and it is not imported there either. It appears exactly ONCE in
 * the file: at the call site. So the route throws a ReferenceError on the first
 * line of its try block, every time, and always has.
 *
 * ⚠ THE FIX USES team.js's OWN `getAdmin()`, NOT AN IMPORT. Each route file
 * defines its own copy of this helper; me.js does not export its version, and
 * adding a second name for the same thing inside one file is how the confusion
 * started. The other nine routes here already call getAdmin().
 *
 * ⚠⚠ WHY THE TEST ASSERTS 503 AFTER THE FIX, AND WHY THAT IS THE STRONGER
 * ASSERTION. With no Supabase env vars set, getAdmin() throws "not configured",
 * which handleConfigError turns into a 503. Before the fix the route CANNOT
 * reach getAdmin() at all — it dies on the undefined symbol first — so it can
 * only ever produce a 500. The two codes therefore separate exactly the thing
 * under test:
 *
 *     500 "Failed to load rep summaries"  -> crashed on an undefined symbol
 *     503 "not configured"                -> ran, and reached the real work
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/* ⚠ Stub the gate in the require cache BEFORE routes/team loads. requireAuth
   decodes a real Supabase token and requireRole reads the decoded role; neither
   is what this test is about, and obtaining a real token means signing in. */
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, {
  requireAuth: function (req, _res, next) { req.user = { id: 'mgr-1', role: 'manager' }; next(); },
  requireRole: function () { return function (_req, _res, next) { next(); }; },
});

const teamRouter = require('../routes/team');

function listen() {
  const app = express();
  app.use('/team', teamRouter);
  return new Promise((res) => { const s = http.createServer(app); s.listen(0, () => res(s)); });
}
function get(port, path) {
  return new Promise((res, rej) => {
    http.get({ port, path }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: d }));
    }).on('error', rej);
  });
}

const RANGE = '?from=2026-08-01T00:00:00.000Z&to=2026-08-21T00:00:00.000Z';

test('⚠⚠ /team/why-prose reaches its real work instead of dying on an undefined symbol', async () => {
  // ⚠ Deterministic: strip the env so getAdmin() is guaranteed to be the first
  // thing that fails. Without this the assertion depends on the machine.
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const server = await listen();
  try {
    const r = await get(server.address().port, '/team/why-prose' + RANGE);
    assert.notStrictEqual(r.status, 500,
      'why-prose returned 500 — it is still crashing before it reaches getAdmin(). Body: ' + r.body);
    assert.strictEqual(r.status, 503,
      'expected the "not configured" boundary, meaning the handler ran. Got ' + r.status + ': ' + r.body);
    assert.ok(/not configured/i.test(r.body), 'body should name the config problem: ' + r.body);
  } finally {
    server.close();
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('⚠ NON-VACUITY: a neighbouring route already behaves this way', async () => {
  // If /overview did NOT return 503 here, the assertion above would be testing
  // the harness rather than the route — so pin the known-good comparison.
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const server = await listen();
  try {
    const r = await get(server.address().port, '/team/overview' + RANGE);
    assert.strictEqual(r.status, 503, '/overview is the working reference: ' + r.status + ' ' + r.body);
  } finally {
    server.close();
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('⚠ the undefined helper is gone, and the argument order matches every other caller', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  const live = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
                  .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.strictEqual((live.match(/getAdminClient/g) || []).length, 0,
    'getAdminClient is not defined, imported or exported anywhere reachable from team.js');

  // ⚠ resolveTeam(admin, req): the body reads req.user/req.query off the SECOND
  // parameter and calls admin.from() on the FIRST. Reversed, req.user is
  // undefined and it throws — a second latent bug that only surfaces once the
  // ReferenceError above is fixed, which is why both had to go together.
  assert.strictEqual((live.match(/resolveTeam\(req,\s*admin\)/g) || []).length, 0,
    'a caller still passes resolveTeam(req, admin) — arguments reversed');
  assert.ok((live.match(/resolveTeam\(admin,\s*req\)/g) || []).length >= 9,
    'every caller should pass (admin, req)');
});
