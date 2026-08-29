/**
 * EVERY LANE ON A REP PAGE MUST RESOLVE TO THE REP (Justin's bug, 2026-08-29:
 * "opening each rep shows THE SAME What Needs Work for all of them").
 *
 * ⚠⚠ IT WAS NEITHER OF THE TWO OBVIOUS CANDIDATES. Not stale state — that was
 * fixed on 20 Aug and would have shown the PREVIOUS rep. Not a team-scoped lane
 * either. `loadSectionRank` fetched `/me/needs-work-sections` with NO scope
 * choice at all, on a panel whose own comment says "REP PAGE ONLY" — so a
 * manager opening any rep saw THEIR OWN ranking. The population was the VIEWER.
 *
 * ⚠ AND IT HID BEHIND THE EARLIER BUG: while the panel showed the previous
 * rep's data, nobody could tell it was also showing the wrong person's. Fixing
 * the first made the second visible.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const ME = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8');

function code(s) {
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
const CODE = code(HTML);

test('the section-rank lane chooses its scope, like every sibling lane', () => {
  const at = CODE.indexOf('async function loadSectionRank');
  assert.ok(at > 0, 'loadSectionRank is missing — anchor stale');
  const body = CODE.slice(at, at + 900);
  assert.ok(/isSelf\(\)/.test(body), 'it must branch on isSelf()');
  assert.ok(/\/admin\/needs-work-sections\/'\s*\+\s*encodeURIComponent\(state\.viewingUserId\)/.test(body),
    'and use the cross-user route when viewing someone else');
  assert.ok(!/fetch\('\/me\/needs-work-sections\?/.test(body),
    'the unconditional /me fetch must not come back');
});

test('⚠ NO REP-PAGE LANE FETCHES /me/ UNCONDITIONALLY', () => {
  /* The enumeration that found it. These /me/ fetches are legitimately the
     viewer's own and are allowed: the account page, the viewer's grading
     backlog, prospect merges, and per-call ACTIONS (which are permission
     checked server-side by the call's owner).
     ⚠ Anything else fetching /me/ on a page that can show another person is
     this bug again. */
  const ALLOWED = [
    '/me/account',
    '/me/grading-backlog',
    '/me/prospects/',
    '/me/calls/',            // actions, owner-checked server-side
  ];
  const found = (CODE.match(/fetch\('\/me\/[a-z0-9/?'+-]*/g) || [])
    .map(m => m.replace(/^fetch\('/, ''));
  assert.ok(found.length > 0, 'no /me/ fetches found — the check is not measuring');
  const offenders = found.filter(u => !ALLOWED.some(a => u.indexOf(a) === 0));
  assert.deepStrictEqual(offenders, [],
    'a rep-page lane fetches /me/ unconditionally and will show the VIEWER: ' + offenders.join(', '));
});

test('the cross-user route is role-gated and uses the SAME scope predicate', () => {
  const a = code(ADMIN);
  const at = a.indexOf("router.get('/needs-work-sections/:user_id'");
  assert.ok(at > 0, 'the cross-user sections route is missing');
  const head = a.slice(at, at + 200);
  assert.ok(/requireRole\(\['manager', 'owner'\]\)/.test(head), 'manager+owner only');
  const body = a.slice(at, a.indexOf('\n});', at));
  assert.ok(body.length > 400, 'slice must cover the route: ' + body.length);
  assert.ok(/t\.managed_by !== req\.user\.id/.test(body),
    'a non-owner may only reach their own reps — the predicate every pivot route uses');
  assert.ok(/req\.user\.role !== 'owner'/.test(body), 'an owner passes platform-wide');
});

test('ONE computation, two callers — the admin route reuses it rather than copying', () => {
  assert.ok(/router\._computeNeedsWorkSections = computeNeedsWorkSections/.test(code(ME)),
    'me.js must export the shared computation');
  assert.ok(/_computeNeedsWorkSections\(admin, targetUserId/.test(code(ADMIN)),
    'the admin route must call it with the TARGET, not req.user.id');
});

test('the self route still passes req.user.id — no target parameter was added', () => {
  const m = code(ME);
  const at = m.indexOf("router.get('/needs-work-sections'");
  const body = m.slice(at, at + 600);
  assert.ok(/computeNeedsWorkSections\(getAdminClient\(\), req\.user\.id/.test(body),
    'the self route must remain structurally incapable of naming another user');
});
