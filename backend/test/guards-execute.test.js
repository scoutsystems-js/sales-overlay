'use strict';
/* ⚠⚠ FIX #2 — THE GUARDS ON MONEY AND ACCESS EXECUTE THE ROUTE AND ASSERT THE
   CONSEQUENCE (the standing rule, H666). Sweep block 2 (H665) showed the text
   guards for these routes stayed green when the gate was called and its answer
   ignored; block 5 (H670) showed `cross-user-grading` also passed with the gate
   commented out. Nothing here reads source. Each test forges the actor BELOW the
   credential (requireAuth is replaced; req.user and req.userProfileRole are set by
   the test), sends a real HTTP request to the mounted router, and asserts what
   HAPPENED: the status AND the side effect — whether the grading runner touched
   the database, whether the review builder was called, and for whom.
   ⚠ Both plants were run against this file before it shipped (H675): the gate
   removed, and the gate called with its answer discarded. Each fails here. */
/* The routes refuse to build a client without these (a 503 config error, which would
   mask every branch under test); dummy values — createClient is replaced below. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/* requireAuth decodes a real token; a forged actor has none. Replace it with a
   pass-through BEFORE the routes load; requireRole stays REAL and reads the
   req.userProfileRole the test sets — that is the branch under test. */
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); } });

/* Every route builds its admin client lazily through supabase-js createClient.
   Replace createClient before the routes load; the fake RECORDS every table it
   is asked for, so "the runner never touched the database" is assertable. */
const LOG = [];
function fakeAdmin() {
  return {
    from(table) {
      LOG.push(table);
      const chain = {
        _eq: {},
        select() { return chain; }, in(c, v) { chain._in = v; return chain; }, eq(c, v) { chain._eq[c] = v; return chain; }, not() { return chain; }, is() { return chain; },
        gte() { return chain; }, lte() { return chain; }, lt() { return chain; }, gt() { return chain; }, order() { return chain; }, range() { return chain; }, limit() { return chain; },
        update() { chain._op = 'update'; return chain; }, insert() { return chain; }, upsert() { return chain; }, delete() { return chain; },
        _op: 'select', _in: null,
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({ data: PROFILES[chain._eq.user_id] || null, error: null });
          if (table === 'dashboards' && chain._op === 'update') { UPDATES.push({ table, eq: Object.assign({}, chain._eq) }); return Promise.resolve({ data: chain._eq.user_id ? { id: chain._eq.id, name: 'renamed', pinned: false } : null, error: null }); }
          return Promise.resolve({ data: null, error: null });
        },
        single() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rowsFor(table, chain), error: null, count: 0 }).then(resolve, reject); },
      };
      return chain;
    },
  };
}
/* Rows the retry-loop test needs: two ERRORED calls for the target rep, one with a
   permanent reason and one retryable. Everything else is empty. */
const UPDATES = [];
const ERRORED = [{ id: 'err-perm', call_date: '2026-08-20T00:00:00Z' }, { id: 'err-retry', call_date: '2026-08-20T00:00:00Z' }];
const REASONS = { 'err-perm': 'Transcript fetch failed: no transcript — permanent, not retried', 'err-retry': 'Fathom 503 on transcript fetch' };
function rowsFor(table, chain) {
  if (table === 'fathom_calls' && chain._eq.sync_status === 'error') return ERRORED.map((r) => Object.assign({}, r));
  if (table === 'call_analyses' && chain._eq.status === 'error') return (chain._in || []).map((id) => ({ fathom_call_id: id, overall_summary: REASONS[id] || '' }));
  return [];
}
const sbPath = require.resolve('@supabase/supabase-js');
const realSb = require(sbPath);
require.cache[sbPath].exports = Object.assign({}, realSb, { createClient: function () { return fakeAdmin(); } });

const PROFILES = {
  owner:    { user_id: 'owner',    role: 'owner',   managed_by: null },
  mgr:      { user_id: 'mgr',      role: 'manager', managed_by: null },
  otherMgr: { user_id: 'otherMgr', role: 'manager', managed_by: null },
  rep:      { user_id: 'rep',      role: 'user',    managed_by: 'mgr' },
  stranger: { user_id: 'stranger', role: 'user',    managed_by: 'otherMgr' },
};
const fathomRoutes = require('../routes/fathom');
const adminRoutes = require('../routes/admin');
const meRoutes = require('../routes/me');
const teamRoutes = require('../routes/team');
if (adminRoutes._setAdminClientForTests) adminRoutes._setAdminClientForTests(fakeAdmin());

