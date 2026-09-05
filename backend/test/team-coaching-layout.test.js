'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const html = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8');
const live = stripComments(html);

function recommendations(view, payload) {
  const calls = [];
  const render = new Function('state', 'teamInsightHtml', 'laneWaitHtml', 'laneProblemHtml', 'noMaterialHtml', 'escapeHtml',
    fnBody(live, 'teamRecsHtml') + ';return teamRecsHtml();');
  const output = render({ view, teamRecs: payload }, (item, kind, index) => {
    calls.push({ id: item.id, kind, index });
    return '<article>' + item.id + '</article>';
  }, () => 'waiting', () => 'error', () => 'no material', s => s);
  return { output, calls };
}

test('coaching layout retains every recommendation and its original action index', () => {
  const payload = { available: true, working: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }], improve: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] };
  const original = recommendations('team', payload), coaching = recommendations('team-coaching', payload);
  assert.deepEqual(coaching.calls, original.calls);
  assert.equal(coaching.calls.length, 6);
  assert.match(coaching.output, /coaching-recommendations-grid/);
  assert.doesNotMatch(original.output, /coaching-recommendations-grid/);
});

test('coaching layout preserves loading, errors, absent knowledge, and empty states', () => {
  for (const payload of [null, { _error: true }, { available: false }, { available: true, no_material: true }, { available: true, working: [], improve: [] }]) {
    assert.equal(recommendations('team-coaching', payload).output, recommendations('team', payload).output);
  }
});

test('coaching render preserves lane dispatch and panel visibility', () => {
  const content = {}, dispatch = [];
  const state = { teamContext: {}, teamOverview: { totals: { avg_score: 68 } }, teamRecs: {}, teamCoachable: {} };
  const render = new Function('document', 'state', 'ensureTeamDefaultRange', 'loadTeam', 'loadNotedMoments', 'teamHeaderHtml', 'teamControlsHtml', 'leadNumberHtml', 'teamPanelVisible', 'teamRecsHtml', 'teamCoachableHtml', 'allPanelsHiddenNoteHtml',
    fnBody(live, 'renderTeamCoaching') + ';return renderTeamCoaching();');
  render({ getElementById: () => content }, state, () => {}, lane => dispatch.push(lane), () => {}, () => 'TEAM', () => 'DATE', () => 'SCORE', () => false, () => { throw Error('hidden recommendations rendered'); }, () => { throw Error('hidden moments rendered'); }, () => 'HIDDEN');
  assert.deepEqual(dispatch, []);
  assert.match(content.innerHTML, /TEAMDATESCORE/);
  assert.match(content.innerHTML, /HIDDEN<\/div>$/);
});
