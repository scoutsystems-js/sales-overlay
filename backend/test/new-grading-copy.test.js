'use strict';
/* THE ZERO EXPLAINS ITSELF (Justin, 2026-09-08).
   On day one of stage grading every historical row reads legacy_unreviewed, so a
   rep with 120 analysed calls showed "Awaiting grades" and "0 graded calls" on the
   same screen as "58 team average" — read as broken, not as waiting. ONE sentence
   (lib/new-grading-copy.js) sits beside every zero the stage population produces,
   says the calls WERE analysed, that the new grading starts with new calls, and
   what makes it change. It is TEMPORARY BY CONSTRUCTION: it can only appear when a
   section has zero counted calls AND rows in the window predate stage grading
   (legacy_unreviewed > 0). Once a period has a counted call the normal states
   ("only N calls graded", the ranked score) take over and the sentence is gone.
   Executed here on the lib, on both routes over a fake wire, and RENDERED on the
   three page surfaces. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');
const S = require('../lib/stage-eligibility');
const SR = require('../lib/section-ranking');
const P = require('../lib/rep-period-coaching');
const C = require('../lib/new-grading-copy');
const me = require('../routes/me');

const source = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8');
const live = stripComments(source);

function eligibility(state, score) {
  const sections = Object.fromEntries(S.SECTIONS.map(function (section) {
    return [section, { state: state, score: score, grade: score == null ? null : S.canonicalGrade(Math.round(score)) }];
  }));
  return { summary: { version: S.VERSION, review_version: require('../lib/stage-eligibility-review').VERSION,
    factual_version: require('../lib/stage-observation-review').VERSION, source_hash: 'x', sections: sections } };
}
function legacyRow(i) {
  return { fathom_call_id: 'legacy-' + i, status: 'done', intro_score: 70, discovery_score: 60, pitch_score: 65,
    objection_score: 55, close_score_earned: 50, prospect_name: 'Legacy ' + i };
}
function evaluatedRow(i, score) {
  return { fathom_call_id: 'new-' + i, status: 'done', intro_score: 1, discovery_score: 1, pitch_score: 1,
    objection_score: 1, close_score_earned: 1, prospect_name: 'New ' + i, stage_eligibility: eligibility('evaluated', score) };
}
const LEGACY = [1, 2, 3, 4, 5].map(legacyRow);
const NEW = [60, 65, 70, 75, 80, 85, 90, 72, 68, 77].map(function (s, i) { return evaluatedRow(i, s); });

test('the sentence is one source: about new grading, says what changes it, no error words, no internal vocabulary', function () {
  const note = C.newGradingNote(120);
  assert.match(note, /120 calls/);
  assert.match(note, /analys/i);
  assert.match(note, /new calls/i);
  assert.doesNotMatch(note, /error|fail|missing|legacy|v\d\d|eligib|stage_|unreviewed|population/i);
  assert.equal(typeof C.LABEL, 'string');
  assert.doesNotMatch(C.LABEL, /await|error|legacy/i);
  assert.equal(C.newGradingNote(1).includes('1 call '), true);
});

test('section ranking: legacy-only windows carry the sentence per section; a counted call removes it', function () {
  const legacyOnly = SR.rankSections(SR.sectionStatsFromAnalyses(LEGACY));
  legacyOnly.forEach(function (s) {
    assert.equal(s.awaiting_new_grading, true, s.section);
    assert.equal(s.n, 0);
    assert.equal(s.reason, C.newGradingNote(5));
  });
  const mixed = SR.rankSections(SR.sectionStatsFromAnalyses(LEGACY.concat([evaluatedRow(9, 70)])));
  mixed.forEach(function (s) {
    assert.equal(s.awaiting_new_grading, false, s.section + ' has a counted call');
    assert.match(s.reason, /only 1 call graded/);
    assert.doesNotMatch(s.reason, /new calls come in/);
  });
  const ranked = SR.rankSections(SR.sectionStatsFromAnalyses(NEW));
  ranked.forEach(function (s) { assert.equal(s.awaiting_new_grading, false); assert.equal(s.enough, true); assert.equal(s.reason, null); });
  const empty = SR.rankSections(SR.sectionStatsFromAnalyses([]));
  empty.forEach(function (s) { assert.equal(s.awaiting_new_grading, false); assert.equal(s.reason, 'no graded calls in this period'); });
  // A zero that is NOT about new grading (every call not applicable) keeps the plain reason.
  const na = SR.rankSections(SR.sectionStatsFromAnalyses([{ fathom_call_id: 'na', status: 'done', stage_eligibility: eligibility('not_applicable', null) }]));
  na.forEach(function (s) { assert.equal(s.awaiting_new_grading, false); assert.equal(s.reason, 'no graded calls in this period'); });
});

test('rep period summary: legacy-only windows carry the label and the note; a ready window carries neither', function () {
  const window = { from: '2026-08-10', to: '2026-09-08' };
  const calls = LEGACY.map(function (a, i) { return { id: a.fathom_call_id, call_date: '2026-09-0' + (i + 1) + 'T12:00:00Z', analysis_status: 'done', analysis: a }; });
  const legacy = P.summarize(calls, [], window);
  assert.equal(legacy.status, 'ungraded');
  assert.equal(legacy.label, C.LABEL);
  assert.equal(legacy.awaiting_new_grading, true);
  assert.equal(legacy.note, C.newGradingNote(5));
  legacy.sections.forEach(function (s) { assert.equal(s.calls, 0); });
  const ready = P.summarize(calls.concat(NEW.map(function (a, i) { return { id: a.fathom_call_id, call_date: '2026-08-' + (20 + i) + 'T13:00:00Z', analysis_status: 'done', analysis: a }; })), [], window);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.awaiting_new_grading, false);
  assert.equal(ready.note, null);
  assert.notEqual(ready.label, C.LABEL);
  const none = P.summarize([], [], window);
  assert.equal(none.label, 'No calls');
  assert.equal(none.note, null);
});

function fakeAdmin(analyses) {
  const calls = analyses.map(function (a, i) { return { id: a.fathom_call_id, user_id: 'rep', call_date: '2026-09-0' + ((i % 8) + 1) + 'T10:00:00Z', source: 'fathom', recording_url: null }; });
  return { from: function (table) {
    const q = { ids: null, prior: false,
      select: function () { return q; }, in: function (_c, v) { q.ids = v; return q; }, eq: function () { return q; },
      gte: function () { return q; }, lte: function () { return q; }, lt: function () { q.prior = true; return q; },
      not: function () { return q; }, is: function () { return q; }, order: function () { return q; }, range: function () { return q; },
      then: function (resolve, reject) {
        let data = [];
        if (table === 'fathom_calls') data = q.prior ? [] : calls;
        if (table === 'call_analyses') data = analyses.filter(function (r) { return !q.ids || q.ids.includes(r.fathom_call_id); });
        if (table === 'call_highlights') data = [];
        return Promise.resolve({ data: data, error: null }).then(resolve, reject);
      } };
    return q;
  } };
}

test('both routes carry the flag and the note over the wire; neither once the window has counted calls', async function () {
  const from = '2026-09-01T00:00:00Z', to = '2026-09-09T00:00:00Z';
  const needs = await me._computeNeedsWorkSections(fakeAdmin(LEGACY), 'rep', from, to);
  needs.sections.forEach(function (s) { assert.equal(s.awaiting_new_grading, true); assert.equal(s.reason, C.newGradingNote(5)); });
  const drill = await me._computeSectionBreakdown(fakeAdmin(LEGACY), 'rep', 'discovery', from, to);
  assert.equal(drill.scored_calls, 0);
  assert.equal(drill.awaiting_new_grading, true);
  assert.equal(drill.note, C.newGradingNote(5));
  const needs2 = await me._computeNeedsWorkSections(fakeAdmin(NEW), 'rep', from, to);
  needs2.sections.forEach(function (s) { assert.equal(s.awaiting_new_grading, false); });
  const drill2 = await me._computeSectionBreakdown(fakeAdmin(NEW), 'rep', 'discovery', from, to);
  assert.equal(drill2.awaiting_new_grading, false);
  assert.equal(drill2.note, null);
  assert.equal(drill2.scored_calls, 10);
});

function shell(body, funcs, stateJs) {
  return '<html><head>' + source.slice(source.indexOf('<style>'), source.indexOf('</style>') + 8) + '</head><body data-view="team-coaching"><main class="page" id="content"></main><script>'
    + 'var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];'
    + 'function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}'
    + 'function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(){}'
    + 'function laneWaitHtml(){return "<p>wait</p>";}function laneFailureCopy(){return "failed";}function cycleSectionRank(){}function clipLinkHtml(){return "";}'
    + 'var state=' + stateJs + ';'
    + funcs.map(function (n) { return fnBody(live, n); }).join('\n')
    + ';document.querySelector("#content").innerHTML=' + body + ';</script></body></html>';
}
const WORKSPACE_FUNCS = ['scoreColor', 'ymd', 'dayLabel', 'rangeLabelInclusive', 'coachingRepName', 'coachingRepWorkspaceHtml', 'coachingPeriodWorkspaceHtml', 'coachingPeriodExampleHtml', 'selectCoachingRep'];

/* Block 018 (the reset) re-pinned this surface: Team → Coaching no longer shows a stage population or a zero, so H765's sentence has nothing
   to sit beside there — the panel says its one plain sentence when no verified example exists, and never "Awaiting grades" or a zero count.
   The payload still carries the label and the note (asserted above, both routes) for the surfaces that show a zero: the rep card and the
   drilldown, rendered below. Was: the sentence beside the zero on the Team → Coaching panel and rep list. */
