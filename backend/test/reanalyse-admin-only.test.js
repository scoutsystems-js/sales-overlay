'use strict';
/* ⚠⚠ RE-ANALYSING ANOTHER USER'S CALLS IS ADMIN-ONLY (Justin, 2026-09-02).
   It NARROWS the 2026-08-28 ruling (managers and above, 30 days, on the Calls
   page) — WHO changes, WHAT does not. The self-serve control is untouched: a
   rep grading their own calls is a different act, and it is how Godwin's
   backlog was actually cleared. Reason, recorded so it is not softened later:
   re-analysing spends money on someone else's account, and once onboarding
   exists a manager with a re-analyse button and a growing team is an unbounded
   spend path. Enforced SERVER-SIDE, like all-time: a hidden button is a
   suggestion. These drive the REAL route handler with a forged actor — the
   layer below the credential — and assert the status, not the source. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const router = require('../routes/fathom.js');
const FATHOM = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8'));
const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));

function handlerFor(p) {
  const l = router.stack.find((x) => x.route && x.route.path === p);
  assert.ok(l, 'route missing: ' + p);
  return l.route.stack[l.route.stack.length - 1].handle;
}
function callCross(role) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    const req = { user: { id: 'actor-1' }, userProfileRole: role, params: { user_id: 'rep-9' }, body: { scope: '30d', dry_run: true }, headers: {} };
    Promise.resolve().then(() => handlerFor('/update-analyses/:user_id')(req, res)).catch((e) => resolve({ code: 'threw', body: { error: String(e && e.message) } }));
  });
}

test('⚠⚠ A MANAGER IS REFUSED (403) — and told it is an admin action', async () => {
  const r = await callCross('manager');
  assert.strictEqual(r.code, 403, JSON.stringify(r));
  assert.ok(/admin/i.test(r.body.error), 'the refusal names who can: ' + r.body.error);
});

test('⚠⚠ A PLAIN USER AND AN UNKNOWN ROLE ARE REFUSED — fail closed', async () => {
  assert.strictEqual((await callCross('user')).code, 403);
  assert.strictEqual((await callCross(undefined)).code, 403, 'requireAuth fails OPEN on a DB blip; undefined must refuse');
});

test('⚠ AN OWNER PASSES THE GATE (whatever happens next is not the gate)', async () => {
  const r = await callCross('owner');
  assert.notStrictEqual(r.code, 403, 'an owner must not be refused by the role gate: ' + JSON.stringify(r));
});

test('⚠⚠ THE MATRIX IS ONE ROW (2026-09-02): every grading act, every window, every user — owner only', () => {
  const at = FATHOM.indexOf("router.post('/update-analyses/:user_id'");
  const cross = FATHOM.slice(at, FATHOM.indexOf('\n});', at));
  assert.ok(/ownerOnlyGrading\(req, res\)/.test(cross), 'cross-user: the one gate');
  assert.ok(!/managed_by/.test(cross), 'no team boundary — a dead check is a promise the code does not keep');
  const selfAt = FATHOM.indexOf("router.post('/update-analyses', requireAuth");
  const self = FATHOM.slice(selfAt, FATHOM.indexOf('\n});', selfAt));
  assert.ok(/ownerOnlyGrading\(req, res\)/.test(self), 'self-serve: the same gate — a rep no longer grades their own');
  assert.ok(/runUpdateAnalyses\(req, res, req\.user\.id\)/.test(self), 'and it still names only the caller');
  assert.ok(!/scopeAsked === 'all'/.test(FATHOM), 'the all-time cap inside the runner is gone — every caller is already an owner');
});

test('⚠⚠ WHAT EVERYONE BUT AN OWNER SEES: no control, and the line that names the backlog says who handles it', () => {
  const gate = fnBody(LIVE, 'canGradeViewedUser');
  assert.ok(/=== 'owner'/.test(gate) && !/manager/.test(gate) && !/isSelf/.test(gate), 'owner only, self or pivot');
  const site = LIVE.slice(LIVE.indexOf('var gradeHost ='), LIVE.indexOf('var outcomeControl ='));
  assert.ok(/: ''/.test(site) && !/gradeAdminOnlyNoteHtml/.test(site), 'no host and no separate note — the sentence rides on the count line');
  const text = new Function(fnBody(LIVE, 'gradingHandledByText') + '\nreturn gradingHandledByText();')();
  assert.ok(/handled by an admin/i.test(text), 'the sentence: ' + text);
});
