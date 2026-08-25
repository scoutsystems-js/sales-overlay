/**
 * ⚠⚠ ALL-TIME GRADING IS OWNER-ONLY, ENFORCED SERVER-SIDE AND EXERCISED OVER HTTP.
 *
 * Justin's ruling (2026-08-25): "just for Josh he has the ability to go back all
 * time but everyone else moving forward only gets 30 days due to API costs."
 * ROLE answers this — no per-user flag. The boundary is at `owner`, which is this
 * codebase's platform-admin role (the Admin nav is owner-only for the same reason).
 *
 * ⚠ THE TRIAL ACCOUNT IS A `manager`, NOT A `user` — measured on live data. So a
 * rule phrased as "anyone who is not a plain user" would have handed all-time to
 * exactly the account the ruling caps. The check is `=== 'owner'`, positively.
 *
 * ⚠ HIDING THE OPTION IS NOT A RESTRICTION. The client omits it; this is what
 * makes it a rule. The actor is forged ahead of the router — see
 * not-sales-http.test.js for why that is the correct substitute for signing in.
 *
 * ⚠ IT MUST REFUSE, NOT SILENTLY TRUNCATE. A request for all-time answered with
 * 30 days would spend less than asked and report success — the user would believe
 * their whole history was graded when most of it was not.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, {
  requireAuth: function (req, _res, next) { next(); },
});

const fathomRouter = require('../routes/fathom');

/** Drive the real route with a forged actor of the given profile role. */
function callAs(role, body) {
  const app = express();
  app.use(express.json());
  app.use(function (req, _res, next) {
    req.user = { id: 'u1', role: role };
    req.userProfileRole = role;   // what requireAuth stamps from user_profiles
    next();
  });
  app.use('/fathom', fathomRouter);
  const server = app.listen(0);
  const port = server.address().port;
  const payload = JSON.stringify(body);
  return new Promise(function (resolve, reject) {
    const req = http.request({
      port, path: '/fathom/update-analyses', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, function (res) {
      let raw = '';
      res.on('data', (d) => { raw += d; });
      res.on('end', function () {
        server.close();
        let parsed = null; try { parsed = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', function (e) { server.close(); reject(e); });
    req.end(payload);
  });
}

test('a plain user asking for all-time is REFUSED, not truncated', async () => {
  const r = await callAs('user', { scope: 'all' });
  assert.strictEqual(r.status, 403, 'expected 403, got ' + r.status);
  assert.match(String(r.body && r.body.error), /all|admin|owner/i);
});

test('a MANAGER asking for all-time is refused — the trial account is a manager', async () => {
  const r = await callAs('manager', { scope: 'all' });
  assert.strictEqual(r.status, 403, 'expected 403, got ' + r.status);
});

test('a dry run of all-time is refused too — pricing it is not a loophole', async () => {
  const r = await callAs('manager', { scope: 'all', dry_run: true });
  assert.strictEqual(r.status, 403, 'expected 403, got ' + r.status);
});

test('FAIL CLOSED: an unresolved role is refused (requireAuth fails OPEN on a DB error)', async () => {
  const r = await callAs(undefined, { scope: 'all' });
  assert.strictEqual(r.status, 403, 'an unknown role must not get all-time');
});

/* ⚠ NON-VACUITY, and it is the load-bearing half: a handler that 403'd everything
   would pass every assertion above. These prove the gate is a gate. They are NOT
   asserted to succeed — with no Supabase configured the route answers 503 — only
   that they are not refused BY THE ROLE CHECK. */
test('an OWNER asking for all-time is not refused by the role check', async () => {
  const r = await callAs('owner', { scope: 'all', dry_run: true });
  assert.notStrictEqual(r.status, 403, 'an owner must pass the all-time gate');
});

test('a plain user asking for 30d is not refused — only all-time is capped', async () => {
  const r = await callAs('user', { scope: '30d', dry_run: true });
  assert.notStrictEqual(r.status, 403, '30d must remain available to everyone');
});

test('a plain user asking for 7d is not refused', async () => {
  const r = await callAs('user', { scope: '7d', dry_run: true });
  assert.notStrictEqual(r.status, 403, '7d must remain available to everyone');
});