test('RENDERED: Team → Coaching panel and rep list — no zero, no counting sentence, no "Awaiting grades" on a legacy window; nothing numerical on a ready one either', function () {
  const window = { from: '2026-08-10', to: '2026-09-08' };
  const legacyCalls = LEGACY.map(function (a, i) { return { id: a.fathom_call_id, call_date: '2026-09-0' + (i + 1) + 'T12:00:00Z', analysis_status: 'done', analysis: a }; });
  const legacyRep = { user_id: 'a', name: 'Ava', calls: 5, recent_calls: [], items: [], improvements: [], line: null, period_summary: P.summarize(legacyCalls, [], window) };
  const readyRep = { user_id: 'b', name: 'Bo', calls: 10, recent_calls: [], items: [], improvements: [], line: null,
    period_summary: P.summarize(NEW.map(function (a, i) { return { id: a.fathom_call_id, call_date: '2026-08-' + (20 + i) + 'T13:00:00Z', analysis_status: 'done', analysis: a }; }), [], window) };
  assert.equal(legacyRep.period_summary.label, C.LABEL, 'the payload still carries the label for the surfaces that show a zero');
  const legacy = renderComputed(shell('coachingRepWorkspaceHtml(state.teamCoachable.reps)', WORKSPACE_FUNCS, JSON.stringify({ teamCoachable: { reps: [legacyRep] }, coachingSelectedRep: 'a' })),
    '({text:document.body.innerText, note:document.querySelector(".coaching-period-note"), cells:document.querySelectorAll(".coaching-section-cell").length, empty:(document.querySelector(".coaching-period-empty")||{}).textContent||null, list:[...document.querySelectorAll(".coaching-rep-choice")].map(b=>b.textContent.trim())})');
  assert.equal(legacy.note, null, 'Block 018: no zero is shown on this view, so no sentence beside one');
  assert.equal(legacy.cells, 0); assert.deepEqual(legacy.list, ['Ava'], 'the rep list is names only');
  assert.equal(legacy.empty, 'No coachable call found for these dates.');
  assert.doesNotMatch(legacy.text, /Awaiting grades|0 graded call|none counted yet|new calls come in/);
  const ready = renderComputed(shell('coachingRepWorkspaceHtml(state.teamCoachable.reps)', WORKSPACE_FUNCS, JSON.stringify({ teamCoachable: { reps: [readyRep] }, coachingSelectedRep: 'b' })),
    '({text:document.body.innerText, note:document.querySelector(".coaching-period-note"), cells:document.querySelectorAll(".coaching-section-cell").length})');
  assert.equal(ready.note, null); assert.equal(ready.cells, 0);
  assert.doesNotMatch(ready.text, /new calls come in|none counted yet|graded call/);
});

