/**
 * COMPANIES = RENAMED TEAMS (Justin's ruling, 2026-08-24).
 *
 * The two properties that matter most here are the ones a reader would
 * otherwise have to re-derive:
 *   1. a company is defined by HAVING REPS, not by ROLE — live data has a
 *      `manager` with zero reps, and they are a SINGLE USER;
 *   2. every user lands in EXACTLY ONE of Companies / Single Users, including
 *      the shape the schema allows but the data does not yet contain (a user
 *      with both reps AND a manager).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  COMPANY_NAME_FALLBACK, MAX_COMPANY_NAME, ROLE_RANK,
  sanitizeCompanyName, companyDisplayName, isUnnamedCompany, roleRank, bucketUsers,
} = require('../lib/company');

/* ── the fallback ─────────────────────────────────────────────────────────── */

test('⚠⚠ AN UNNAMED COMPANY NEVER RENDERS BLANK, "undefined", OR AN EMAIL', () => {
  [null, undefined, '', '   ', '\n\t'].forEach((v) => {
    const shown = companyDisplayName(v);
    assert.strictEqual(shown, COMPANY_NAME_FALLBACK,
      'an unnamed company must render the fallback, got ' + JSON.stringify(shown));
    assert.ok(shown.trim().length > 0, 'never blank');
    assert.ok(!/undefined|null/i.test(shown), 'never a stringified nullish value');
    assert.ok(shown.indexOf('@') === -1,
      'never an email dressed up as a company name — resolveTeam already does '
      + 'that ("josh@scoutsystems.io\'s team") and this replaces it');
  });
  assert.strictEqual(isUnnamedCompany(null), true);
  assert.strictEqual(isUnnamedCompany('Acme'), false);
});

test('⚠ THE FALLBACK IS NOT DERIVED FROM THE HEAD — deliberately', () => {
  /* A derived label ("Josh's company") reads as a real name, so nobody
     questions it and nobody ever sets the real one. companyDisplayName takes
     ONLY the stored name — it has no access to the head at all, which makes
     deriving one impossible rather than merely discouraged. */
  assert.strictEqual(companyDisplayName.length, 1,
    'companyDisplayName must take only the stored name; giving it the head '
    + 'would make a derived fallback possible');
});

/* ── writes ───────────────────────────────────────────────────────────────── */

test('sanitizeCompanyName: trims, collapses, caps, and distinguishes clear from junk', () => {
  assert.strictEqual(sanitizeCompanyName('  Acme  Roofing '), 'Acme Roofing');
  assert.strictEqual(sanitizeCompanyName(''), null, "'' means unset, not a stored empty string");
  assert.strictEqual(sanitizeCompanyName('   '), null);
  assert.strictEqual(sanitizeCompanyName(null), null, 'explicit clear is allowed');
  assert.strictEqual(sanitizeCompanyName(42), undefined, 'non-string is a 400, not a clear');
  assert.strictEqual(sanitizeCompanyName({}), undefined);
  const long = sanitizeCompanyName('x'.repeat(MAX_COMPANY_NAME + 50));
  assert.strictEqual(long.length, MAX_COMPANY_NAME);
});

test('⚠ null (clear) and undefined (junk) are DIFFERENT — the route depends on it', () => {
  /* Collapsing them would make a bad payload silently clear the name. */
  assert.notStrictEqual(sanitizeCompanyName(null), sanitizeCompanyName(7));
});

/* ── role order ───────────────────────────────────────────────────────────── */

test('⚠ ROLE RANKS ARE SPACED SO A FUTURE TIER SLOTS IN WITHOUT RENUMBERING', () => {
  assert.ok(roleRank('owner') < roleRank('manager'), 'owner above manager');
  assert.ok(roleRank('manager') < roleRank('user'), 'manager above user');
  const vals = Object.keys(ROLE_RANK).map((k) => ROLE_RANK[k]).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] - vals[i - 1] > 1,
      'ranks must leave a gap between adjacent roles so a new tier can be '
      + 'inserted without touching the others; got ' + JSON.stringify(vals));
  }
  assert.ok(roleRank('something-new') > roleRank('user'),
    'an unrecognised role sorts last rather than crashing or sorting first');
});

/* ── the partition ────────────────────────────────────────────────────────── */

const HEAD = { user_id: 'h1', email: 'josh@scoutsystems.io', role: 'owner', managed_by: null, team_name: null };
const REP_A = { user_id: 'r1', email: 'ava@x.com', role: 'user', managed_by: 'h1' };
const REP_B = { user_id: 'r2', email: 'ben@x.com', role: 'user', managed_by: 'h1' };
const REP_M = { user_id: 'r3', email: 'mid@x.com', role: 'manager', managed_by: 'h1' };
// live shape: role says manager, but they have NO reps
const LONE_MANAGER = { user_id: 's1', email: 'joshua@soberlivingriches.com', role: 'manager', managed_by: null };
const LONE_OWNER = { user_id: 's2', email: 'justin@x.com', role: 'owner', managed_by: null };

