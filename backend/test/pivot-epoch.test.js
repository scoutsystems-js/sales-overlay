'use strict';
/* THE PIVOT RACE (Justin, 2026-09-11; H775 — filed in H766, same family as its fix).
   An owner or manager pivoting on a WARM page could briefly see the previous viewer's count under a rep's
   name: `setUser` resets the rep-scoped state and `reloadAll` refires every personal lane, and an answer
   still in flight for the PREVIOUS viewer landed in the new viewer's state — "7 graded" under B's heading
   until B's own answer arrived. A rep's own login never sees it (their page fires the /me route alone), so it
   was a presentation defect, never a data leak. THE FIX IS THE TEAM LANES' MECHANISM AND NO OTHER: a view
   epoch (`viewEpoch`) bumped by both pivot doors (`setUser`, `setCallLibraryUser`), captured by every loader
   that fetches for the VIEWED user before its request, and compared on arrival — a stale answer is dropped
   before any state write and before the loading flag it no longer owns. This guard drives the REAL pivot
   doors, reset, `reloadAll`, the overview renderer and the calls-list loader in Electron over a fake wire whose
   answers land IN THE WRONG ORDER (the previous viewer's after the pivot), and asserts the DOM. Planted three
   ways: the discard removed; the epoch captured and compared but never bumped (call kept, effect dropped);
   the comparison `&& false`. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');

const source = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8');
const live = stripComments(source);
function decl(re) { const m = live.match(re); if (!m) throw new Error('declaration not found: ' + re); return m[0]; }

const REAL = ['setUser', 'setCallLibraryUser', 'resetRepScopedState', 'reloadAll', 'render', 'renderOverview', 'renderCoachingOverview', 'renderHeaderHtml',
  'avgScoreSubstat', 'glanceTileHtml', 'leadNumberHtml', 'closeRateDisplay', 'overviewCloseInstrumentHtml', 'objectionHandleRate', 'tileTrendHtml', 'scoreTrend', 'renderCoachSummary2',
  'fetchAnalytics2', 'isSelf', 'pivoted', 'personLabel', 'laneWaitHtml', 'armLaneWait', 'clearLaneWait', 'loadNeedsWork', 'fetchNeedsWork', 'loadSectionRank',
  'loadCallLibrary', 'fetchCallLibrary', 'renderCallLibrary', 'loadObjectionsIntel', 'fetchObjectionsIntel'];
const ASYNC = { reloadAll: 1, fetchAnalytics2: 1, loadNeedsWork: 1, fetchNeedsWork: 1, loadSectionRank: 1, loadCallLibrary: 1, fetchCallLibrary: 1, loadObjectionsIntel: 1, fetchObjectionsIntel: 1 };

function analytics(graded) {
  return { calls: { analyzed: graded, total_in_range: graded, processing: 0, error: 0 }, avg_score: { mean: 60, graded_calls: graded, win_mean: null, win_n: 0, other_mean: null, other_n: 0, prior_mean: null },
    objections: { calls_with_objection: 0, total_highlights: 0 }, prospect_close_rate: null, prospect_close_wins: 0, prospect_close_total: 0,
    sections: { intro: { avg: null, n: 0 }, discovery: { avg: null, n: 0 }, pitch: { avg: null, n: 0 }, objection: { avg: null, n: 0 }, close: { avg: null, n: 0 } },
    weakest_section: null, strongest_section: null, section_ranking_note: null, latest_one_things: [] };
}

function page() {
  const funcs = REAL.map(function (n) { return (ASYNC[n] ? 'async ' : '') + fnBody(live, n); }).join('\n');
  const state = 'var state={me:{user_id:"me",role:"owner"},users:[{user_id:"me",email:"me@x"},{user_id:"A",first_name:"Ann",last_name:"A",email:"a@x"},{user_id:"B",first_name:"Bea",last_name:"B",email:"b@x"}],'
    + 'viewingUserId:"me",view:"overview",dateRange:{from:"2026-09-01",to:"2026-09-10"},analytics2:null,needsWork:null,needsWorkLoading:false,sectionRank:null,sectionRankLoading:false,'
    + 'repGraph:null,repGraphLoading:false,perfSynthesis:null,overviewRecent:null,laneWaitLong:{},fathomStatus:null,zoomStatus:null,gradingBacklog:null,'
    + 'callLibrary:null,callLibraryLoading:false,callLibraryHasMore:false,callLibraryOffset:0,callLibraryError:null,callLibraryCounts:null,callLibraryFilter:null,callLibrarySort:null,'
    + 'objectionsIntel:null,objectionsIntelLoading:false,selectedCallId:null,callReview:null};';
  const vars = [decl(/var PIVOT_KEEP = \{[\s\S]*?\n  \};/), decl(/var laneWaitTimers = \{\};/), decl(/var PERF_LONG_WAIT_MS = \d+;/), decl(/var viewEpoch = 0;/)].join('\n');
  return '<html><head></head><body><main class="page" id="content"></main><script>'
    + 'window.REJECTIONS=[];window.addEventListener("unhandledrejection",function(e){REJECTIONS.push(String(e.reason&&e.reason.stack||e.reason));});window.addEventListener("error",function(e){REJECTIONS.push(String(e.message));});'
    + 'function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}'
    + 'function roleLabel(r){return r;}function trendArrow(){return "";}function scoreColor(){return "";}function authHeader(){return {};}function clearSession(){}function markDashboardReady(){}'
    + 'function renderFathomNoticeHtml(){return "";}function renderFathomSectionHtml(){return "";}function renderZoomSectionHtml(){return "";}function getStartedCardHtml(){return "";}'
    + 'function observatoryHudHtml(){return "";}'
    + 'function observeObservatoryLayout(){}'
    + 'function repOwnGraphHtml(){return "";}function sectionRankCardHtml(){return "";}function needsWorkCardHtml(){return "";}function perfFeatureCardHtml(){return "";}function drawRepOwnChart(){}function repOwnGraphVisible(){return false;}'
    + 'function ensureCoachingPicker(){}function datePickerHtml(){return "";}function summaryBtnHtml(){return "";}function updateNavActiveStates(){}function isTeamView(){return false;}'
    + 'function renderNeedsWorkView(){}function renderObjectionsIntel(){}function renderCallReview(){}function renderSectionView(){}function renderEodView(){}function renderAccountView(){}function renderKbView(){}function renderProspectsView(){}function renderTeamDigest(){}function renderTeamPerformance(){}function renderTeamCoaching(){}function renderTeamObjectionsView(){}function renderTeamMembersView(){}function renderTeamDashboard(){}function renderPerformanceView(){}'
    + 'function renderCallLibraryHeaderHtml(){return "<h1>Calls</h1>";}function renderCallLibrarySkeletonsHtml(){return "<div class=lib-wait>waiting</div>";}function callLibraryEmptyHtml(){return "<div>none</div>";}function callLibraryCardHtml(c){return "<div class=\\"lib-card\\">"+escapeHtml(c.title)+"</div>";}'
    + 'function canSeeVerdictQueue(){return false;}function hasManagerContext(){return false;}function callsRange(){return null;}function loadVerdictQueue(){}function verdictQueueHtml(){return "";}'
    + state + '\n' + vars + '\nvar INITIAL_STATE = JSON.parse(JSON.stringify(state));\n' + funcs + '\n'
    /* THE FAKE WIRE: every request is logged and answered only when the probe says so. */
    + 'var LOG=[];var PENDING={};window.fetch=function(url){var key=url.split("?")[0];LOG.push(key);return new Promise(function(resolve){(PENDING[key]=PENDING[key]||[]).push(function(body){resolve({ok:true,status:200,json:function(){return Promise.resolve(body);}});});});};'
    + 'function answer(key,body){var q=PENDING[key]||[];var fn=q.shift();if(!fn)throw new Error("nothing pending for "+key+" | log "+JSON.stringify(LOG));fn(body);return new Promise(function(r){setTimeout(r,30);});}'
    + 'function tick(){return new Promise(function(r){setTimeout(r,20);});}'
    + 'function dom(){var c=document.getElementById("content");var h=c.querySelector("h1");return {heading:h&&h.firstChild?h.firstChild.textContent:null,graded:(c.innerText.match(/(\\d+) graded/)||[])[1]||null,cards:[].slice.call(c.querySelectorAll(".lib-card")).map(function(e){return e.textContent;}),wait:!!c.querySelector(".lane-wait, .lib-wait, .glance-skeleton")};}'
    + '</script></body></html>';
}

