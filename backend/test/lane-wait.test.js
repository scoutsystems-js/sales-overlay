'use strict';
/* ⚠⚠ A PAGE THAT IS LOADING AND A PAGE THAT IS BROKEN LOOK IDENTICAL — Justin
   has been shown a blank team page twice, once genuinely broken and once merely
   slow. The Objections grid was an empty dark box for 4s warm / 23s cold; the
   Coaching lead number was blank for 9s; the digest was a lone spinner. The
   Recommendations panel had the right shape — a spinner with honest copy where
   the content goes, escalating only after a real wait — and every lane now
   uses that one helper. ⚠ A lane that FAILS must say so, never revert to blank. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

const LANE_RENDERERS = [
  'teamObjGridHtml', 'teamObjFeedHtml', 'teamScoreListHtml', 'teamNeedsWorkCardHtml', 'teamAggregateHtml',
  'teamTrendsHtml', 'repCardsHtml', 'teamDigestHtml', 'dashGaugeHtml', 'avgPanelHtml', 'renderTeamDashboard',
  'sectionRankCardHtml', 'needsWorkCardHtml', 'needsWorkDetailBodyHtml', 'renderOverview', 'renderEodView',
  'renderAccountView', 'renderObjectionsIntel', 'dashRenderPicker', 'teamMembersBodyHtml', 'teamRecsHtml',
];

function liveLaneWait() {
  const src = fnBody(LIVE, 'laneWaitHtml');
  assert.ok(src.length > 200 && src.length < 3000, 'laneWaitHtml slice: ' + src.length);
  return new Function('state', 'escapeHtml', src + '\nreturn laneWaitHtml;');
}

test('⚠⚠ laneWaitHtml: words where the content will be; the long copy only after a real wait', () => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const fn = liveLaneWait()({ laneWaitLong: { objections: false } }, esc);
  const quick = fn('objections', 'Counting objections…', 'Still working — this is the slow one.', 150);
  assert.ok(quick.indexOf('Counting objections…') !== -1, 'the honest copy renders');
  assert.ok(quick.indexOf('Still working') === -1, 'the escalated copy is not shown on a quick load');
  assert.ok(/class="spinner"/.test(quick), 'a spinner beside the words');
  assert.ok(/min-height:\s*150px/.test(quick), 'the space the content will take is held');
  const fn2 = liveLaneWait()({ laneWaitLong: { objections: true } }, esc);
  const slow = fn2('objections', 'Counting objections…', 'Still working — this is the slow one.', 150);
  assert.ok(slow.indexOf('Still working — this is the slow one.') !== -1, 'after the wait the copy escalates');
  const dflt = fn2('objections', 'Counting objections…', null, 0);
  assert.ok(/Still working/.test(dflt), 'a lane with no long copy still escalates with the shared sentence');
});

test('⚠⚠ EVERY LANE RENDERER WAITS IN WORDS — no bare skeleton box on a loading lane', () => {
  LANE_RENDERERS.forEach((name) => {
    const body = fnBody(LIVE, name);
    assert.ok(body.indexOf('laneWaitHtml(') !== -1, name + ' must render laneWaitHtml while its lane loads');
    assert.ok(!/class="skeleton" style="height/.test(body), name + ' still renders the empty dark box');
  });
});

test('⚠⚠ A LANE THAT FAILS SAYS SO — repCardsHtml reverted to BLANK on an error', () => {
  const body = fnBody(LIVE, 'repCardsHtml');
  assert.ok(!/_error\)\s*return\s*'';/.test(body), 'an error must not render nothing');
  assert.ok(/Could not load/.test(body) || /laneProblemHtml\(/.test(body), 'the error branch renders words');
});

test('⚠ ONE WAIT MAP, ONE ARMING FUNCTION — team and personal lanes share it', () => {
  assert.ok(/laneWaitLong:\s*\{\}/.test(LIVE), 'state.laneWaitLong declared as an object');
  assert.strictEqual((LIVE.match(/teamWaitLong/g) || []).length, 0, 'the old carrier is gone (renamed, not aliased)');
  assert.ok(fnBody(LIVE, 'armLaneWait').length > 100, 'armLaneWait exists');
  assert.ok(fnBody(LIVE, 'loadTeam').indexOf('armLaneWait(which') !== -1, 'loadTeam arms through the shared function');
  ['analytics2', 'needsWork', 'sectionRank'].forEach((k) => {
    assert.ok(LIVE.indexOf("armLaneWait('" + k + "',") !== -1, 'personal lane ' + k + ' arms its wait');
  });
});

test('⚠⚠ OBJECTIONS: the summary starts only after the grid has landed — no second bucketing call cold', () => {
  const body = fnBody(LIVE, 'renderTeamObjectionsView');
  const m = body.match(/[^\n]*loadTeamObjSummary\(\);[^\n]*/);
  assert.ok(m, 'the summary is started from this view');
  assert.ok(/gridLanded/.test(m[0]), 'the summary start is gated on the grid: ' + m[0].trim());
  assert.ok(/var gridLanded = !!\(state\.teamObjections && !state\.teamObjections\._error\)/.test(body), 'gridLanded is derived from the grid lane itself');
});
