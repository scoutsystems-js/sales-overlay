const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠⚠ JUSTIN, after the picker fix: "the dropdown works BUT the team averages
   numbers stay the same as Scout Systems on refresh — if I cycle through the
   dropdown back to Sober Living it updates."

   CAUSE, and it was NOT the epoch: `teamAverages` was cleared in pickTeam() and
   NOT in resetTeamData(). A REFRESH resets via restoreTeamPick, not pickTeam, so
   the lane was never nulled — and the lazy kick is `if (lane === null)`, so it
   never refetched either. NO REQUEST WAS MADE AT ALL, which is why a
   stale-response guard could not have helped.

   The exemption itself is legitimate: the gauges are a fixed 7-day window and
   the panel says so on screen. The SCOPE was right; the PLACEMENT was wrong. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const grab = (n, e) => { const a = LIVE.indexOf(n); return LIVE.slice(a, LIVE.indexOf(e, a) + e.length); };

function reset(reason, seed) {
  const H = { state: {} };
  Object.keys(seed).forEach((k) => { H.state[k] = seed[k]; H.state[k + 'Loading'] = true; });
  H.state.teamDigestDate = 'x'; H.state.teamDetailMetric = 'y';
  new Function('H', [
    'var state = H.state; var teamEpoch = 0;',
    'function loadRepFilter(){}',
    grab('var TEAM_LANE_SCOPE', '};'),
    grab('function resetTeamData', '\n  }'),
    'H.reset = resetTeamData;',
  ].join('\n'))(H);
  H.reset(reason);
  return H.state;
}
const SEED = { teamOverview:{}, teamRepSeries:{}, teamWhy:{}, teamAverages:{}, teamNeedsWork:{} };

test('⚠⚠ a TEAM change clears EVERY team lane, gauges included', () => {
  const s = reset('team', SEED);
  Object.keys(SEED).forEach((k) => assert.strictEqual(s[k], null, k + ' must be cleared on a team change'));
});

test('⚠⚠ the DATA and its LOADING FLAG are cleared TOGETHER', () => {
  /* Nulling a lane while it is still marked loading makes the refetch a NO-OP —
     loadTeam opens with `if (state[c.flag]) return`. My first version of this fix
     cleared the data from the map and the flags from a HAND-WRITTEN LIST, and
     teamAverages was missing from the list: the exact lane the bug was about,
     reintroduced one line down. */
  const s = reset('team', SEED);
  Object.keys(SEED).forEach((k) =>
    assert.strictEqual(s[k + 'Loading'], false, k + 'Loading must be cleared with the data'));
});

test('⚠ a RANGE change LEAVES the fixed-window gauges alone', () => {
  // The panel says "NOT AFFECTED BY THE DATE FILTER BELOW" on screen.
  const s = reset('range', SEED);
  assert.notStrictEqual(s.teamAverages, null, 'the gauges must survive a range change');
  assert.strictEqual(s.teamAveragesLoading, true, 'and their in-flight state must not be disturbed');
  ['teamOverview', 'teamRepSeries', 'teamWhy', 'teamNeedsWork'].forEach((k) =>
    assert.strictEqual(s[k], null, k + ' is range-scoped and must clear'));
});

test('⚠ the exemption is DECLARED, not incidental', () => {
  const scope = new Function('return ' + grab('var TEAM_LANE_SCOPE', '};').replace('var TEAM_LANE_SCOPE =', '') + ';')();
  assert.strictEqual(scope.teamAverages, 'team', 'the gauges must be declared team-only');
  Object.keys(scope).forEach((k) => {
    if (k !== 'teamAverages') assert.strictEqual(scope[k], 'both', k + ' should be invalidated by both');
  });
});

test('⚠⚠ no caller hand-nulls a lane that the map owns', () => {
  // pickTeam used to null teamAverages by hand; the restore path did not, and
  // that divergence IS the bug. A comment even asserted they were equivalent.
  assert.ok(!/state\.teamAverages = null;\s*\n\s*resetTeamData/.test(LIVE),
    'pickTeam must not re-introduce the hand-written null');
  const calls = LIVE.match(/resetTeamData\((?:'team'|'range')?\)/g) || [];
  assert.ok(calls.length >= 3, 'expected the real call sites, found ' + calls.length);
  assert.ok(!/resetTeamData\(\)/.test(LIVE.replace(/function resetTeamData\(reason\)/, '')),
    'every caller must state its reason');
});
