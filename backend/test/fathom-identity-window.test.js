/**
 * WHY THE FATHOM PROMPT EXISTS, AND HOW FAR BACK A FIRST SYNC REACHES.
 *
 * ⚠⚠ PROBED LIVE 2026-08-24 against Josh's own token — these are facts, not docs:
 *   /me,/users/me,/user,/account,/whoami,/oauth/userinfo -> 404 · /users -> 403
 *   /team_members -> 200, {name,email,created_at}, NO self-identifying field
 *   /meetings unfiltered -> 5 DISTINCT recorded_by identities in ONE page
 *   page size is HARD-CODED at 10 and IGNORES ?limit (25 and 100 both -> 10)
 *   Josh all-time = 560 meetings / 56 pages / 17.8s, back to 2021-09-16
 *
 * So the token is workspace-scoped and the identity is required; but when the
 * Scout email matches a workspace member exactly, asking is pure friction.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveFathomIdentity, normEmail } = require('../lib/fathom-identity');
const W = require('../lib/sync-window');

/* ── identity ─────────────────────────────────────────────────────────────── */

const MEMBERS = [
  { name: 'Dre Wisam', email: 'dre@soberlivingriches.com' },
  { name: 'Joshua Pinner', email: 'joshua@soberlivingriches.com' },
  { name: 'Yazan Younis', email: 'yazan@soberlivingriches.com' },
];

test('⚠⚠ AN EXACT MATCH IS CAPTURED WITHOUT ASKING — Justin\'s case', () => {
  const r = resolveFathomIdentity('joshua@soberlivingriches.com', MEMBERS);
  assert.strictEqual(r.email, 'joshua@soberlivingriches.com');
  assert.strictEqual(r.source, 'scout_email_match');
});

test('⚠ CASE AND WHITESPACE ONLY — the stored form is returned, not the normalised one', () => {
  const r = resolveFathomIdentity('  JOSHUA@SoberLivingRiches.com ', MEMBERS);
  assert.strictEqual(r.email, 'joshua@soberlivingriches.com',
    'recorded_by[] is an exact-match filter on Fathom\'s side — send back what '
    + 'they gave us, not a lowercased approximation');
});

test('⚠⚠ NEAR MISSES REFUSE — a wrong match syncs SOMEONE ELSE\'S calls', () => {
  ['josh@soberlivingriches.com',      // different local part
   'joshua@soberlivingriches.co',     // truncated domain
   'joshua+scout@soberlivingriches.com', // plus-address is NOT folded
   'joshua@gmail.com',
   'josh@scoutsystems.io',            // Josh's OTHER real account
  ].forEach((e) => {
    const r = resolveFathomIdentity(e, MEMBERS);
    assert.strictEqual(r.email, null, 'must refuse ' + e + ' — resemblance is not identity');
    assert.strictEqual(r.reason, 'no_match');
  });
});

test('⚠ AMBIGUITY REFUSES rather than taking the first', () => {
  const dupes = MEMBERS.concat([{ name: 'Other', email: 'joshua@soberlivingriches.com' }]);
  assert.strictEqual(resolveFathomIdentity('joshua@soberlivingriches.com', dupes).reason, 'ambiguous');
});

test('degenerate input never throws', () => {
  [[null, null], ['a@b.c', null], [null, MEMBERS], ['', []], [undefined, undefined]]
    .forEach(([e, m]) => assert.strictEqual(resolveFathomIdentity(e, m).email, null));
  assert.strictEqual(normEmail(42), '');
});

/* ── the window ───────────────────────────────────────────────────────────── */

test('⚠⚠ NULL (never chosen) REPRODUCES THE OLD BEHAVIOUR EXACTLY', () => {
  /* Every existing connection is NULL. If landing this changed what they get,
     the change would silently alter every current user's sync. */
  assert.strictEqual(W.createdAfterFor(null, Date.now()), null, 'no created_after, as before');
  assert.strictEqual(W.pageCapFor(null), W.LEGACY_PAGE_CAP);
  assert.strictEqual(W.LEGACY_PAGE_CAP, 20);
});

test('⚠⚠ THE PAGE CAP SCALES WITH THE CHOICE — or "All time" is a lie', () => {
  /* Page size is 10 and cannot be raised, so the cap IS the call ceiling.
     Offering All time on 20 pages would return the same 200 rows and look
     like it worked. Josh needs 56 pages for his 560 meetings. */
  assert.strictEqual(W.pageCapFor('30d'), 20, '200 calls covers any 30 days');
  assert.ok(W.pageCapFor('90d') > W.pageCapFor('30d'), '3x the window needs more pages');
  assert.ok(W.pageCapFor('all') * 10 >= 560,
    'the all-time cap must clear the largest real history measured (560); '
    + 'got ' + (W.pageCapFor('all') * 10));
});

test('⚠⚠ "all" OMITS created_after — never an epoch date', () => {
  /* A 1970 value makes Fathom return ZERO regardless of other filters. That is
     a production finding, and "just send a very old date" is the obvious wrong
     fix, so it is pinned. */
  assert.strictEqual(W.createdAfterFor('all', Date.now()), null);
});

test('30d and 90d produce the right boundaries', () => {
  const now = Date.parse('2026-08-24T00:00:00Z');
  assert.strictEqual(W.createdAfterFor('30d', now).slice(0, 10), '2026-07-25');
  assert.strictEqual(W.createdAfterFor('90d', now).slice(0, 10), '2026-05-26');
});

test('⚠ sanitizeWindow REJECTS junk rather than defaulting silently', () => {
  ['30d', '90d', 'all'].forEach((v) => assert.strictEqual(W.sanitizeWindow(v), v));
  [null, '', 'forever', '7d', 42, {}].forEach((v) =>
    assert.strictEqual(W.sanitizeWindow(v), undefined, 'must reject ' + JSON.stringify(v)));
});

test('⚠ THE COST OF "All time" IS STATED, AND NAMES THE GRADING CAP', () => {
  const c = W.windowCost('all');
  assert.ok(/20/.test(c), 'it must say only the newest 20 are graded');
  assert.ok(/minute/i.test(c), 'and that it is slow');
  ['30d', '90d'].forEach((w) => assert.ok(/20/.test(W.windowCost(w)), w + ' must name the cap too'));
});
