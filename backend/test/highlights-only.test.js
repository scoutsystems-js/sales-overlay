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

/* ⚠⚠⚠ CALL HIGHLIGHTS OF THE WEEK WAS RETIRED 2026-09-01 (Justin's ruling), so
   FIVE of this file's six tests lost their subject with it. They are archived
   below rather than deleted, so a revival brings its guards back the way its CSS
   must — and the one whose subject SURVIVES is converted, not archived.

   THE REASON IT WENT, because a commented block with no reason gets uncommented
   by someone who assumes it was tidying: UNUSEFUL, HARD TO REACH, AND 87% OF ITS
   QUOTES WERE THE PROSPECT RATHER THAN THE CLOSER — 1,004 of 1,160 candidate
   moments carried no closer reply at all.

test('the expanded page renders Call Highlights and NOT the recommendations', ...)
test('⚠ a page that renders nothing from a lane must not pay for it', ...)
test('⚠⚠ "Back to Team" survived the section that housed it', ...)
test('the entry point names what is actually through the door', ...)
*/

/* ⚠⚠ CONVERTED, NOT ARCHIVED — THIS ONE'S SUBJECT OUTLIVES THE FEATURE, and it
   is the assertion that made the removal safe in the first place: COACHING
   RENDERS THE FULL RECOMMENDATIONS, through `teamRecsHtml()`. Verified before
   the expanded page was stripped, and verified again now that the expanded page
   is gone entirely — because "the other half still works" is exactly the claim
   nobody re-checks after a removal. */
test('⚠⚠ COACHING STILL CARRIES THE RECOMMENDATIONS — removing the wrong half is how a feature becomes unreachable', () => {
  const co = slice('function renderTeamCoaching', 'function drawRepSeriesCharts', 300);
  assert.ok(co.indexOf('teamRecsHtml()') !== -1,
    'the SAME full renderer — this is what made both removals safe');
  assert.ok(co.indexOf("loadTeam('recs')") !== -1,
    'and Coaching must still kick the lane it renders');
});

/* ⚠⚠ THE DOOR WENT WITH THE DESTINATION, AND THAT IS THE POINT. The link was
   added days earlier precisely so Highlights would not become unreachable; the
   right move when the destination is retired is to REMOVE the door, not leave it
   pointing at a dead page. Asserting its ABSENCE is what stops it being restored
   by someone who finds the archived renderer and assumes the link was lost. */
test('⚠⚠ nothing in the product offers the trip to the retired page', () => {
  const code = live;
  assert.strictEqual(/openTeamExpanded\(\)/.test(code), false,
    'the opener is archived — a live caller would reach an archived renderer');
  assert.strictEqual(/Call Highlights of the Week/.test(code), false,
    'no live label may promise it');
  /* ⚠ BUT A BOOKMARK IS A LINK TOO: the view must still normalise somewhere
     rather than rendering nothing. */
  assert.ok(/'team-expanded': 'team-coaching'/.test(code),
    'setView must normalise the retired view');
  assert.ok(/'team-recs': 'team-coaching'/.test(code),
    'and so must the hash, which assigns state.view DIRECTLY');
});

test('⚠⚠⚠ THE VERDICT BORDER SURVIVES THE CALL-REVIEW SWEEP — a RULED exemption', () => {
  /* Justin ruled it stays: red on a loss, GREEN ON A CLOSE, amber on a follow-up.
     It is the ONLY place in the product where the semantic colour is correct.
     ⚠⚠ AND IT WAS SILENTLY DESTROYED ONCE, IN THE SAME EDIT THAT SPARED IT: the
     `.section` sweep uses `border: 0` — a SHORTHAND, which kills border-LEFT too
     — and `.review-why.loss` is only (0,2,0), so it loses to a body[data-view]
     selector and cannot restore it. Nothing failed; the border just went to 0px.
     A shorthand does not respect an intent about one side. */
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  ['loss', 'win', 'pending'].forEach((k) => {
    const re = new RegExp('body\\[data-view="call-review"\\] \\.review-why\\.' + k + '\\s*\\{[^}]*border-left:\\s*3px');
    assert.ok(re.test(css), 'the ' + k + ' border must be re-declared at a specificity that survives the sweep');
  });
  // and the card around it must be gone
  const re = /body\[data-view="call-review"\] \.review-why\s*\{[^}]*background:\s*none/;
  assert.ok(re.test(css), 'the card is stripped');
});