test('⚠⚠ A COMPANY IS DEFINED BY HAVING REPS, NOT BY ROLE', () => {
  const { companies, singles } = bucketUsers([HEAD, REP_A, LONE_MANAGER]);
  assert.strictEqual(companies.length, 1, 'exactly one company');
  assert.strictEqual(companies[0].key, 'h1');
  assert.deepStrictEqual(singles.map((u) => u.user_id), ['s1'],
    'a user whose ROLE is manager but who has ZERO reps is a SINGLE USER — this '
    + 'is a real row in production, not a hypothetical');
});

test('⚠⚠ EVERY USER LANDS IN EXACTLY ONE BUCKET — none lost between them', () => {
  const all = [HEAD, REP_A, REP_B, REP_M, LONE_MANAGER, LONE_OWNER];
  const { companies, singles } = bucketUsers(all);
  const seen = [];
  companies.forEach((c) => { if (c.head) seen.push(c.head.user_id); c.members.forEach((m) => seen.push(m.user_id)); });
  singles.forEach((u) => seen.push(u.user_id));

  assert.strictEqual(seen.length, all.length,
    'the two buckets must account for every user exactly once; got ' + seen.length + ' of ' + all.length);
  assert.strictEqual(new Set(seen).size, all.length, 'and nobody appears twice');
  assert.deepStrictEqual(seen.slice().sort(), all.map((u) => u.user_id).sort());
});

test('⚠⚠ A USER WITH BOTH REPS AND A MANAGER GETS ONE BUCKET, NOT TWO', () => {
  /* The schema permits this; the data does not contain it yet. It is the shape
     a second tier would introduce, so it must be decided rather than discovered:
     reps win, they head their own company, and they do NOT also render as a
     member of their manager's. Double-counting here would inflate every
     company's user count. */
  const BOTH = { user_id: 'b1', email: 'mid@x.com', role: 'manager', managed_by: 'h1', team_name: 'Sub Co' };
  const SUB_REP = { user_id: 'r9', email: 'z@x.com', role: 'user', managed_by: 'b1' };
  const all = [HEAD, REP_A, BOTH, SUB_REP];
  const { companies, singles } = bucketUsers(all);

  const appearances = [];
  companies.forEach((c) => { if (c.head) appearances.push(c.head.user_id); c.members.forEach((m) => appearances.push(m.user_id)); });
  singles.forEach((u) => appearances.push(u.user_id));
  assert.strictEqual(appearances.filter((id) => id === 'b1').length, 1,
    'the both-shaped user must appear exactly once');
  assert.strictEqual(appearances.length, all.length, 'and nobody is lost');

  const sub = companies.filter((c) => c.key === 'b1')[0];
  assert.ok(sub, 'they head their own company');
  const parent = companies.filter((c) => c.key === 'h1')[0];
  assert.strictEqual(parent.members.filter((m) => m.user_id === 'b1').length, 0,
    'and are NOT also a member of their own manager\'s company');
});

test('⚠ A DANGLING manager REFERENCE KEEPS ITS MEMBERS RATHER THAN DROPPING THEM', () => {
  const orphan = { user_id: 'o1', email: 'o@x.com', role: 'user', managed_by: 'gone' };
  const { companies, singles } = bucketUsers([orphan]);
  assert.strictEqual(singles.length, 0, 'a MANAGED user is not a single user');
  assert.strictEqual(companies.length, 1);
  assert.strictEqual(companies[0].head, null, 'the head is absent, and that is stated');
  assert.strictEqual(companies[0].name, COMPANY_NAME_FALLBACK);
  assert.strictEqual(companies[0].members.length, 1, 'the member is kept, not lost');
});

test('MEMBERS ORDER TOP-DOWN BY ROLE, not alphabetically', () => {
  const { companies } = bucketUsers([HEAD, REP_B, REP_M, REP_A]);
  const order = companies[0].members.map((m) => m.email);
  assert.deepStrictEqual(order, ['mid@x.com', 'ava@x.com', 'ben@x.com'],
    'manager first, then users; alphabetical would have put ava first');
});

test('⚠ UNNAMED COMPANIES SORT LAST — an unnamed company is a prompt to act', () => {
  const h2 = { user_id: 'h2', email: 'b@x.com', role: 'manager', managed_by: null, team_name: 'Acme' };
  const r = { user_id: 'r8', email: 'q@x.com', role: 'user', managed_by: 'h2' };
  const { companies } = bucketUsers([HEAD, REP_A, h2, r]);
  assert.deepStrictEqual(companies.map((c) => c.name), ['Acme', COMPANY_NAME_FALLBACK]);
});

test('the head\'s stored name is what the company is called', () => {
  const named = Object.assign({}, HEAD, { team_name: '  Sober Living Riches ' });
  const { companies } = bucketUsers([named, REP_A]);
  assert.strictEqual(companies[0].name, 'Sober Living Riches');
  assert.strictEqual(companies[0].is_unnamed, false);
  assert.strictEqual(companies[0].user_count, 2, 'head + 1 member');
});

test('degenerate input never throws', () => {
  [null, undefined, [], [null], [{}], 'nope'].forEach((v) => {
    const r = bucketUsers(v);
    assert.ok(Array.isArray(r.companies) && Array.isArray(r.singles));
  });
});
