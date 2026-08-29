/**
 * ⚠⚠ SWITCHING COMPANY MUST NOT LEAVE THE PREVIOUS COMPANY'S GAUGES ON SCREEN.
 *
 * Measured on production 2026-08-25: picking "Sober Living Riches" switched the
 * header, the rep graphs, the rep list and the totals, and left the Team Averages
 * panel showing Scout Systems' 21% / 8-of-39 / "4 not enough calls" — under the
 * other company's name. Nothing errored; the page simply disagreed with itself.
 *
 * ⚠ IT IS CLEARED IN pickTeam, NOT resetTeamData, ON PURPOSE — resetTeamData also
 * runs on a date-range change, and the gauges are a FIXED 7-day window whose own
 * label says the date filter does not affect them. Clearing it there would make
 * them reload visibly right after that promise.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function stripComments(src) {
  const noLine = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}
const LIVE = stripComments(HTML);

/* ⚠ EVERY SLICE ASSERTS ITS OWN LENGTH. Written the obvious way, the first of
   these ran BACKWARDS: renderTeamSurface is defined ABOVE pickTeam, so the end
   marker resolved past it and the "slice" was 238,951 characters of the whole
   page — which would have matched anything. The bound is what caught it. */
function slice(startMarker, endMarker, lo, hi) {
  const at = LIVE.indexOf(startMarker);
  assert.ok(at !== -1, 'stale anchor: ' + startMarker);
  const end = LIVE.indexOf(endMarker, at);
  assert.ok(end !== -1, 'stale end marker: ' + endMarker);
  const src = LIVE.slice(at, end);
  assert.ok(src.length > lo && src.length < hi,
    startMarker + ' slice is ' + src.length + ' chars, expected ' + lo + '..' + hi);
  return src;
}

/* ⚠⚠ CONVERTED 2026-08-29, NOT DELETED. These pinned the old MECHANISM — a
   hand-written `state.teamAverages = null` inside pickTeam, and a resetTeamData
   that never mentioned the lane. Both properties still matter and are asserted
   below; what changed is that the lane's scope is now DECLARED in
   TEAM_LANE_SCOPE, so the two call paths cannot diverge.

   ⚠ THE DIVERGENCE WAS THE BUG: pickTeam nulled it by hand and the RESTORE path
   (a refresh) did not, so the gauges kept the previous company's numbers under
   the new company's name — Justin's report. */

test('the gauges are declared TEAM-scoped, not cleared by hand', () => {
  const src = slice('var TEAM_LANE_SCOPE', '};', 100, 900);
  assert.match(src, /teamAverages:\s*'team'/,
    'the gauges must be declared team-only — a range change must not reload them');
  const pick = slice('function pickTeam(key)', '\n  }', 200, 2000);
  assert.ok(!/state\.teamAverages\s*=\s*null/.test(pick),
    'pickTeam must NOT hand-null the lane any more — that is what diverged');
  assert.match(pick, /resetTeamData\('team'\)/, 'it states its reason instead');
});

test('a TEAM change clears the gauges; a RANGE change does not', () => {
  // The property the old pair of tests protected, now asserted on the map that
  // both call paths share rather than on one call site's source text.
  const src = slice('function resetTeamData', '\n  }', 400, 4000);
  assert.match(src, /sc !== 'both' && sc !== why/, 'the scope decides, not a hand-written list');
  assert.match(src, /state\[lane \+ 'Loading'\] = false/,
    'and the flag clears with the data, or the refetch is a no-op');
});

test('every caller of resetTeamData states its reason', () => {
  const whole = LIVE;
  assert.ok(!/resetTeamData\(\)/.test(whole.replace(/function resetTeamData\(reason\)/, '')),
    'a bare call defaults to team — safe, but the reason must be explicit at the call site');
});
