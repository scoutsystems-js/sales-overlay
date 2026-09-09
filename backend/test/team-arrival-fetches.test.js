'use strict';
/* ARRIVAL AND RENDER CANNOT COME APART (H766).

   Measured on the live Team → Coaching page, 2026-09-08: ONE cold arrival fetched
   /team/context FOUR times and /team/coachable-moments THREE times. Why, exactly:
     1. `context` had NO in-flight flag, so every render pass that found
        `state.teamContext === null` fired another request — and the page renders
        several times while the first is in flight (the personal lanes land, the
        lane-wait timer re-renders). Four renders, four requests.
     2. The FIRST context answer applies the saved team pick → resetTeamData bumps
        the epoch and refetches the lanes (the legitimate second fetch).
     3. A lane answer from the OLD epoch is discarded — but the discard also
        CLEARED THE LANE'S LOADING FLAG, which by then belonged to the NEWER
        request in flight. The next render saw "null and not loading" and fired
        a THIRD request. Each coachable request costs the server 10–16 s.
   The page did paint once the tab was visible: the scheduler runs on
   requestAnimationFrame, which browsers pause in a hidden tab — that was the
   "never paints" observation, and it is not a page defect. What IS the page's
   is the duplicate fetching, fixed here at the loader: `context` carries a flag
   like every other lane, and a stale discard never touches a flag it no longer
   owns. This guard drives the REAL loader, scheduler, reset, pick-restore and
   coaching renderer in Electron over a fake wire whose answers land OUT OF
   ORDER, and asserts the DOM — the panel painted with the post-pick team — and
   the request log. Planted three ways (see the plant script in H766): the
   context flag removed → four requests; the discard removed → the pre-pick
   team paints; the render suppressed while the state is set → the wait copy
   stays. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');
const P = require('../lib/rep-period-coaching');

const source = fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8');
const live = stripComments(source);
function decl(re) { const m = live.match(re); if (!m) throw new Error('declaration not found: ' + re); return m[0]; }

const REAL = ['loadTeam', 'fetchTeamJSON', 'armLaneWait', 'clearLaneWait', 'scheduleTeamRender', 'renderTeamSurface', 'resetTeamData', 'restoreTeamPick',
  'renderTeamCoaching', 'teamCoachableHtml', 'teamRecsHtml', 'laneWaitHtml', 'laneProblem', 'laneProblemHtml', 'noMaterialHtml', 'isTeamView', 'teamQP',
  'coachingRepWorkspaceHtml', 'coachingPeriodWorkspaceHtml', 'coachingPeriodExampleHtml', 'coachingRepName', 'selectCoachingRep', 'scoreColor', 'ymd', 'dayLabel', 'rangeLabelInclusive'];

function rep(id, name) {
  const calls = [1, 2, 3].map(function (i) { return { id: id + '-' + i, call_date: '2026-09-0' + i + 'T12:00:00Z', analysis_status: 'done', analysis: { intro_score: 70 } }; });
  return { user_id: id, name: name, calls: 3, recent_calls: [], items: [], improvements: [], line: null, period_summary: P.summarize(calls, [], { from: '2026-09-01', to: '2026-09-08' }) };
}
const PRE_PICK = { reps: [rep('a', 'Pre Pick')], total_items: 0, by_kind: {}, from: '2026-09-01', to: '2026-09-08' };
const POST_PICK = { reps: [rep('b', 'Post Pick')], total_items: 0, by_kind: {}, from: '2026-09-01', to: '2026-09-08' };

function page() {
  /* fnBody slices from the word `function`, which drops a leading `async` — restore it for the two async loaders. */
  const ASYNC = { loadTeam: true, fetchTeamJSON: true };
  const funcs = REAL.map(function (n) { return (ASYNC[n] ? 'async ' : '') + fnBody(live, n); }).join('\n');
  const vars = [decl(/var TEAM_LANE_SCOPE = \{[\s\S]*?\n  \};/), decl(/var teamEpoch = 0;/), decl(/var laneWaitTimers = \{\};/), decl(/var teamRenderQueued = false;/),
    decl(/var PERF_LONG_WAIT_MS = \d+;/), decl(/var TEAM_PICK_KEY = '[^']+';/), decl(/var TEAM_PAGES = \[[\s\S]*?\];/)].join('\n');
  return '<html><head>' + source.slice(source.indexOf('<style>'), source.indexOf('</style>') + 8) + '</head><body data-view="team-coaching"><main class="page" id="content"></main><script>'
    + 'window.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };window.REJECTIONS=[];window.addEventListener("unhandledrejection",function(e){REJECTIONS.push(String(e.reason&&e.reason.stack||e.reason));});window.addEventListener("error",function(e){REJECTIONS.push(String(e.message));});'   /* the browser pauses rAF in a hidden window; the page\'s scheduling is what is under test */
    + 'var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];'
    + 'function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}'
    + 'function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(){}'
    + 'function teamRange(){return state.teamRange;}function repSeriesBucket(){return "week";}function authHeader(){return {};}function clearSession(){}function loadRepFilter(){}function loadNotedMoments(){}function ensureTeamDefaultRange(){}'
    + 'function teamHeaderHtml(){return "";}function teamControlsHtml(){return "";}function leadNumberHtml(){return "";}function teamPanelVisible(){return true;}'
    + 'function allPanelsHiddenNoteHtml(){return "";}function teamInsightHtml(){return "";}function laneFailureCopy(){return "failed";}function dashRenderPicker(){}'
    + 'function renderTeamDigest(){}function renderTeamPerformance(){}function renderTeamObjectionsView(){}function renderTeamMembersView(){}function renderTeamDashboard(){}function setView(v){state.view=v;}'
    + 'var state={view:"team-coaching",teamContext:null,teamSelected:null,teamOverview:null,teamRecs:null,teamCoachable:null,teamRange:{from:"2026-09-01",to:"2026-09-08"},laneWaitLong:{},coachingSelectedRep:null,coachingSelectedMoment:0,dateRange:{from:"2026-09-01",to:"2026-09-08"}};'
    + vars + '\n' + funcs + '\n'
    /* THE FAKE WIRE: every request is logged and answered only when the probe says so. */
    + 'var LOG=[];var PENDING={};window.fetch=function(url){var key=url.split("?")[0];LOG.push(key);return new Promise(function(resolve){(PENDING[key]=PENDING[key]||[]).push(function(body){resolve({ok:true,status:200,json:function(){return Promise.resolve(body);}});});});};'
    + 'function answer(key,body){var q=PENDING[key]||[];var fn=q.shift();if(!fn)throw new Error("nothing pending for "+key);fn(body);return new Promise(function(r){setTimeout(r,25);});}'
    + 'function count(key){return LOG.filter(function(k){return k===key;}).length;}'
    + 'function panel(){var c=document.getElementById("content");var sec=[].slice.call(c.querySelectorAll(".section")).filter(function(x){return /Coachable Moments/.test(x.textContent);})[0];return {text:sec?sec.innerText:c.innerText,reps:[].slice.call(c.querySelectorAll(".coaching-rep-choice strong")).map(function(e){return e.textContent;})};}'
    + 'try{localStorage.setItem(' + decl(/var TEAM_PICK_KEY = '[^']+';/).replace(/^var TEAM_PICK_KEY = /, '').replace(/;$/, '') + ',"sober");}catch(e){}'
    + '</script></body></html>';
}

