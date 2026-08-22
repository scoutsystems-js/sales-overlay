/**
 * WHO IS ON A TEAM BOARD — and specifically, IS THE MANAGER ON IT.
 *
 * ⚠⚠ THE BUG THIS PINS (Justin, 2026-08-21): Josh's own data was missing from
 * "My Team". Josh IS the manager. Observed on the deployed board, per surface:
 *
 *     Team Averages gauges   Josh PRESENT      (5 members counted)
 *     rep line graphs        Josh PRESENT
 *     rep cards / totals     Josh ABSENT       <- what Justin saw
 *     trends, why-prose, recommendations,
 *     needs-work, highlights, digest           Josh ABSENT
 *
 * ⚠ THE CAUSE WAS NOT A FILTER OR A REGRESSION — IT IS THAT THE RULE WAS
 * IMPLEMENTED AT THE CALL SITE, TWICE, AND NEVER IN THE RESOLVER. `resolveTeam`
 * returns `managed_by = keyId`, which by definition CANNOT contain the manager.
 * Two endpoints (`/averages`, `/rep-series`) each carried their own copy of
 *
 *     if (candidates.indexOf(team.keyId) === -1) candidates.push(team.keyId)
 *
 * and the other EIGHT did not. Enumerated by capability rather than by grepping
 * the comment, because the comment is what the two copies share, not the rule.
 *
 * ⚠ AND THE RULING ITSELF WAS NEVER WRITTEN DOWN. It exists only in those two
 * code comments ("Ruling 1 (carried from the dials): the board owner counts as
 * a rep") — searched CLAUDE.md for six phrasings and it is not there. So there
 * was nothing to check the eight against.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const router = require('../routes/team');
const resolveTeam = router._resolveTeam;

/** Minimal supabase stand-in: only what resolveTeam touches. */
function fakeAdmin(profiles) {
  return {
    from(table) {
      assert.strictEqual(table, 'user_profiles', 'resolveTeam only reads user_profiles');
      const api = {
        select() { return api; },
        eq(col, val) {
          assert.strictEqual(col, 'managed_by');
          return Promise.resolve({
            data: profiles.filter((p) => p.managed_by === val).map((p) => ({ user_id: p.user_id })),
            error: null,
          });
        },
        then(res) {   // the un-filtered profilesByRole() read
          return Promise.resolve({
            data: profiles.map((p) => ({ user_id: p.user_id, role: p.role })), error: null,
          }).then(res);
        },
      };
      return api;
    },
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  };
}

const MANAGER = 'mgr-1';
const PROFILES = [
  { user_id: MANAGER, role: 'manager', managed_by: null },
  { user_id: 'rep-a', role: 'user', managed_by: MANAGER },
  { user_id: 'rep-b', role: 'user', managed_by: MANAGER },
];

function reqFor(id, role, query) {
  return { user: { id, role }, query: query || {} };
}

test('⚠ NON-VACUITY: the fake resolves the reps at all', async () => {
  // If the stand-in returned nothing, every assertion below would pass for the
  // wrong reason — "the manager is in an empty set" is not a useful green.
  const team = await resolveTeam(fakeAdmin(PROFILES), reqFor(MANAGER, 'manager'));
  const ids = team.memberIds || team.repIds;
  assert.ok(Array.isArray(ids), 'resolveTeam must return a member list');
  assert.ok(ids.indexOf('rep-a') !== -1 && ids.indexOf('rep-b') !== -1,
    'the reps themselves must be present: ' + JSON.stringify(ids));
});

test('⚠⚠ THE MANAGER IS ON THEIR OWN BOARD (mode: own)', async () => {
  const team = await resolveTeam(fakeAdmin(PROFILES), reqFor(MANAGER, 'manager'));
  const ids = team.memberIds || team.repIds;
  assert.ok(ids.indexOf(MANAGER) !== -1,
    'the manager must be part of their own team board — this is the Josh bug. Got: '
    + JSON.stringify(ids));
  assert.strictEqual(ids.length, 3, 'two reps plus the manager');
  assert.strictEqual(team.mode, 'own');
});

test('⚠ AN OWNER VIEWING ANOTHER MANAGER\'S BOARD GETS THAT MANAGER, NOT THEMSELVES', async () => {
  // mode 'pick': keyId is the manager whose board is being viewed. Adding the
  // VIEWER here would silently mix an owner's calls into someone else's team.
  const team = await resolveTeam(fakeAdmin(PROFILES.concat([{ user_id: 'own-1', role: 'owner', managed_by: null }])),
    reqFor('own-1', 'owner', { team: MANAGER }));
  const ids = team.memberIds || team.repIds;
  assert.strictEqual(team.mode, 'pick');
  assert.ok(ids.indexOf(MANAGER) !== -1, 'the board owner belongs on their board: ' + JSON.stringify(ids));
  assert.ok(ids.indexOf('own-1') === -1, 'the VIEWER must not be added to someone else\'s team');
});

test('⚠ THE SET IS DEDUPED — a manager who somehow manages themselves appears once', async () => {
  const self = [{ user_id: MANAGER, role: 'manager', managed_by: MANAGER }];
  const team = await resolveTeam(fakeAdmin(self), reqFor(MANAGER, 'manager'));
  const ids = team.memberIds || team.repIds;
  assert.strictEqual(ids.filter((x) => x === MANAGER).length, 1,
    'no duplicate ids — a doubled id would double-count that person\'s calls');
});

test('⚠⚠ EVERY /team ENDPOINT USES THE RESOLVED SET — the rule has ONE home', () => {
  // ⚠ ENUMERATED BY CAPABILITY, NOT BY GREPPING THE COMMENT. The failure was
  // two endpoints carrying a private copy of the rule while eight had none, so
  // the thing to assert is that NO endpoint hand-rolls it any more.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  const live = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
                  .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.strictEqual((live.match(/candidates\.push\(team\.keyId\)/g) || []).length, 0,
    'an endpoint is still hand-rolling manager inclusion — it belongs in resolveTeam');
  assert.strictEqual((live.match(/team\.repIds/g) || []).length, 0,
    'team.repIds is retired in favour of team.memberIds; a stale reader would silently '
    + 'drop the manager again, which is exactly how this bug happened');
  assert.ok(/memberIds/.test(live), 'resolveTeam must expose the member set');
});
