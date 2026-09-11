'use strict';
/* THREE RULINGS, ONE GUARD (Justin, 2026-09-10; H768).
   1. A GENUINE FINANCIAL DISQUALIFICATION IS ONE MISS, COACHED ONCE. Objection Handling
      and Close are not applicable on a genuine DQ WHENEVER it is discovered; Discovery
      carries the miss (early: good qualification work; late: the qualification that was
      missed). The seven-day regrade charged one prospect who could not fund it three
      times — Discovery 61, Objection 38 F, Close 35 F — and scored the objection stage on
      five late-DQ calls. ENFORCED IN THE VALIDATOR (this file executes it) and stated in
      the prompt: a genuine DQ in the finance context with a scored Objection or Close is a
      contradiction the code sees without reading prose, so relabelling cannot satisfy it.
      An unresolved or unassessed finance context changes nothing; a prospect who can pay
      and does not want to is still an objection.
   2. THE TEAM PANEL GETS THE SAME FLOOR THE REP PAGE HAS. rep-period-coaching named a
      weakest area from ONE counted call while section-ranking refuses below ten. One floor,
      one source (MIN_CALLS_TO_RANK), and below it the panel says what it is based on in the
      rep dashboard's own words ("Not enough to judge" + "only N calls graded in this period").
   3. A STAGE THAT WAS NEVER DUE IS NOT APPLICABLE, NOT UNMEASURED. When the grader scored a
      stage its own context says never became due — no sales conversation (false), close not
      due (false), an early DQ — the coerced state is not_applicable. A context that says
      null (unknown) is genuinely unmeasurable and stays unmeasured. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/stage-eligibility');
const SR = require('../lib/section-ranking');
const P = require('../lib/rep-period-coaching');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');

const turns = Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? 'PROSPECT' : 'CLOSER', start_seconds: 10 * (i + 1), text: 'Turn ' + (i + 1) + ' of a real conversation about the program.' }));
const base = {
  sales_conversation: true, call_kind: 'initial',
  ending: { state: 'completed', evidence_turn_ids: [11, 12] },
  pitch: { occurred: true, evidence_turn_ids: [5] },
  price: { occurred: true, evidence_turn_ids: [6] },
  prior_presentation: { established: false, evidence_turn_ids: [] },
  objection: { occurred: true, evidence_turn_ids: [7] },
  finance: { state: 'not_assessed', discovered_stage: null, feasible_financing_ruled_out: null, evidence_turn_ids: [] },
  close_due: true,
};
const stage = (stage, state, score, grade, evidence_turn_ids, reason = 'Observed source work.') => ({ stage, state, score, grade, evidence_turn_ids, reason });
function payload(context, changes = {}) {
  const stages = [
    stage('intro', 'evaluated', 92, 'A', [1]),
    stage('discovery', 'evaluated', 61, 'D', [2, 3, 4]),
    stage('pitch', 'evaluated', 75, 'C', [5, 6]),
    stage('objection_handling', 'evaluated', 38, 'F', [7, 8]),
    stage('close', 'evaluated', 35, 'F', [9, 10]),
  ].map(row => changes[row.stage] ? { ...row, ...changes[row.stage] } : row);
  return { stage_assessment: { context, stages } };
}
const assess = (context, changes) => S.assessProduction(payload(context, changes), turns);
const states = r => Object.fromEntries(S.SECTIONS.map(k => [k, r.sections[k].state + (r.sections[k].score === null ? '' : ':' + r.sections[k].score)]));
const finance = (state, discovered_stage, extra = {}) => ({ state, discovered_stage, feasible_financing_ruled_out: state === 'genuine_dq', evidence_turn_ids: state === 'genuine_dq' ? [3, 9] : [], ...extra });

test('a LATE genuine financial DQ: Discovery keeps its mark, Objection and Close become not applicable, the pitch that happened is still scored', () => {
  const r = assess({ ...base, finance: finance('genuine_dq', 'late') });
  assert.equal(r.status, undefined, 'the record is not withheld');
  assert.deepEqual(states(r), { intro: 'evaluated:92', discovery: 'evaluated:61', pitch: 'evaluated:75', objection: 'not_applicable', close: 'not_applicable' });
  assert.match(r.sections.objection.reason, /disqualif/i);
  assert.match(r.sections.close.reason, /disqualif/i);
  assert.equal(r.sections.objection.grade, null); assert.equal(r.sections.close.score, null);
  assert.ok(r.sections.close.evidence.length >= 1, 'the grader\'s located evidence is kept on the coerced record');
  assert.deepEqual(r.context_invalid_fields, undefined, 'nothing about the context was invalid');
});

test('an EARLY genuine financial DQ: Discovery scores, pitch/objection/close are not applicable (was: unmeasured)', () => {
  const r = assess({ ...base, finance: finance('genuine_dq', 'discovery') });
  assert.deepEqual(states(r), { intro: 'evaluated:92', discovery: 'evaluated:61', pitch: 'not_applicable', objection: 'not_applicable', close: 'not_applicable' });
  assert.doesNotMatch(r.sections.pitch.state, /unmeasured/);
});

test('an expected_but_missed Close on a genuine DQ is not applicable too — a close was never due for someone who could never buy', () => {
  const r = assess({ ...base, finance: finance('genuine_dq', 'late') }, { close: { state: 'expected_but_missed', score: 20, grade: 'F' } });
  assert.equal(r.sections.close.state, 'not_applicable');
});

test('what is NOT a DQ is untouched: unresolved, not_assessed and qualified finance leave Objection and Close scored', () => {
  for (const f of [finance('unresolved', null), finance('not_assessed', null), finance('qualified', null)]) {
    const r = assess({ ...base, finance: f });
    assert.deepEqual(states(r), { intro: 'evaluated:92', discovery: 'evaluated:61', pitch: 'evaluated:75', objection: 'evaluated:38', close: 'evaluated:35' }, f.state);
  }
});

test('never due is not applicable; unknown stays unmeasured — no sales conversation and close not due', () => {
  const none = assess({ ...base, sales_conversation: false });
  S.SECTIONS.forEach(k => assert.equal(none.sections[k].state, 'not_applicable', k + ' when the context says no conversation'));
  const unknown = assess({ ...base, sales_conversation: null });
  S.SECTIONS.forEach(k => assert.equal(unknown.sections[k].state, 'unmeasured', k + ' when the context says unknown'));
  const notDue = assess({ ...base, close_due: false });
  assert.equal(notDue.sections.close.state, 'not_applicable');
  assert.equal(notDue.sections.objection.state, 'evaluated', 'only the close reads close_due');
  const dueUnknown = assess({ ...base, close_due: null });
  assert.equal(dueUnknown.sections.close.state, 'unmeasured');
});

test('the record says which rules produced it and the prompt carries the ruling beside the version', () => {
  assert.equal(S.VERSION, 'stage-eligibility-v19');
  const src = fs.readFileSync(path.join(__dirname, '../lib/analysis-worker.js'), 'utf8');
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v62-2026-09-11'/);
  const live = stripComments(src);
  assert.match(live, /GENUINE FINANCIAL DISQUALIFICATION[^']*not_applicable WHENEVER it is discovered/, 'the grader is told the rule');
  assert.match(live, /A prospect who can pay and does not want to is an objection/, 'and told what is not a DQ');
});

// ---------------------------------------------------------------- item 2: the floor
const S17 = require('../lib/stage-eligibility');
function eligibility(score) {
  const sections = Object.fromEntries(S17.SECTIONS.map(section => [section, { state: 'evaluated', score, grade: S17.canonicalGrade(Math.round(score)) }]));
  return { summary: { version: S17.VERSION, review_version: require('../lib/stage-eligibility-review').VERSION, factual_version: require('../lib/stage-observation-review').VERSION, source_hash: 'x', sections } };
}
function calls(n, score) {
  return Array.from({ length: n }, (_, i) => ({ id: 'c' + i, call_date: '2026-08-' + (20 + (i % 9)) + 'T13:00:00Z', analysis_status: 'done', analysis: { fathom_call_id: 'c' + i, status: 'done', stage_eligibility: eligibility(score) } }));
}
const window = { from: '2026-08-10', to: '2026-09-08' };

test('the team panel applies the rep page\'s floor from the same source: below it, no weakest area, the rep page\'s words', () => {
  const thin = P.summarize(calls(SR.MIN_CALLS_TO_RANK - 1, 63), [], window);
  assert.equal(thin.status, 'thin');
  assert.equal(thin.section, null); assert.equal(thin.score, null); assert.deepEqual(thin.tied_sections, []);
  assert.equal(thin.label, SR.THIN_LABEL);
  assert.equal(SR.THIN_LABEL, 'Not enough to judge');
  assert.equal(thin.note, 'only ' + (SR.MIN_CALLS_TO_RANK - 1) + ' calls graded in this period');
  assert.equal(thin.sections[0].calls, SR.MIN_CALLS_TO_RANK - 1, 'the counts still show');
  const ready = P.summarize(calls(SR.MIN_CALLS_TO_RANK, 63), [], window);
  assert.equal(ready.status, 'ready'); assert.equal(ready.score, 63); assert.equal(ready.note, null);
  const one = P.summarize(calls(1, 63), [], window);
  assert.equal(one.status, 'thin'); assert.equal(one.note, 'only 1 call graded in this period');
});

test('RENDERED: the panel below the floor shows the status words and never a lowest-scoring area', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'), live = stripComments(source);
  const rep = { user_id: 'a', name: 'Ava', calls: 9, recent_calls: [], items: [], improvements: [], line: null, period_summary: P.summarize(calls(9, 63), [], window) };
  const funcs = ['scoreColor', 'ymd', 'dayLabel', 'rangeLabelInclusive', 'coachingRepName', 'coachingRepWorkspaceHtml', 'coachingPeriodWorkspaceHtml', 'coachingPeriodExampleHtml', 'selectCoachingRep'].map(n => fnBody(live, n)).join('\n');
  const html = '<html><head>' + source.slice(source.indexOf('<style>'), source.indexOf('</style>') + 8) + '</head><body data-view="team-coaching"><main class="page" id="content"></main><script>'
    + 'var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];'
    + 'function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(){}'
    + 'var state=' + JSON.stringify({ teamCoachable: { reps: [rep] }, coachingSelectedRep: 'a' }) + ';' + funcs
    + ';document.querySelector("#content").innerHTML=coachingRepWorkspaceHtml(state.teamCoachable.reps);</script></body></html>';
  const r = renderComputed(html, '({text:document.body.innerText, note:(document.querySelector(".coaching-period-note")||{}).textContent||null, eyebrow:(document.querySelector(".coaching-period-eyebrow")||{}).textContent||null})');
  assert.ok(r.text.includes('Not enough to judge'));
  assert.equal(r.note, 'only 9 calls graded in this period');
  assert.doesNotMatch(r.text, /LOWEST-SCORING AREA|63\/ ?100/);
  assert.match(r.text, /9 graded calls/);
});