function appFor(actorId) {
  const app = express();
  app.use(express.json());
  app.use(function (req, _res, next) { req.user = { id: actorId, role: PROFILES[actorId].role }; req.userProfileRole = PROFILES[actorId].role; next(); });
  app.use('/fathom', fathomRoutes);
  app.use('/admin', adminRoutes);
  app.use('/team', teamRoutes);
  return app;
}
function send(app, method, path, body) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app).listen(0, function () {
      const payload = body ? JSON.stringify(body) : '';
      const req = http.request({ port: server.address().port, path, method, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, function (res) {
        let data = ''; res.on('data', (d) => { data += d; });
        res.on('end', function () { server.close(); let j = null; try { j = JSON.parse(data); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
      });
      req.on('error', function (e) { server.close(); reject(e); });
      req.end(payload);
    });
  });
}

/* ══ 1 · SPEND — grading is owner-only, and a refusal DISPATCHES NOTHING ═══════ */
test('⚠⚠ manager grading a rep → 403 AND the runner never touches the database', async () => {
  LOG.length = 0;
  const r = await send(appFor('mgr'), 'POST', '/fathom/update-analyses/rep', { dry_run: true });
  assert.strictEqual(r.status, 403, 'grading is limited to admins');
  assert.deepStrictEqual(LOG, [], 'after the 403 the runner must not run — a gate whose answer is ignored dispatches anyway');
});
test('⚠⚠ a rep grading THEMSELVES → 403 AND nothing dispatched (every grading act is owner-only)', async () => {
  LOG.length = 0;
  const r = await send(appFor('rep'), 'POST', '/fathom/update-analyses', { dry_run: true });
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(LOG, []);
});
test('⚠ NON-VACUITY: the owner is let through and the runner DOES run (dry run answers with a count)', async () => {
  LOG.length = 0;
  const r = await send(appFor('owner'), 'POST', '/fathom/update-analyses/rep', { dry_run: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(typeof r.body.count === 'number', 'a dry run returns the count');
  assert.ok(LOG.length > 0, 'the runner read the database — so the refusals above are not passing by accident');
});

/* ══ 2 · CROSS-USER DATA — a manager reads only the reps they manage ═══════════ */
let REVIEW_CALLS = [];
const realLoad = fathomRoutes._loadCallReview;
fathomRoutes._loadCallReview = async function (admin, callId, ownerUserId) { REVIEW_CALLS.push({ callId, ownerUserId }); return { status: 200, body: { ok: true, call: callId, owner: ownerUserId } }; };
test('⚠⚠ manager → a rep they do NOT manage: 403 AND the review builder is never called', async () => {
  REVIEW_CALLS = [];
  const r = await send(appFor('mgr'), 'GET', '/admin/fathom-calls/stranger/call-1');
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(REVIEW_CALLS, [], 'a dead scope check still returns the call');
});
test('⚠ manager → their own rep: 200 and the builder is called FOR THAT REP', async () => {
  REVIEW_CALLS = [];
  const r = await send(appFor('mgr'), 'GET', '/admin/fathom-calls/rep/call-1');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(REVIEW_CALLS, [{ callId: 'call-1', ownerUserId: 'rep' }]);
});
test('⚠ owner → anyone: 200', async () => {
  REVIEW_CALLS = [];
  const r = await send(appFor('owner'), 'GET', '/admin/fathom-calls/stranger/call-2');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(REVIEW_CALLS.length, 1);
});
test('⚠ a rep is refused by the role gate before scope is even asked', async () => {
  REVIEW_CALLS = [];
  const r = await send(appFor('rep'), 'GET', '/admin/fathom-calls/rep/call-1');
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(REVIEW_CALLS, []);
});

let SECTION_CALLS = [];
meRoutes._computeNeedsWorkSections = async function (admin, userId, from, to) { SECTION_CALLS.push(userId); return { sections: [], for: userId }; };
test('⚠⚠ manager → needs-work sections of a rep they do NOT manage: 403 AND nothing computed', async () => {
  SECTION_CALLS = [];
  const r = await send(appFor('mgr'), 'GET', '/admin/needs-work-sections/stranger');
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(SECTION_CALLS, []);
});
test('⚠ manager → their own rep: 200, computed for that rep', async () => {
  SECTION_CALLS = [];
  const r = await send(appFor('mgr'), 'GET', '/admin/needs-work-sections/rep');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(SECTION_CALLS, ['rep']);
});
test('⚠ owner → anyone: 200', async () => {
  SECTION_CALLS = [];
  const r = await send(appFor('owner'), 'GET', '/admin/needs-work-sections/stranger');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(SECTION_CALLS, ['stranger']);
});
/* ══ 3 · THE RETRY LOOP — the batch reaches RETRYABLE failures only ═══════════ */
test('⚠⚠ a dry run counts the retryable failure and NOT the permanent one', async () => {
  const r = await send(appFor('owner'), 'POST', '/fathom/update-analyses/rep', { dry_run: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.failed, 1, 'two errored calls, one permanent ("— permanent, not retried") — the batch must carry exactly the retryable one; a classifier whose answer is ignored re-dispatches both, forever');
});

/* ══ 4 · BOARDS — the rename UPDATE carries the caller; the delete asks first ══ */
test('⚠⚠ renaming a board UPDATES with the caller\'s user_id in the filter', async () => {
  UPDATES.length = 0;
  const r = await send(appFor('mgr'), 'PATCH', '/team/dashboard/b1/name', { name: 'Q3' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(UPDATES.length, 1, 'exactly one update reached the table');
  assert.strictEqual(UPDATES[0].eq.id, 'b1');
  assert.strictEqual(UPDATES[0].eq.user_id, 'mgr', 'the UPDATE itself must be scoped to the caller — a scope on a lookup beside it renames someone else\'s board');
});

const fs = require('node:fs'); const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const HTML = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
function grab(start, end) { const a = HTML.indexOf(start); assert.ok(a > -1, 'stale anchor: ' + start); const b = HTML.indexOf(end, a); assert.ok(b > a, 'stale end: ' + end); return HTML.slice(a, b + end.length); }
/* Executes a page function inside a `with` scope whose unknown names resolve to
   no-op stubs, so the function runs without the rest of the page. */
function pageFn(src, scope) {
  /* names the scope defines win; real globals (Array, Promise, JSON…) fall through; anything else is a no-op stub */
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(k in globalThis), get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : function () {})) });
  return new Function('__s', 'with (__s) { ' + src + '\n return { run: (typeof __run === "function") ? __run : null }; }')(proxy);
}
async function runDelete(answer) {
  const calls = [];
  const scope = { state: { teamDashboard: { board: { id: 'b1', name: 'Q3' }, cards: [1, 2] }, dashBoardId: 'b1' },
    scoutConfirm: async function () { return answer; },
    fetch: async function (url, opts) { calls.push({ url, method: opts && opts.method }); return { ok: true, json: async () => ({ ok: true }) }; },
    teamQP: () => 'x=1', authHeader: () => ({}), dashToast: () => {}, loadTeam: () => {}, renderTeamDashboard: () => {}, encodeURIComponent, console };
  const src = grab('async function dashDeleteBoard() {', '\n  }') + '\n var __run = dashDeleteBoard;';
  await pageFn(src, scope).run();
  return calls;
}
test('⚠⚠ delete a board: the dialog answers NO → NO request is sent', async () => {
  const calls = await runDelete(false);
  assert.deepStrictEqual(calls, [], 'a confirm that is awaited and then ignored deletes whatever you answer');
});
test('⚠ NON-VACUITY: the dialog answers YES → one DELETE request goes out', async () => {
  const calls = await runDelete(true);
  assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].method, 'DELETE'); assert.ok(/\/team\/dashboard\/b1/.test(calls[0].url));
});