/* The owner opens Ann's board, then Bea's, while Ann's answer is still in flight; Ann's answer lands AFTER the pivot. */
const OVERVIEW = `(async () => {
  const out = {};
  try {
    setUser('A'); await tick();
    setUser('B'); await tick();
    out.requests = LOG.slice();
    out.epoch = viewEpoch;
    await answer('/admin/analytics2/A', ${JSON.stringify(analytics(7))});   // the PREVIOUS viewer's answer lands after the pivot
    out.afterStale = Object.assign(dom(), { analytics2: state.analytics2 && state.analytics2.avg_score.graded_calls });
    await answer('/admin/analytics2/B', ${JSON.stringify(analytics(12))});  // the current viewer's answer
    out.final = Object.assign(dom(), { analytics2: state.analytics2 && state.analytics2.avg_score.graded_calls });
    out.rejections = REJECTIONS;
  } catch (e) { out.error = String(e && e.stack || e) + ' | rejections: ' + JSON.stringify(REJECTIONS) + ' | log: ' + JSON.stringify(LOG); }
  return out;
})()`;

test('the previous viewer\'s analytics answer, landing after a pivot, never reaches the new viewer\'s page', function () {
  const r = renderComputed(page(), OVERVIEW);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.rejections, [], 'no loader may reject silently in the harness');
  assert.deepEqual(r.requests, ['/admin/analytics2/A', '/admin/analytics2/B'], 'each pivot fires its own request');
  assert.equal(r.epoch, 2, 'each pivot bumps the view epoch');
  assert.equal(r.afterStale.heading, 'Bea B', 'the heading is the current viewer');
  assert.equal(r.afterStale.analytics2, null, 'the stale answer is discarded, never stored');
  assert.equal(r.afterStale.graded, null, 'the previous viewer\'s count is not on the page');
  assert.equal(r.afterStale.wait, true, 'the page is still waiting for the current viewer, in words');
  assert.equal(r.final.heading, 'Bea B');
  assert.equal(r.final.analytics2, 12);
  assert.equal(r.final.graded, '12', 'the current viewer\'s count is on the page once their answer lands');
});

