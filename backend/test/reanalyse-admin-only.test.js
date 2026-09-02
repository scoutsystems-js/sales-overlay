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

test('⚠⚠ THE MATRIX, PINNED: self-serve any user · cross-user owner only · all-time owner only', () => {
  const at = FATHOM.indexOf("router.post('/update-analyses/:user_id'");
  const cross = FATHOM.slice(at, FATHOM.indexOf('\n});', at));
  assert.ok(/role !== 'owner'/.test(cross), 'cross-user: owner only');
  assert.ok(!/role !== 'manager'/.test(cross), 'no manager grant remains');
  assert.ok(!/managed_by/.test(cross), 'no team boundary is needed once only owners pass — a dead check is a false promise');
  const selfAt = FATHOM.indexOf("router.post('/update-analyses', requireAuth");
  const self = FATHOM.slice(selfAt, FATHOM.indexOf('\n});', selfAt));
  assert.ok(/runUpdateAnalyses\(req, res, req\.user\.id/.test(self), 'self-serve untouched: any authenticated user, own calls');
  assert.ok(!/role/.test(self), 'self-serve has no role gate of its own');
  assert.ok(/scopeAsked === 'all' && actorRole !== 'owner'/.test(FATHOM), 'all-time owner only, on the actor\'s role, inside the shared runner');
});

test('⚠⚠ WHAT A MANAGER SEES: the control is gone AND the page says why and what to do', () => {
  const gate = fnBody(LIVE, 'canGradeViewedUser');
  assert.ok(/isSelf\(\)/.test(gate) && /=== 'owner'/.test(gate) && !/manager/.test(gate), 'on a pivot only an owner gets the control');
  const site = LIVE.slice(LIVE.indexOf('var gradeHost ='), LIVE.indexOf('var outcomeControl ='));
  assert.ok(/gradeAdminOnlyNoteHtml\(\)/.test(site), 'the site renders the note where the control was');
  const src = fnBody(LIVE, 'gradeAdminOnlyNoteHtml') + '\nreturn gradeAdminOnlyNoteHtml;';
  const mk = (self, role, work) => new Function('isSelf', 'state', 'gradeBacklogWorkCount', 'viewedUserLabel', 'escapeHtml', src)(
    () => self, { me: { role: role } }, () => work, () => 'Godwin Ona', (s) => String(s));
  const note = mk(false, 'manager', 95)();
  assert.ok(/admin/i.test(note), 'says it is an admin action: ' + note);
  assert.ok(/Godwin Ona/.test(note) && /own Calls page/i.test(note), 'names the route that still exists — the rep grades their own');
  assert.ok(!/95/.test(note), 'does not restate a count the line already carries');
  assert.strictEqual(mk(true, 'manager', 95)(), '', 'nothing on self — the self-serve control is there');
  assert.strictEqual(mk(false, 'owner', 95)(), '', 'nothing for an owner — they have the control');
  assert.strictEqual(mk(false, 'manager', 0)(), '', 'nothing when there is no backlog to speak of');
});