/* ══ 5 · LAYOUT — the picker is owner-only; a stale team answer is dropped; the admin tab is restored before the first load ══ */
test('⚠⚠ the company picker renders for an OWNER and returns nothing for a MANAGER with the same context', () => {
  const src = grab('function teamSelectHtml() {', '\n  }') + '\n var __run = teamSelectHtml;';
  const teams = [{ key: 'a', label: 'Alpha', rep_count: 3, is_self: true }, { key: 'b', label: 'Beta', rep_count: 2, is_self: false }];
  const asOwner = pageFn(src, { state: { teamContext: { is_owner: true, teams }, teamSelected: null }, escapeHtml: (s) => String(s) }).run();
  const asManager = pageFn(src, { state: { teamContext: { is_owner: false, teams }, teamSelected: null }, escapeHtml: (s) => String(s) }).run();
  assert.ok(/<select[^>]*>[\s\S]*<option value="a"/.test(asOwner), 'the owner sees the picker');
  assert.strictEqual(asManager, '', 'a manager gets NOTHING — every level sees below it and nothing beside it (H160); a flag that is read but not gating renders the list to everyone');
});

test('⚠⚠ a team answer that lands after the team changed is DROPPED — state is untouched and the lane is not left loading', async () => {
  const scope = { state: { teamOverview: null, teamOverviewLoading: false, view: 'team', teamTrendBucket: 'week', teamDigestDate: null, dashBoardId: null, teamSelected: null, teamObjDrillCategory: null }, teamEpoch: 0,
    teamQP: () => 'x=1', repSeriesBucket: () => 'week', encodeURIComponent, isTeamView: () => true, renderTeamSurface: () => {}, armLaneWait: () => {}, clearLaneWait: () => {}, console,
    fetchTeamJSON: async function () { scope.teamEpoch++; /* the team changed while this request was in flight */ return { per_rep: [1, 2, 3] }; } };
  const src = grab('async function loadTeam(which) {', '\n  }') + '\n var __run = loadTeam;';
  await pageFn(src, scope).run('overview');
  assert.strictEqual(scope.state.teamOverview, null, 'the stale answer must not be stored — a comparison kept but made dead shows the wrong team\'s numbers');
  assert.strictEqual(scope.state.teamOverviewLoading, false, 'and the lane must not be left marked loading');
});
test('⚠ NON-VACUITY: with no team change in flight the answer IS stored', async () => {
  const scope = { state: { teamOverview: null, teamOverviewLoading: false, view: 'team', teamTrendBucket: 'week', teamDigestDate: null, dashBoardId: null, teamSelected: null, teamObjDrillCategory: null }, teamEpoch: 0,
    teamQP: () => 'x=1', repSeriesBucket: () => 'week', encodeURIComponent, isTeamView: () => true, renderTeamSurface: () => {}, armLaneWait: () => {}, clearLaneWait: () => {}, console,
    fetchTeamJSON: async function () { return { per_rep: [1, 2, 3] }; } };
  const src = grab('async function loadTeam(which) {', '\n  }') + '\n var __run = loadTeam;';
  await pageFn(src, scope).run('overview');
  assert.deepStrictEqual(scope.state.teamOverview, { per_rep: [1, 2, 3] });
});

