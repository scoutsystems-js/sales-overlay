/**
 * REP FILTER PERSISTENCE — the selection must survive a refresh (Justin, live bug).
 *
 * ⚠⚠ TWO DEFECTS, BOTH REAL, FOUND BY READING THE CALL GRAPH RATHER THAN GUESSING:
 *
 * 1. loadRepFilter() had ONE call site — inside resetTeamData(), which fires on a
 *    TEAM SWITCH or a RANGE CHANGE. It never ran on boot. state.repLineHidden
 *    initialises to {} and stays {}, so a saved selection was never read back.
 *
 * 2. The fallback `if (!state.repLineHidden) loadRepFilter();` CAN NEVER FIRE,
 *    because state.repLineHidden is {} — and {} IS TRUTHY. A guard written to
 *    mean "not loaded yet" tests a value that is never falsy after init.
 *
 * ⚠ AND THE ORDERING TRAP: the store key includes state.teamSelected, so the load
 *    must run AFTER the team is known, or it reads the wrong key. It must also run
 *    BEFORE the datasets are built, because repSeriesChart reads
 *    state.repLineHidden[user_id] when it constructs them.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fnBody(name, cap) {
  const at = LIVE.indexOf('function ' + name + '(');
  assert.ok(at !== -1, 'stale anchor — ' + name);
  const end = LIVE.indexOf('\n  }', at);
  const body = LIVE.slice(at, end + 4);
  assert.ok(body.length > 40 && body.length < (cap || 8000), name + ' slice: ' + body.length);
  return body;
}

test('⚠⚠ the saved selection is READ on the chart-build path, not only on team switch', () => {
  const draw = fnBody('drawRepSeriesCharts');
  assert.ok(/loadRepFilter\s*\(/.test(draw),
    'drawRepSeriesCharts must load the saved selection before building datasets — '
    + 'otherwise a refresh starts with an empty hidden set and the selection is lost');
  const loadAt = draw.indexOf('loadRepFilter');
  const chartAt = draw.indexOf("repSeriesChart('repHandleChart'");
  assert.ok(loadAt !== -1 && chartAt !== -1 && loadAt < chartAt,
    'the load must precede dataset construction — repSeriesChart reads '
    + 'state.repLineHidden[user_id] while building');
});

test('⚠⚠ the {} IS TRUTHY guard is gone', () => {
  assert.ok(!/if\s*\(\s*!state\.repLineHidden\s*\)\s*loadRepFilter/.test(LIVE),
    'that guard can never fire: repLineHidden initialises to {} and {} is truthy. '
    + 'A condition that is never true is not a fallback.');
});

test('⚠ the store key is per-team, and derived not hardcoded', () => {
  const key = fnBody('repFilterStoreKey', 900);
  assert.ok(/teamSelected/.test(key), 'the key must include the selected team');
  assert.ok(/REP_FILTER_KEY/.test(key), 'and the shared prefix constant');
});

test('⚠ more than one loadRepFilter call site', () => {
  const sites = LIVE.split('\n').filter((l) => /loadRepFilter\s*\(/.test(l)
    && !/function\s+loadRepFilter/.test(l));
  assert.ok(sites.length >= 2, 'expected the team-switch site PLUS the boot/draw site; got ' + sites.length);
});
