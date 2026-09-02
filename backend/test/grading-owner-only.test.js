'use strict';
/* ⚠⚠ EVERY GRADING ACT IS OWNER-ONLY (Justin, 2026-09-02, overruling the
   "a rep grading their own calls is a different act" reading of the block
   before): "no I DON'T want closers or anyone but admins be able to touch
   reanalyze." Self-serve, cross-user, reanalyze, every window — owner only,
   server-side, fail closed. The control comes off the page for everyone
   else, and the line that names the backlog says who handles it. Nothing
   re-graded, nothing deleted. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const router = require('../routes/fathom.js');
const FATHOM = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8'));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

function handlerFor(p) {
  const l = router.stack.find((x) => x.route && x.route.path === p);
  assert.ok(l, 'route missing: ' + p);
  return l.route.stack[l.route.stack.length - 1].handle;
}
function call(p, role, extra) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    const req = Object.assign({ user: { id: 'actor-1' }, userProfileRole: role, params: {}, body: { scope: '30d', dry_run: true }, headers: {} }, extra || {});
    Promise.resolve().then(() => handlerFor(p)(req, res)).catch((e) => resolve({ code: 'threw', body: { error: String(e && e.message) } }));
  });
}

test('⚠⚠ SELF-SERVE IS OWNER-ONLY NOW — a rep, a manager, an unknown role: 403 naming admins', async () => {
  for (const role of ['user', 'manager', undefined]) {
    const r = await call('/update-analyses', role);
    assert.strictEqual(r.code, 403, role + ': ' + JSON.stringify(r));
    assert.ok(/admin/i.test(r.body.error), role + ': the refusal names who can: ' + r.body.error);
  }
  const ok = await call('/update-analyses', 'owner');
  assert.notStrictEqual(ok.code, 403, 'an owner passes the gate: ' + JSON.stringify(ok));
});

test('⚠⚠ /reanalyze IS OWNER-ONLY TOO — a route is a capability whether or not a button reaches it', async () => {
  for (const role of ['user', 'manager', undefined]) {
    const r = await call('/reanalyze', role);
    assert.strictEqual(r.code, 403, role + ': ' + JSON.stringify(r));
  }
  assert.notStrictEqual((await call('/reanalyze', 'owner')).code, 403);
});

test('⚠ the cross-user route stays owner-only', async () => {
  assert.strictEqual((await call('/update-analyses/:user_id', 'manager', { params: { user_id: 'rep-9' } })).code, 403);
});

test('⚠⚠ ONE GATE, EVERY CALLER — and the all-time cap inside the runner is GONE, not left dead', () => {
  const sites = [...FATHOM.matchAll(/runUpdateAnalyses\(req, res/g)].map((m) => m.index);
  assert.ok(sites.length >= 2, 'both grading routes still run the runner, saw ' + sites.length);
  sites.forEach((i) => {
    const before = FATHOM.slice(Math.max(0, i - 900), i);
    assert.ok(/ownerOnlyGrading\(req, res\)/.test(before), 'a runner call site without the shared owner gate before it');
  });
  const re = FATHOM.indexOf("router.post('/reanalyze'");
  assert.ok(/ownerOnlyGrading\(req, res\)/.test(FATHOM.slice(re, re + 700)), 'reanalyze is gated by the same helper');
  const runner = FATHOM.slice(FATHOM.indexOf('async function runUpdateAnalyses('), FATHOM.indexOf("router.post('/update-analyses'"));
  assert.ok(!/actorRole/.test(runner) && !/scopeAsked === 'all'/.test(runner) && !/max_scope/.test(runner),
    'every caller is an owner before the runner runs, so a role cap inside it could never fire — a dead check is a promise the code does not keep');
  const gate = fnBody(FATHOM, 'ownerOnlyGrading');
  assert.ok(/=== 'owner'/.test(gate) && /403/.test(gate), 'positive owner check, 403 — undefined refuses');
});

function liveControl(role, work) {
  const names = ['gradeAllowed', 'gradeAllTimeAllowed', 'gradeScopeOptionsHtml', 'gradeCostText', 'gradeScopeLabel', 'gradeBacklogControlHtml'];
  const src = names.map((n) => fnBody(LIVE, n)).join('\n');
  const cost = /GRADE_COST_PER_CALL = ([0-9.]+)/.exec(HTML);
  const fn = new Function('state', 'escapeHtml', 'isSelf', 'viewedUserLabel', 'gradeBacklogWorkCount', 'adoptRunningGrade',
    'var GRADE_COST_PER_CALL = ' + cost[1] + ';\n' + src + '\nreturn gradeBacklogControlHtml();');
  return fn({ me: { role: role, user_id: 'u1' }, gradeRun: null, gradeConfirm: null, gradeChecking: false }, (x) => String(x), () => true, () => 'this rep', () => work, () => {});
}

test('⚠⚠ THE CONTROL COMES OFF THE PAGE FOR EVERYONE BUT AN OWNER — on their OWN page too', () => {
  assert.strictEqual(liveControl('user', 40), '', 'a rep with a backlog gets no grading control');
  assert.strictEqual(liveControl('manager', 40), '', 'a manager on their own page gets none');
  const owner = liveControl('owner', 40);
  assert.ok(/value="7d"/.test(owner) && /value="30d"/.test(owner) && /value="all"/.test(owner), 'an owner keeps every window');
  assert.ok(!/limited to admins/.test(owner) && !/grade-cap-note/.test(LIVE), 'the cap note is gone — nobody it applied to can see the control');
  assert.ok(/=== 'owner'/.test(fnBody(LIVE, 'canGradeViewedUser')) && !/isSelf/.test(fnBody(LIVE, 'canGradeViewedUser')), 'self is no longer a reason to show it');
});

test('⚠⚠ THE STATE SAYS SO: the line that names the backlog names who handles it, on every site', () => {
  const helper = fnBody(LIVE, 'gradingHandledByText');
  assert.ok(/handled by an admin/i.test(helper), 'one sentence, one place');
  const calls = LIVE.slice(LIVE.indexOf("oc.ungraded + ' not graded yet"), LIVE.indexOf("oc.ungraded + ' not graded yet") + 400);
  assert.ok(/gradingHandledByText\(\)/.test(calls), 'the Calls page line carries it for non-owners');
  assert.ok(/gradingHandledByText\(\)/.test(fnBody(LIVE, 'fathomBacklogRowHtml')), 'the Connections row carries it');
  const gs = fnBody(LIVE, 'getStartedCardHtml');
  assert.ok(/gradingHandledByText\(\)/.test(gs) && /gradeAllowed\(\)/.test(gs), 'the Get Started step no longer tells a closer to grade — it says who does');
  assert.strictEqual(LIVE.indexOf('gradeAdminOnlyNoteHtml'), -1, 'the pivot-only note is folded into the one sentence');
});