function el() { return { textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, setAttribute() {}, value: '' }; }
const ADMIN_HTML = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8'));
test('⚠⚠ admin init(): the tab is restored from the hash BEFORE the first load runs — executed, not read for order', async () => {
  const a = ADMIN_HTML.indexOf('async function init() {'); assert.ok(a > -1, 'stale anchor: init');
  const src = ADMIN_HTML.slice(a, ADMIN_HTML.indexOf('\n  }', a) + 4) + '\n var __run = init;';
  const order = [];
  const scope = { getSession: () => ({ email: 'j@x', refresh_token: 'r' }), isSessionValid: () => true, refreshSessionIfNeeded: async () => true, clearSession: () => {}, window: { location: { replace: () => {} } },
    document: { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener: () => {}, body: el() }, fetchMe: async () => ({ role: 'owner' }), readAdminTabFromHash: () => { order.push('restore'); return 'companies'; }, loadUsers: async () => { order.push('load'); }, console };
  await pageFn(src, scope).run();
  assert.ok(order.indexOf('restore') > -1, 'the restore must RUN, not merely sit above the load in the source');
  assert.ok(order.indexOf('load') > -1, 'the load must run');
  assert.ok(order.indexOf('restore') < order.indexOf('load'), 'restored BEFORE the first load');
});

test.after(function () { fathomRoutes._loadCallReview = realLoad; });
