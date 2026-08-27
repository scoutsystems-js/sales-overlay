/**
 * A REP-SCOPED PANEL MUST RESOLVE THE REP'S TEAM, NOT THE CALLER'S.
 *
 * ⚠⚠ THE DEFECT: the pivoted rep's objection graph fetches /team/rep-series. With
 * no team named, an OWNER resolved their OWN default board, the viewed rep was
 * absent from it, and the panel rendered "No objection data for this rep in the
 * selected range" — on a rep with 19 objections in the last 7, 30 AND 90 days.
 *
 * Same family as the stale-panel bug: a panel answering about the WRONG
 * POPULATION with nothing on screen saying so. The extra sting here is that the
 * message named a cause — the date range — that was definitively not it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEAM = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const resolveTeam = require('../routes/team')._resolveTeam;

// A supabase double carrying one small org: an owner with 1 rep, and a manager
// with 1 rep on a DIFFERENT board — the shape that produced the bug.
function fakeAdmin(profiles) {
  return {
    from() {
      const q = {
        _rows: profiles, _eqCol: null, _eqVal: null,
        select() { return q; },
        eq(c, v) { q._eqCol = c; q._eqVal = v; return q; },
        async maybeSingle() {
          return { data: profiles.filter((p) => p[q._eqCol] === q._eqVal)[0] || null, error: null };
        },
        then(res) { res({ data: profiles.filter((p) => q._eqCol ? p[q._eqCol] === q._eqVal : true), error: null }); },
      };
      return q;
    },
    auth: { admin: { listUsers: async () => ({ data: { users: profiles.map((p) => ({ id: p.user_id, email: p.user_id + '@x' })) } }) } },
  };
}

const PROFILES = [
  { user_id: 'owner', role: 'owner', managed_by: null },
  { user_id: 'own-rep', role: 'user', managed_by: 'owner' },
  { user_id: 'mgr', role: 'manager', managed_by: null },
  { user_id: 'other-rep', role: 'user', managed_by: 'mgr' },   // dre's shape
  { user_id: 'loner', role: 'user', managed_by: null },        // on no team at all
];

test('⚠⚠ A REP ON ANOTHER BOARD RESOLVES TO THAT BOARD — the reported bug', async () => {
  const t = await resolveTeam(fakeAdmin(PROFILES), { user: { id: 'owner', role: 'owner' }, query: { rep: 'other-rep' } });
  assert.ok(t.memberIds.indexOf('other-rep') !== -1,
    'the viewed rep must be inside the resolved team, or their panel renders empty');
  assert.strictEqual(t.keyId, 'mgr', 'and the board is their manager\'s, not the caller\'s');
});

test('a rep on the CALLER\'S OWN board still resolves correctly — no regression', async () => {
  const t = await resolveTeam(fakeAdmin(PROFILES), { user: { id: 'owner', role: 'owner' }, query: { rep: 'own-rep' } });
  assert.ok(t.memberIds.indexOf('own-rep') !== -1);
  assert.strictEqual(t.keyId, 'owner');
});

test('⚠ AN UNMANAGED REP IS A BOARD OF ONE, not an empty result', async () => {
  // "On no team" is a real state. Returning nothing would be the silent empty
  // this whole fix exists to remove.
  const t = await resolveTeam(fakeAdmin(PROFILES), { user: { id: 'owner', role: 'owner' }, query: { rep: 'loner' } });
  assert.deepStrictEqual(t.memberIds, ['loner']);
  assert.strictEqual(t.mode, 'rep');
});

test('⚠ AN EXPLICIT team= STILL WINS — rep= must not override a deliberate pick', async () => {
  const t = await resolveTeam(fakeAdmin(PROFILES), { user: { id: 'owner', role: 'owner' }, query: { rep: 'other-rep', team: 'owner' } });
  assert.strictEqual(t.keyId, 'owner', 'the team picker is an explicit choice and outranks the rep hint');
});

test('⚠ rep= IS IGNORED FOR A NON-OWNER — a manager only ever sees their own reps', async () => {
  const t = await resolveTeam(fakeAdmin(PROFILES), { user: { id: 'mgr', role: 'manager' }, query: { rep: 'own-rep' } });
  assert.strictEqual(t.mode, 'own');
  assert.strictEqual(t.keyId, 'mgr', 'a rep hint must not let a manager resolve another board');
});

test('⚠⚠ THE CLIENT ACTUALLY SENDS IT — a server that accepts rep= changes nothing alone', () => {
  const at = LIVE.indexOf('async function loadRepGraph');
  assert.ok(at !== -1, 'stale anchor: loadRepGraph');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(/rep=/.test(src) && /viewingUserId/.test(src),
    'loadRepGraph must name the viewed rep, or it resolves the caller\'s team');
});

test('⚠⚠ THE EMPTY STATE NO LONGER NAMES A CAUSE IT HAS NOT ESTABLISHED', () => {
  assert.strictEqual(/No objection data for this rep in the selected range/.test(LIVE), false,
    'the old copy blamed the DATE RANGE, which was the one thing it was not');
  assert.ok(/No objection moments recorded for this rep yet/.test(LIVE),
    'the replacement must state only what is true');
});
