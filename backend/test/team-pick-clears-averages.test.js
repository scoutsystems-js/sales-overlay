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

test('pickTeam clears the gauges', () => {
  const src = slice('function pickTeam(', 'function setTeamTrendBucket', 80, 1200);
  assert.match(src, /state\.teamAverages\s*=\s*null/,
    'switching company leaves the previous company\'s gauges on screen');
  assert.match(src, /resetTeamData\(\)/, 'the other lanes still reset');
});

test('resetTeamData does NOT clear them — a range change must not reload the fixed gauges', () => {
  const src = slice('function resetTeamData()', 'function renderTeamSurface', 200, 3000);
  assert.ok(!/state\.teamAverages/.test(src),
    'the gauges are range-independent; clearing them here contradicts their own label');
  // non-vacuity: the slice really is resetTeamData's body
  assert.match(src, /state\.teamOverview\s*=\s*null/, 'slice does not contain resetTeamData');
});
