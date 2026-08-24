/**
 * DELETE /admin/users/:user_id — the gate, over real HTTP, with forged actors.
 *
 * ⚠⚠ A PREDICATE PROVEN IN ISOLATION IS NOT AN API BOUNDARY. `canManageTarget`
 * and `deletePlan` are unit-tested next door; neither tells you whether the
 * ROUTE refuses a closer. This drives the real router over a real socket and
 * asserts on the status code.
 *
 * ⚠ Hiding a button is not a permission check — and this is the one route in
 * the app that can end an account, so the boundary is the whole feature.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/**
 * Mount the REAL admin router with only the token decode stubbed.
 *
 * ⚠ requireRole reads `req.userProfileRole`, NOT `req.user.role` — the latter
 * holds Supabase's JWT claim ("authenticated") until requireAuth overwrites it.
 * Stamping only `req.user.role` sends the request to a DB lookup and returns
 * 503, which reads exactly like a passing gate failing for an unrelated reason.
 */
function withActor(actorRef) {
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
  const app = express();
  app.use(express.json());
  app.use('/admin', router);
  return {
    app: app,
    restore: () => {
      require.cache[authPath].exports = saved;
      delete require.cache[require.resolve('../routes/admin')];
    },
  };
}

/* ⚠ `agent: false` — a fresh socket per request. Reusing a keep-alive socket
   across these calls produced an ECONNRESET that looked like a route failure
   and was purely a client-side artifact of the test harness. The body is sent
   because the real client sends one. */
function del(port, uid) {
  return new Promise((res, rej) => {
    const r = http.request({ port, method: 'DELETE', path: '/admin/users/' + uid, agent: false,
      headers: { 'Content-Type': 'application/json' } }, (r2) => {
      let d = ''; r2.on('data', (c) => { d += c; });
      r2.on('end', () => res({ status: r2.statusCode, body: d }));
    });
    r.on('error', rej); r.end('{}');
  });
}

test('⚠⚠ A CLOSER AND A MANAGER ARE BOTH REFUSED BY THE API', async () => {
  const actor = { current: { id: 'closer-1', role: 'user' } };
  const h = withActor(actor);
  const server = await new Promise((r) => { const s = http.createServer(h.app); s.listen(0, () => r(s)); });
  const port = server.address().port;
  const TARGET = '00000000-0000-4000-8000-000000000123';

  try {
    const closer = await del(port, TARGET);
    assert.strictEqual(closer.status, 403,
      'a closer must be refused. Got ' + closer.status + ': ' + closer.body);

    /* ⚠ A MANAGER TOO. This is the case a reader will assume is allowed —
       managers can deactivate their own reps — and Justin's ruling is
       ADMIN-only, which in this codebase's role model means `owner`. */
    actor.current = { id: 'mgr-1', role: 'manager' };
    const mgr = await del(port, TARGET);
    assert.strictEqual(mgr.status, 403,
      'a manager must be refused too. Got ' + mgr.status + ': ' + mgr.body);

    /* ⚠⚠ NON-VACUITY: an actor who SHOULD get past the gate must not be
       refused, or this passes against a route that refuses everyone — including
       the admins it exists for. The owner gets past requireRole and then fails
       on the absent database, which is a DIFFERENT failure and exactly the
       point: 403 is the gate, 5xx is everything after it. */
    actor.current = { id: 'owner-1', role: 'owner' };
    const owner = await del(port, TARGET);
    assert.notStrictEqual(owner.status, 403,
      'an owner must clear the gate; got 403, so the test proves nothing about roles');
  } finally {
    server.close();
    h.restore();
  }
});

test('⚠ an owner cannot delete THEMSELVES — checked before any role work', async () => {
  const actor = { current: { id: 'owner-1', role: 'owner' } };
  const h = withActor(actor);
  const server = await new Promise((r) => { const s = http.createServer(h.app); s.listen(0, () => r(s)); });
  const port = server.address().port;
  try {
    const self = await del(port, 'owner-1');
    assert.strictEqual(self.status, 400, 'deleting yourself must be refused: ' + self.body);
    assert.match(self.body, /your own account/i);
  } finally { server.close(); h.restore(); }
});

/* ── the confirmation, as written ──────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// line comments BEFORE block comments — a `/*` inside a `//` is a false opener
const LIVE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fn(name) {
  const at = LIVE.indexOf(name);
  assert.ok(at > -1, 'stale anchor: ' + name);
  const end = LIVE.indexOf('\n  }', at);   // fromIndex ALWAYS
  assert.ok(end > at, 'end marker not found after ' + name);
  const src = LIVE.slice(at, end + 4);
  assert.ok(src.length > 200 && src.length < 6000, name + ' slice length ' + src.length);
  return src;
}

test('⚠⚠ AN IRREVERSIBLE DELETE CANNOT HAPPEN FROM ONE CLICK', () => {
  const src = fn('async function deleteMember');
  assert.ok(src.indexOf('confirm(') !== -1, 'step 1: a confirmation');
  assert.ok(/window\.prompt\(/.test(src), 'step 2: a typed confirmation');
  assert.ok(/toUpperCase\(\) !== 'DELETE'/.test(src), 'and it must actually be checked');

  /* ⚠ THE TYPED STEP WAS REMOVED IN JULY as "redundant friction — delete is
     already owner-only AND zero-history-gated". This ruling removes the
     zero-history gate, so the premise for dropping it is gone. */
  assert.ok(src.indexOf('cannot be undone') !== -1, 'and it must say it is irreversible');
});

test('⚠⚠ THE WARNING NAMES WHO, HOW MANY CALLS, AND WHAT SURVIVES', () => {
  const src = fn('async function deleteMember');
  assert.ok(/p\.email \|\| email/.test(src), 'who');
  assert.ok(/p\.calls/.test(src), 'how many calls');
  assert.ok(/THEIR CALLS STAY/.test(src), 'that the calls remain');
  assert.ok(/THE PERSON GOES/.test(src), 'and that the person does not');
  assert.ok(/p\.renders_as/.test(src), 'and what the surviving rows will be labelled');

  /* ⚠ THE OLD TEXT SAID BOTH OF THESE AND BOTH ARE NOW FALSE. A stale warning
     on a destructive action is worse than none — it is read and believed. */
  assert.strictEqual(/removes their account and all their data/.test(LIVE), false,
    'the old "all their data" claim must be gone — the calls now survive');
  assert.strictEqual(/Only allowed if they have no call history/.test(LIVE), false,
    'and the old zero-history claim, which is no longer the rule');
});

test('⚠ the dialog is built from the SERVER plan, not a client guess', () => {
  const src = fn('async function deleteMember');
  assert.ok(src.indexOf('/delete-preview') !== -1,
    'the confirmation and the delete must come from one deletePlan, or the warning '
    + 'can promise something different from what the route does');
  assert.ok(/p\.mode === 'blocked'/.test(src), 'a blocked user must be told, not shown a delete dialog');
});
