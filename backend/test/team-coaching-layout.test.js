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
  assert.match(coaching.output, /coaching-strength-grid/g);
  assert.doesNotMatch(original.output, /coaching-strength-grid/);
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
  assert.match(content.innerHTML, /TEAMDATE<\/div>SCORE/);
  assert.match(content.innerHTML, /HIDDEN<\/div>$/);
});


test('workspace evidence retains attribution, clip and original Fine Tune target inside disclosure', () => {
  const render = new Function('state', 'escapeHtml', 'canMarkStandard', 'displayNameFromEmail', 'tsFromClipUrl', 'clipLabelFor',
    fnBody(live, 'teamInsightHtml') + ';return teamInsightHtml({claim:"claim",data:"supporting evidence",quote:"exact quote",rep:"Rep",spoke:"closer",clip_url:"https://example.com/clip",highlight_id:"h1",call_id:"c1"},"improve",2);');
  const output = render({view:'team-coaching'}, s=>String(s), ()=>true, s=>s, ()=>'01:20', ()=>'Clip');
  assert.match(output, /<details class="coaching-evidence"><summary>/);
  for (const retained of ['supporting evidence', 'exact quote', 'Rep', 'https://example.com/clip', 'data-kind="improve"', 'data-idx="2"']) assert.ok(output.includes(retained), retained);
  assert.ok(output.indexOf('Rep') < output.indexOf('exact quote'), 'attribution precedes quote');
});
