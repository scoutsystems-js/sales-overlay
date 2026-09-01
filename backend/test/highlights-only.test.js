'use strict';
/* ⚠⚠ THE EXPANDED PAGE IS CALL HIGHLIGHTS OF THE WEEK ONLY (Justin, 2026-09-01).
   Team Recommendations came off it because COACHING ALREADY RENDERS THEM — the
   same `teamRecsHtml()`. This page was partly a longer copy of the page that
   links to it. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const live = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function slice(start, end, floor) {
  const a = live.indexOf(start);
  assert.ok(a !== -1, 'anchor missing (stale?): ' + start);
  const b = live.indexOf(end, a);                       // ⚠ fromIndex, or it runs backwards
  assert.ok(b !== -1, 'end marker missing after anchor');
  const t = live.slice(a, b);
  assert.ok(t.length > floor && t.length < 6000, 'slice sane: ' + t.length);
  return t;
}

test('the expanded page renders Call Highlights and NOT the recommendations', () => {
  const ex = slice('function renderTeamExpanded', 'function teamRecsCompactHtml', 300);
  assert.ok(ex.indexOf('teamHighlightsHtml()') !== -1, 'Highlights is what the page is for');
  assert.ok(ex.indexOf('Call Highlights of the Week') !== -1, 'and it is the heading');
  assert.strictEqual(ex.indexOf('teamRecsHtml()'), -1, 'the recommendations came off');
  assert.strictEqual(ex.indexOf('Team Recommendations'), -1, 'including the heading');
});

test('⚠⚠ COACHING STILL CARRIES THE RECOMMENDATIONS — removing the wrong half is how a feature becomes unreachable', () => {
  const co = slice('function renderTeamCoaching', 'function renderTeamExpanded', 300);
  assert.ok(co.indexOf('teamRecsHtml()') !== -1,
    'the SAME full renderer — this is what made the removal safe, and it was checked BEFORE removing');
});

test('⚠ a page that renders nothing from a lane must not pay for it', () => {
  const ex = slice('function renderTeamExpanded', 'function teamRecsCompactHtml', 300);
  assert.strictEqual(ex.indexOf("loadTeam('recs')"), -1, 'the recs lane is no longer kicked here');
  assert.ok(ex.indexOf("loadTeam('highlights')") !== -1, 'the lane it DOES render is still kicked');
});

test('⚠⚠ "Back to Team" survived the section that housed it', () => {
  const ex = slice('function renderTeamExpanded', 'function teamRecsCompactHtml', 300);
  assert.ok(ex.indexOf('Back to Team') !== -1,
    'it lived inside the recommendations header — deleting the section would have stranded the page');
});

test('the entry point names what is actually through the door', () => {
  const co = slice('function renderTeamCoaching', 'function renderTeamExpanded', 300);
  const at = co.indexOf('openTeamExpanded()');
  assert.ok(at !== -1, 'the door still exists');
  const link = co.slice(at, at + 400);
  assert.ok(link.indexOf('Call Highlights of the Week') !== -1,
    'the label must name Highlights alone now that the recs are gone');
  assert.strictEqual(/Recommendations/.test(link), false, 'and must not promise recommendations');
});
