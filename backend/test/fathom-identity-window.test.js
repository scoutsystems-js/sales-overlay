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

/* ── the grading cap must survive a history pull ──────────────────────────── */

test('⚠⚠ A HISTORY PULL USES THE FIRST-SYNC GRADING CAP, NOT STEADY STATE', () => {
  /* callIdsToAnalyze grades EVERY new row when last_sync_at is set. That is
     right for a normal sync (bounded by real volume) and catastrophic for a
     backfill: 560 pulled calls would fire 560 analyses. Caught before clicking
     it on production. */
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = src.match(/callIdsToAnalyze\(newRows,\s*([^,]+),/);
  assert.ok(m, 'the analyse-selection call moved');
  assert.ok(/historyMode/.test(m[1]),
    'a history pull must pass null for lastSyncAt so the first-sync cap applies; '
    + 'got: ' + m[1].trim());
});

/* ── the backlog control must be REACHABLE (2026-08-24) ───────────────────── */

test('⚠⚠ A HEALTHY ACCOUNT HAS A REACHABLE WAY TO GRADE ITS BACKLOG', () => {
  /* ⚠ renderFathomStripConnected built these controls and was ORPHANED when the
     healthy "Fathom connected" card was removed — defined, never called. Josh's
     trial account sat at 19 graded of 200 with NO control anywhere on the page.
     The capability was deleted silently along with the card that hosted it. */
  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const live = html.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(/function fathomBacklogRowHtml/.test(live), 'the control must exist');
  // and be CALLED — a builder nothing calls is exactly the bug being fixed
  assert.ok(/\+ fathomBacklogRowHtml\(\)/.test(live),
    'fathomBacklogRowHtml must be rendered by Connections; defining it is not enough');
  assert.ok(!/function renderFathomStripConnected/.test(live),
    'the orphaned builder must be archived, not left looking live');
});

test('⚠⚠ THE WINDOW PICKER SHOWS FOR A PURE BACKLOG, not only for outdated work', () => {
  /* The old branch showed the scope dropdown only when `outdated > 0`, so a
     post-import backlog (pending, nothing outdated) fell through to
     "Analyze next 10" — 18 clicks for 180 calls. */
  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  /* ⚠ CONVERTED 2026-08-25, NOT DELETED. The window options moved OUT of this
     row into the shared gradeBacklogControlHtml() when the control was added to
     the Calls page — so the option list is no longer inside this function and a
     slice of it can no longer see them. The PROPERTY this test protects is
     unchanged: a pure backlog (pending, nothing outdated) must still get the
     window picker. It is now asserted where each half actually lives. */
  const i = html.indexOf('function gradeBacklogWorkCount');
  const fn = html.slice(i, html.indexOf('\n  }', i));
  assert.ok(fn.length > 80 && fn.length < 600, 'work-count slice looks wrong: ' + fn.length);
  assert.ok(/pending_count \|\| 0\) \+ \(f\.outdated_count/.test(fn),
    'the control must key on pending PLUS outdated — update-analyses dispatches both');

  const j = html.indexOf('function gradeScopeOptionsHtml');
  const opts = html.slice(j, html.indexOf('\n  }', j));
  assert.ok(opts.length > 100 && opts.length < 800, 'options slice looks wrong: ' + opts.length);
  ['7d', '30d', 'all'].forEach((w) =>
    assert.ok(opts.indexOf('value="' + w + '"') !== -1, 'missing window ' + w));
});

test('⚠ THE TILE EXPLAINS ITSELF — "19 of 149" alone reads as broken', () => {
  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.ok(/not graded yet/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')),
    'an ungraded remainder must be named on the tile, not left as a bare ratio');
});

/* ── 30-day default on a NEW connection (Justin, 2026-08-24) ──────────────── */

test('⚠⚠ A NEW FATHOM CONNECTION DEFAULTS TO 30 DAYS — but never overwrites a choice', () => {
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'routes', 'auth.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/sync_window:\s*keepWindow \|\| '30d'/.test(src),
    'the connect upsert must default to 30d');
  assert.ok(/select\('sync_window'\)/.test(src),
    'and must READ the existing window first — this is an upsert, so writing '
    + '30d unconditionally would silently narrow anyone RECONNECTING who had '
    + 'chosen 90d or all time');
});

test('⚠⚠ ZOOM SENDS THE 30-DAY DATE rather than inheriting Zoom\'s default', () => {
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'routes', 'zoom.js'), 'utf8');
  assert.ok(/ZOOM_FIRST_SYNC_DAYS\s*=\s*30/.test(src), 'the window must be stated, not implied');

  const i = src.indexOf('function zoomFromDate');
  const fn = src.slice(i, src.indexOf('\n}', i));
  assert.ok(!/return null/.test(fn),
    'a first sync must send a date. Omitting `from` relied on Zoom DEFAULTING '
    + 'to the last month — an upstream default is not a decision, and nothing '
    + 'in our code would say what we intended if Zoom changed it');
});

test('⚠ THE GRADING CAP IS UNCHANGED BY THIS — 30 days can still exceed 20 calls', () => {
  const fs2 = require('fs'), path2 = require('path');
  ['fathom', 'zoom'].forEach((r) => {
    const src = fs2.readFileSync(path2.join(__dirname, '..', 'routes', r + '.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(/callIdsToAnalyze\(/.test(src) && /FIRST_SYNC_ANALYZE_CAP/.test(src),
      r + ' must still cap grading on a first sync — pulling fewer calls does '
      + 'not mean grading all of them');
  });
});