/* The live arrival, in the order the network actually delivered it. */
const SEQUENCE = `(async () => {
  const out = {};
  try {
  renderTeamCoaching();                       // arrival: context + overview + recs + coachable
  renderTeamCoaching(); renderTeamCoaching(); // the page re-renders while context is in flight (personal lanes land, the wait timer fires)
  await new Promise(r => setTimeout(r, 30));
  out.contextRequestsBeforeAnswer = count('/team/context');
  await answer('/team/coachable-moments', ${JSON.stringify(PRE_PICK)});   // the pre-pick team answers first
  out.paintedPrePick = panel().reps;
  await answer('/team/context', { teams: [{ key: 'sober', user_id: 'sober', name: 'Sober' }] });   // the saved pick applies → epoch bump → refetch
  out.epochAfterPick = teamEpoch; out.selected = state.teamSelected;
  await answer('/team/overview', { totals: { avg_score: 50 } });          // a STALE-epoch answer lands now
  out.overviewAfterStale = state.teamOverview; out.overviewLoadingAfterStale = state.teamOverviewLoading;
  renderTeamCoaching();                       // any later render — must NOT fire a third coachable request
  await new Promise(r => setTimeout(r, 30));
  out.coachableRequests = count('/team/coachable-moments');
  out.contextRequests = count('/team/context');
  await answer('/team/coachable-moments', ${JSON.stringify(POST_PICK)});  // the post-pick team answers
  await new Promise(r => setTimeout(r, 60));
  out.final = panel();
  out.renderQueued = teamRenderQueued;
  out.rejections = REJECTIONS;
  } catch (e) { out.error = String(e && e.stack || e) + " | rejections: " + JSON.stringify(REJECTIONS) + " | log: " + JSON.stringify(LOG); }
  return out;
})()`;

test('one arrival fetches context once, the lanes at most twice, and paints the post-pick team when its answer lands', function () {
  const r = renderComputed(page(), SEQUENCE);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.rejections, [], 'no loader may reject silently in the harness');
  assert.equal(r.contextRequestsBeforeAnswer, 1, 'context is requested once per arrival, however many renders happen while it is in flight');
  assert.deepEqual(r.paintedPrePick, ['Pre Pick'], 'the first answer paints (nothing is held back before the pick)');
  assert.equal(r.epochAfterPick, 1); assert.equal(r.selected, 'sober');
  assert.equal(r.overviewAfterStale, null, 'a stale-epoch answer is discarded, never stored');
  assert.equal(r.overviewLoadingAfterStale, true, 'the newer overview request still owns its flag after the stale discard');
  assert.equal(r.coachableRequests, 2, 'arrival + after the pick; a stale discard never frees the newer request\'s flag for a third');
  assert.equal(r.contextRequests, 1);
  assert.deepEqual(r.final.reps, ['Post Pick'], 'the panel shows the post-pick team, painted by the page itself');
  assert.doesNotMatch(r.final.text, /Still working|Reading the team/, 'the Coachable Moments panel (the recs lane is deliberately left pending) carries no wait copy');
  assert.equal(r.renderQueued, false);
});