/* The second pivot door: the calls list. Ann's list lands after the pivot to Bea. */
const LIBRARY = `(async () => {
  const out = {};
  try {
    state.view = 'call-library';
    setCallLibraryUser('A'); await tick();
    setCallLibraryUser('B'); await tick();
    out.requests = LOG.slice();
    await answer('/admin/fathom-calls/A', { calls: [{ id: 'a1', title: 'Ann call' }], outcome_counts: {} });
    out.afterStale = Object.assign(dom(), { list: state.callLibrary && state.callLibrary.map(function (c) { return c.title; }), loading: state.callLibraryLoading });
    await answer('/admin/fathom-calls/B', { calls: [{ id: 'b1', title: 'Bea call' }], outcome_counts: {} });
    out.final = Object.assign(dom(), { list: state.callLibrary && state.callLibrary.map(function (c) { return c.title; }), loading: state.callLibraryLoading });
    out.rejections = REJECTIONS;
  } catch (e) { out.error = String(e && e.stack || e) + ' | rejections: ' + JSON.stringify(REJECTIONS) + ' | log: ' + JSON.stringify(LOG); }
  return out;
})()`;

test('the calls list: the previous viewer\'s calls, landing after a pivot, never reach the new viewer\'s list', function () {
  const r = renderComputed(page(), LIBRARY);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.rejections, []);
  assert.deepEqual(r.requests, ['/admin/fathom-calls/A', '/admin/fathom-calls/B']);
  assert.equal(r.afterStale.list, null, 'the stale list is discarded');
  assert.deepEqual(r.afterStale.cards, [], 'no card from the previous viewer');
  assert.equal(r.afterStale.loading, true, 'the current request still owns its loading flag after the discard');
  assert.deepEqual(r.final.cards, ['Bea call']);
  assert.deepEqual(r.final.list, ['Bea call']);
});

test('every loader that fetches for the VIEWED user captures the epoch before its request and compares it on arrival', function () {
  const viewed = ['reloadAll', 'loadNeedsWork', 'loadSectionRank', 'loadPerfSynthesis', 'loadRepGraph', 'loadSectionBreakdown', 'loadObjectionsSynthesis', 'loadObjectionsIntel', 'loadCallLibrary'];
  viewed.forEach(function (n) {
    const body = fnBody(live, n);
    assert.match(body, /var epoch = viewEpoch;/, n + ' captures the epoch');
    assert.ok((body.match(/epoch !== viewEpoch/g) || []).length >= 1, n + ' compares it on arrival');
  });
  ['setUser', 'setCallLibraryUser'].forEach(function (n) { assert.match(fnBody(live, n), /viewEpoch\+\+;/, n + ' bumps the epoch'); });
});
