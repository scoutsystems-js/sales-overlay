/**
 * THE REVIEW QUEUE (Justin's ruling 2026-09-03, H712), EXECUTED OVER HTTP with forged actors:
 * a closer is refused (the H352 shape Justin has not ruled); a manager sees their team's
 * pending "not a sales call" verdicts with the reason; CONFIRM goes through the ONE mark
 * (exactly one fathom_calls update, by the lib) and stamps the review; CORRECT stamps only
 * and touches no call; a call outside the team is refused. Plus the one-remover source guard
 * and the panel rendered from a fixture.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); }, requireSubscription: function (_req, _res, next) { next(); } });

const PROFILES = [{ user_id: 'A', managed_by: 'mgr', role: 'user', active: true, first_name: 'Ava', last_name: 'Reyes', team_name: null },
  { user_id: 'mgr', managed_by: null, role: 'manager', active: true, first_name: 'Mia', last_name: null, team_name: 'Team' },
  { user_id: 'Z', managed_by: 'other', role: 'user', active: true, first_name: 'Zed', last_name: null, team_name: null }];
function world() {
  const calls = { c1: { id: 'c1', user_id: 'A', title: 'SLR Team Meeting', call_date: '2026-09-02T10:00:00Z', not_a_sales_call: null, duplicate_of: null },
    c2: { id: 'c2', user_id: 'A', title: 'Morning Meeting', call_date: '2026-09-01T10:00:00Z', not_a_sales_call: true, duplicate_of: null },
    c3: { id: 'c3', user_id: 'A', title: 'GARR & SLRiches', call_date: '2026-08-30T10:00:00Z', not_a_sales_call: null, duplicate_of: null },
    cz: { id: 'cz', user_id: 'Z', title: 'Elsewhere', call_date: '2026-09-02T10:00:00Z', not_a_sales_call: null, duplicate_of: null } };
  const analyses = { c1: { fathom_call_id: 'c1', sales_call_verdict: 'not_sales', sales_call_reason: 'two internal staff, no prospect present', sales_call_reason_class: 'no_prospect_internal_staff', sales_call_review: null },
    c2: { fathom_call_id: 'c2', sales_call_verdict: 'not_sales', sales_call_reason: 'a standup', sales_call_reason_class: 'no_prospect_internal_staff', sales_call_review: 'confirmed' },
    c3: { fathom_call_id: 'c3', sales_call_verdict: 'not_sales', sales_call_reason: 'a regulator doing due diligence, nobody being sold to', sales_call_reason_class: 'no_prospect_internal_staff', sales_call_review: null },
    cz: { fathom_call_id: 'cz', sales_call_verdict: 'not_sales', sales_call_reason: 'x', sales_call_reason_class: 'recording_stub', sales_call_review: null } };
  const log = [];
  const admin = { auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'A', email: 'ava@x.io' }, { id: 'mgr', email: 'mia@x.io' }, { id: 'Z', email: 'zed@x.io' }] }, error: null }) } },
    from(table) {
      const ch = { f: {}, _in: null, _op: 'select', _p: null, isNull: {},
        select() { return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; }, insert(p) { ch._op = 'insert'; ch._p = p; return ch; },
        eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, not() { return ch; }, is(k, v) { ch.isNull[k] = v; return ch; }, order() { return ch; }, limit() { return ch; }, range() { return ch; }, gte() { return ch; }, lte() { return ch; },
        maybeSingle() { return ch.then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
        single() { return ch.then((r) => ({ data: (r.data || [])[0] || null, error: (r.data || []).length ? null : { message: 'no row' } })); },
        then(res, rej) {
          let rows = [];
          const filt = (list, key) => list.filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]) && (!ch._in || ch._in[1].indexOf(r[ch._in[0]]) !== -1));
          if (table === 'user_profiles') rows = filt(PROFILES.slice());
          else if (table === 'fathom_calls') { rows = filt(Object.values(calls)); if (ch._op === 'update') { rows.forEach((r) => Object.assign(r, ch._p)); log.push({ table, patch: ch._p, filters: ch.f }); } }
          else if (table === 'call_analyses') { rows = filt(Object.values(analyses)); if (ch._op === 'update') { rows.forEach((r) => Object.assign(r, ch._p)); log.push({ table, patch: ch._p, filters: ch.f }); } }
          else if (table === 'knowledge_base' || table === 'call_highlights') { rows = []; if (ch._op === 'update' || ch._op === 'delete') log.push({ table, patch: ch._p }); }
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        }, delete() { ch._op = 'delete'; return ch; } };
      return ch;
    } };
  return { admin, calls, analyses, log };
}
function appFor(actorId, role, w) {
  const teamRoutes = require('../routes/team'); teamRoutes._setAdminClientForTests(() => w.admin);
  const a = express(); a.use(express.json());
  a.use(function (req, _res, next) { req.user = { id: actorId, role }; req.userProfileRole = role; next(); });
  a.use('/team', teamRoutes); return a;
}
function call(app, method, p, body) { return new Promise((resolve, reject) => { const server = http.createServer(app).listen(0, () => { const payload = body ? JSON.stringify(body) : null;
  const req = http.request({ port: server.address().port, path: p, method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', () => { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); });
  req.on('error', (e) => { server.close(); reject(e); }); if (payload) req.write(payload); req.end(); }); }); }

test('⚠⚠ a closer is refused on both routes (managers and above only — the H352 shape is unruled)', async () => {
  const w = world();
  assert.strictEqual((await call(appFor('A', 'user', w), 'GET', '/team/verdict-queue')).status, 403);
  assert.strictEqual((await call(appFor('A', 'user', w), 'POST', '/team/verdict-review', { call_id: 'c1', decision: 'confirm' })).status, 403);
  assert.strictEqual(w.log.length, 0, 'nothing written on refusal');
});

test('⚠⚠ a manager sees the team\'s PENDING verdicts with the reason; confirmed and corrected are counted separately; other teams are invisible', async () => {
  const w = world();
  const r = await call(appFor('mgr', 'manager', w), 'GET', '/team/verdict-queue');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.pending.map((p) => p.call_id), ['c1', 'c3'], 'pending, newest first, own team only');
  assert.strictEqual(r.body.pending[0].reason, 'two internal staff, no prospect present');
  assert.deepStrictEqual(r.body.counts, { pending: 2, confirmed: 1, corrected: 0 });
});

test('⚠⚠ CONFIRM goes through the ONE mark — exactly one fathom_calls update, by the lib, with the manager stamped — and the review is stamped; CORRECT stamps only and touches no call', async () => {
  const w = world();
  const ok = await call(appFor('mgr', 'manager', w), 'POST', '/team/verdict-review', { call_id: 'c1', decision: 'confirm' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  const marks = w.log.filter((l) => l.table === 'fathom_calls');
  assert.strictEqual(marks.length, 1, 'exactly one mark');
  assert.strictEqual(marks[0].patch.not_a_sales_call, true); assert.strictEqual(marks[0].patch.not_sales_marked_by, 'mgr'); assert.strictEqual(marks[0].patch.not_sales_marked_role, 'manager');
  assert.strictEqual(w.calls.c1.not_a_sales_call, true);
  assert.strictEqual(w.analyses.c1.sales_call_review, 'confirmed'); assert.strictEqual(w.analyses.c1.sales_call_reviewed_by, 'mgr');
  w.log.length = 0;
  const corr = await call(appFor('mgr', 'manager', w), 'POST', '/team/verdict-review', { call_id: 'c3', decision: 'correct' });
  assert.strictEqual(corr.status, 200);
  assert.strictEqual(w.log.filter((l) => l.table === 'fathom_calls').length, 0, 'a correction never touches the call');
  assert.strictEqual(w.analyses.c3.sales_call_review, 'corrected'); assert.strictEqual(w.calls.c3.not_a_sales_call, null);
  const after = await call(appFor('mgr', 'manager', w), 'GET', '/team/verdict-queue');
  assert.deepStrictEqual(after.body.counts, { pending: 0, confirmed: 2, corrected: 1 });
});

test('⚠ a call outside the manager\'s team is refused; a bad decision is a 400', async () => {
  const w = world();
  assert.strictEqual((await call(appFor('mgr', 'manager', w), 'POST', '/team/verdict-review', { call_id: 'cz', decision: 'confirm' })).status, 403);
  assert.strictEqual((await call(appFor('mgr', 'manager', w), 'POST', '/team/verdict-review', { call_id: 'c1', decision: 'maybe' })).status, 400);
  assert.strictEqual(w.log.length, 0);
});

test('⚠⚠ ONE REMOVER: no route writes not_a_sales_call itself — only lib/not-sales-mark.js does', () => {
  ['routes/me.js', 'routes/team.js', 'routes/eod.js', 'routes/fathom.js'].forEach((f) => {
    const src = stripComments(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    assert.ok(!/not_a_sales_call:\s*(marked|true|false|a\.marked)/.test(src), f + ' must not write the flag itself');
  });
  const lib = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'not-sales-mark.js'), 'utf8'));
  assert.ok(/not_a_sales_call:\s*a\.marked === true/.test(lib), 'the lib is the one writer');
  const me = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8'));
  assert.ok(/markNotSalesCall\(admin, \{ callId: callId, ownerId: ownerId, actor: actor, ownerProfile: ownerProfile, marked: marked \}\)/.test(me), 'the button route calls the lib');
});

test('⚠ the panel renders from a fixture: the reason in plain language, three actions per row, and an honest empty state', () => {
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const fn = new Function('escapeHtml', 'formatNaturalDate', fnBody(LIVE, 'verdictQueueHtml') + '\n return verdictQueueHtml;')((s) => String(s), () => 'Sep 2');
  const html = fn({ pending: [{ call_id: 'c1', user_id: 'A', title: 'SLR Team Meeting', call_date: '2026-09-02', rep: 'Ava', reason: 'two internal staff, no prospect present' }], counts: { pending: 1, confirmed: 4, corrected: 1 } });
  assert.ok(/two internal staff, no prospect present/.test(html) && /1 to review · 4 confirmed · 1 corrected/.test(html));
  assert.ok(/reviewVerdict\('c1', 'confirm'\)/.test(html) && /reviewVerdict\('c1', 'correct'\)/.test(html) && /openCallReview\('c1', 'A'\)/.test(html), 'confirm, correct, open — Open names the call\'s OWNER (H723: a manager opening a rep\'s call must pivot first)');
  assert.ok(!/verdict|classifier|grader|not_sales/.test(html.replace(/reviewVerdict/g, '')), 'no internal words for a customer');
  assert.ok(/Nothing waiting/.test(fn({ pending: [], counts: { pending: 0, confirmed: 0, corrected: 0 } })));
});