test('RENDERED: the rep dashboard "What Needs Work" card — label and sentence on a legacy window, the thin state otherwise', function () {
  const legacy = SR.rankSections(SR.sectionStatsFromAnalyses(LEGACY));
  const r1 = renderComputed(shell('sectionRankCardHtml()', ['sectionRankCardHtml'], JSON.stringify({ sectionRank: { sections: legacy }, sectionRankIndex: 0 })), 'document.body.innerText');
  assert.ok(r1.includes(C.LABEL));
  assert.ok(r1.includes(C.newGradingNote(5)));
  assert.doesNotMatch(r1, /Not enough to judge|no graded calls/);
  const thin = SR.rankSections(SR.sectionStatsFromAnalyses(NEW.slice(0, 3)));
  const r2 = renderComputed(shell('sectionRankCardHtml()', ['sectionRankCardHtml'], JSON.stringify({ sectionRank: { sections: thin }, sectionRankIndex: 0 })), 'document.body.innerText');
  assert.match(r2, /Not enough to judge/);
  assert.match(r2, /only 3 calls graded/);
  assert.doesNotMatch(r2, /new calls come in/);
});

test('RENDERED: the section drilldown headline — the sentence replaces "average across 0 calls" on a legacy window only', function () {
  const r1 = renderComputed(shell('sectionHeadlineHtml(state.sectionData)', ['sectionHeadlineHtml'], JSON.stringify({ sectionData: { average: null, scored_calls: 0, rank: null, section_count: 5, awaiting_new_grading: true, note: C.newGradingNote(5) } })), 'document.body.innerText');
  assert.ok(r1.includes(C.newGradingNote(5)));
  assert.doesNotMatch(r1, /average across 0/);
  const r2 = renderComputed(shell('sectionHeadlineHtml(state.sectionData)', ['sectionHeadlineHtml'], JSON.stringify({ sectionData: { average: 71, scored_calls: 7, rank: 2, section_count: 5, awaiting_new_grading: false, note: null } })), 'document.body.innerText');
  assert.match(r2, /average across 7 calls/);
  assert.doesNotMatch(r2, /new calls come in/);
});
