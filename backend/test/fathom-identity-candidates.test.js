/**
 * ⚠⚠ THE NATHAN INCIDENT (2026-08-31). Auto-resolution consulted ONLY
 * /team_members, which returns ten members and did NOT list him — so it
 * correctly returned no_match and fell through to the picker, where the
 * suggestions were ranked by who had recorded most of the last ten WORKSPACE
 * meetings. Dre was offered first, Nathan's own address third, the wrong one
 * was chosen, and 41 of Dre's calls were ingested into Nathan's account.
 *
 * ⚠ His own address WAS available the whole time — in the `recorded_by` values
 * on /meetings. The resolver was looking at one source when two existed.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { identityCandidates, resolveFathomIdentity } = require('../lib/fathom-identity');

// the real shapes, from the live probe on the day of the incident
const TEAM_MEMBERS = [
  { email: 'josh.n@soberlivingriches.com' }, { email: 'dre@soberlivingriches.com' },
  { email: 'mahmoud@soberlivingriches.com' }, { email: 'lara@soberlivingriches.com' },
  { email: 'yazan@soberlivingriches.com' }, { email: 'christian@soberlivingriches.com' },
  { email: 'adamfask@soberlivingriches.com' }, { email: 'godwin.o@soberlivingriches.com' },
];
const MEETINGS = [
  { recorded_by: { email: 'dre@soberlivingriches.com' } },
  { recorded_by: { email: 'dre@soberlivingriches.com' } },
  { recorded_by: { email: 'gabriel@soberlivingriches.com' } },
  { recorded_by: { email: 'nathan.m@soberlivingriches.com' } },
];

test('the incident: Nathan is absent from team_members and present in meetings', () => {
  assert.ok(!TEAM_MEMBERS.some(m => m.email === 'nathan.m@soberlivingriches.com'),
    'fixture must reproduce the incident: he is NOT a listed team member');
  const only = resolveFathomIdentity('nathan.m@soberlivingriches.com', TEAM_MEMBERS);
  assert.strictEqual(only.email, null, 'team_members alone cannot resolve him — this is what happened');
  assert.strictEqual(only.reason, 'no_match');
});

test('both sources merged resolves him, so the picker is never shown', () => {
  const cands = identityCandidates(TEAM_MEMBERS, MEETINGS);
  const hit = resolveFathomIdentity('nathan.m@soberlivingriches.com', cands);
  assert.strictEqual(hit.email, 'nathan.m@soberlivingriches.com');
  assert.strictEqual(hit.source, 'scout_email_match');
});

test('candidates are de-duplicated and keep their stored form', () => {
  const cands = identityCandidates(TEAM_MEMBERS, MEETINGS);
  const dre = cands.filter(c => c.email === 'dre@soberlivingriches.com');
  assert.strictEqual(dre.length, 1, 'dre appears in BOTH sources and 3 times in meetings — once in the list');
  // ⚠ exact-match filtering on Fathom's side: never lowercase what we send back
  const mixed = identityCandidates([], [{ recorded_by: { email: 'Nathan.M@SoberLivingRiches.com' } }]);
  assert.strictEqual(mixed[0].email, 'Nathan.M@SoberLivingRiches.com');
});

test('⚠ EXACT EQUALITY ONLY — a near miss must never auto-resolve', () => {
  // the standing rule: a wrong match syncs a DIFFERENT PERSON'S calls
  const near = identityCandidates([], [{ recorded_by: { email: 'nathan@soberlivingriches.com' } }]);
  assert.strictEqual(resolveFathomIdentity('nathan.m@soberlivingriches.com', near).email, null,
    'nathan@ must NOT resolve nathan.m@');
});

test('ambiguity still refuses after merging', () => {
  const dupes = identityCandidates(
    [{ email: 'a@x.com' }],
    [{ recorded_by: { email: 'A@X.com' } }, { recorded_by: { email: 'a@x.COM' } }]);
  // same address in different cases de-dupes to one, so this resolves...
  assert.strictEqual(resolveFathomIdentity('a@x.com', dupes).email, 'a@x.com');
});

test('malformed entries are skipped, never thrown on', () => {
  const c = identityCandidates([null, { email: null }, {}], [{}, { recorded_by: null }, { recorded_by: { email: '' } }]);
  assert.deepStrictEqual(c, []);
});

/* ⚠⚠ THE PICKER RANKING. The defect was the ORDER, not the user: suggestions
   were sorted by how often each person appears in one unfiltered page of the
   last ten WORKSPACE meetings. Dre had 7 of 10 and was offered first; Nathan's
   own address was third and his account took 41 of Dre's calls. */
test('the picker ranks the signed-in address first, not the busiest recorder', () => {
  const fs = require('fs'), path = require('path');
  const raw = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const live = raw.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(live.length > 5000, 'strip must leave the module: ' + live.length);

  // the retired ordering must not come back
  assert.ok(!/\.sort\(function\s*\(a,\s*b\)\s*\{\s*return b\.count - a\.count;\s*\}\)/.test(live),
    'suggestions must not be sorted by count alone — that is the defect');
  assert.ok(/affinity/.test(live), 'ranking must consider the signed-in address');
  // exact match outranks everything
  assert.ok(/n === meNorm\) return 3/.test(live), 'an exact match must rank top');
  assert.ok(/b\.affinity !== a\.affinity/.test(live), 'affinity must be the primary sort key');
});

test('the picker states the consequence and drops the misleading count', () => {
  const fs = require('fs'), path = require('path');
  const raw = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const live = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/will copy their calls into your account/.test(live),
    'the screen must say what picking wrong does');
  // the workspace-activity count read as authority; it is not about the user
  assert.ok(!/typeof s\.count === 'number' \? ' \(' \+ s\.count \+ '\)'/.test(live),
    'the per-suggestion meeting count must not be rendered');
  assert.ok(/this is you/.test(live), 'the exact match must be marked');
});
