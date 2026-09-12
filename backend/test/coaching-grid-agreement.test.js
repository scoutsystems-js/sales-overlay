'use strict';
/* BLOCK 016 (SCOUT-SHARED-CONTEXT.md) — THE OVERVIEW AND THE STAGE GRID ANSWER FROM ONE CALCULATION.
   Justin's signed-in screenshots (Sep 7–11): the Coaching Overview named "Discovery 73" as Gabriel's lowest area while
   the Stage Scores grid beneath it showed Objection Handling 69 and Close 61; Nick's named "Discovery 80" above
   Objection Handling 73. Cause: the overview names the lowest stage among those AT THE TEN-CALL FLOOR (H768,
   rankSections' `enough`), while the grid drew every stage's mean with no sign of the floor — two different answers
   from one payload. The fix makes the grid read the SAME ranking: each cell carries `enough` from rankSections; a cell
   below the floor keeps its score but is drawn in the not-rankable state with the ruled words ("not enough to judge")
   and cannot be the lowest; and a tie at the DISPLAYED precision (two stages that both render 78) is a joint lowest,
   so the overview never names one 78 above another 78. No grade, eligibility record, evidence, diagnosis rule or stored
   row changes. Rendered, because the property is what a manager reads. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fnBody,stripComments}=require('./helpers/strip-comments'),{renderComputed}=require('./helpers/electron-render');
const source=fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8'),live=stripComments(source);
const P=require('../lib/rep-period-coaching');
const S=require('../lib/stage-eligibility');
const {MIN_CALLS_TO_RANK}=require('../lib/section-ranking');
function assessed(scores){const sections=Object.fromEntries(S.SECTIONS.map(section=>{const score=section==='close'?scores.close_score_earned:scores[section+'_score'];return [section,typeof score==='number'?{state:'evaluated',score,grade:S.canonicalGrade(Math.round(score))}:{state:'not_applicable',score:null,grade:null}];}));return {...scores,stage_eligibility:{summary:{version:S.VERSION,review_version:require('../lib/stage-eligibility-review').VERSION,factual_version:require('../lib/stage-observation-review').VERSION,source_hash:'test-source',sections}}};}
const window={from:'2026-09-07',to:'2026-09-11T23:59:59Z'};
/* Gabriel's shape: Intro 77, Discovery 73 and Pitch 80 on 16 calls (at the floor); Objection Handling 69 on 7 calls and Close 61 on 8 (below it, not applicable on the rest). */
function gabriel(){return Array.from({length:16},(_,i)=>({id:'g'+i,call_date:'2026-09-'+String(7+(i%5)).padStart(2,'0')+'T10:00:00Z',analysis_status:'done',analysis:assessed({intro_score:77,discovery_score:73,pitch_score:80,objection_score:i<7?69:undefined,close_score_earned:i<8?61:undefined}),period_review_current:true}));}
const example={call_id:'g0',call_date:'2026-09-07T10:00:00Z',section:'discovery',move:'qualifying financially',observation:'Available capital was not established before the pitch.',recommendation:'Establish available capital and credit before presenting.',prospect_name:'Pat',outcome:'follow_up',source:'fathom',clip_url:'https://fathom.video/calls/real?t=4',turn_ids:[1,2,3],decision_turns:[],decision_located:false,evidence:[{speaker:'PROSPECT',quote:'I have some savings.',timestamp_seconds:4},{speaker:'CLOSER',quote:'Great, let me walk you through it.',timestamp_seconds:8},{speaker:'PROSPECT',quote:'Okay.',timestamp_seconds:12}]};
const closeExample=Object.assign({},example,{call_id:'g1',section:'close',move:'booking the follow-up',observation:'The call ended without a specific day and time.',recommendation:'Secure a confirmed day and time.',decision_located:true});
function page(reps){const funcs=['scoreColor','ymd','dayLabel','rangeLabelInclusive','coachingRepName','coachingRepWorkspaceHtml','coachingPeriodWorkspaceHtml','coachingPeriodExampleHtml','coachingExchangeHtml','coachingExchangeSegments','coachingExchangeGapLabel','selectCoachingRep'].map(n=>fnBody(live,n)).join('\n');return '<html><head>'+source.slice(source.indexOf('<style>'),source.indexOf('</style>')+8)+'</head><body data-view="team-coaching"><main class="page" id="content"></main><script>var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var state={teamCoachable:{reps:'+JSON.stringify(reps)+'}};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(c,u){window.opened=[c,u];}function syncHashFromState(){}'+funcs+';document.querySelector("#content").innerHTML=coachingRepWorkspaceHtml(state.teamCoachable.reps);</script></body></html>';}
/* what a manager reads: the overview's eyebrow/title/score, each grid cell's label, score, sub-line and state class, the diagnosis and the example's stage */
const PROBE=`(()=>{const T=s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\\s+/g,' ').trim():null;};
 const cells=[...document.querySelectorAll('.coaching-section-cell')].map(c=>({label:c.querySelector('span').innerText,score:c.querySelector('strong').innerText,sub:c.querySelector('small').innerText.replace(/\\s+/g,' ').trim(),focus:c.classList.contains('is-focus'),thin:c.classList.contains('is-thin'),valueOpacity:getComputedStyle(c.querySelector('strong')).opacity}));
 const ex=document.querySelector('.coaching-rep-detail > .coaching-period-example');
 return {eyebrow:T('.coaching-period-priority .coaching-period-eyebrow'),title:T('.coaching-period-priority h4'),score:T('.coaching-period-score'),diag:T('.coaching-period-diagnosis'),cells,exampleObs:ex?ex.querySelector('p').innerText:null,empty:T('.coaching-period-empty'),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()`;
function lowestEligibleCell(cells){return cells.filter(c=>c.score!=='—'&&!c.thin).sort((a,b)=>Number(a.score)-Number(b.score))[0];}

test('payload: every section says whether it is at the ranking floor, from the same ranking the overview names its stage from',()=>{
 const p=P.summarize(gabriel(),[example,closeExample],window);
 assert.equal(p.status,'ready');assert.equal(p.section,'discovery');assert.equal(p.score,73);
 const by=Object.fromEntries(p.sections.map(s=>[s.section,s]));
 assert.deepEqual([by.discovery.calls,by.objection.calls,by.close.calls],[16,7,8]);
 assert.equal(by.discovery.enough,true);assert.equal(by.objection.enough,false,'7 calls is below the floor of '+MIN_CALLS_TO_RANK);assert.equal(by.close.enough,false);
 const lowestEligible=p.sections.filter(s=>s.enough&&s.score!==null).sort((a,b)=>a.score-b.score)[0];
 assert.equal(lowestEligible.section,p.section,'the overview names the lowest section among the ones the grid marks eligible');
 assert.equal(p.focus.example.section,'discovery','the example supports the named stage, never the below-floor Close');
});
/* Block 018 (the reset) re-pinned the rendered half: the Stage Scores grid and the lowest-scoring-area overview LEFT Team → Coaching, so there
   is no grid to agree with on this view — the payload half above still carries `enough` and the displayed-precision tie for its other readers.
   What the page now shows for Gabriel's shape is the verified item on the lowest stage and its call, with no grid, no score and no cells. */
test('RENDERED (Gabriel\'s shape, 1400 and 390): the lowest stage\'s verified example is the coaching item; no grid, no score, no below-floor cells on this view',()=>{
 const reps=[{user_id:'g',name:'Gabriel',calls:16,period_summary:P.summarize(gabriel(),[example,closeExample],window)}];
 for(const width of [1400,390]){const r=renderComputed(page(reps),PROBE,{width});
  assert.equal(r.overflow,false,'width '+width);
  assert.equal(r.eyebrow,'WHAT TO WORK ON');assert.equal(String(r.title).toLowerCase(),'qualifying financially');assert.equal(r.score,null,'no score on this view');
  assert.equal(r.cells.length,0,'Block 018: the stage grid left Team → Coaching: '+JSON.stringify(r.cells));
  assert.match(r.diag,/^Discovery$/,'the item is shown as its own stage — the lowest stage, which has a verified example');
  assert.equal(r.exampleObs,example.observation,'the call beneath is the Discovery example, not the Close one');
 }
});
test('a tie at the DISPLAYED precision is a joint lowest on the payload; the page names no lowest area at all',()=>{
 const calls=Array.from({length:12},(_,i)=>({id:'y'+i,call_date:'2026-09-08T10:00:00Z',analysis_status:'done',analysis:assessed({intro_score:85,discovery_score:i<4?80:77,pitch_score:86,objection_score:i<3?80:77,close_score_earned:79}),period_review_current:true}));
 const p=P.summarize(calls,[],window);
 const by=Object.fromEntries(p.sections.map(s=>[s.section,s]));
 assert.equal(by.discovery.score,by.objection.score,'both render the same number: '+by.discovery.score+' / '+by.objection.score);
 assert.ok(p.tied_sections.includes('discovery')&&p.tied_sections.includes('objection'),'both are named joint lowest: '+JSON.stringify(p.tied_sections));
 const r=renderComputed(page([{user_id:'y',name:'Yazan',calls:12,period_summary:p}]),PROBE);
 assert.equal(r.eyebrow,null,'Block 018: no lowest-scoring-area overview on this view');assert.equal(r.cells.length,0);
 assert.equal(r.empty,'No coachable call found for these dates.','no verified example → the one plain sentence');
});
test('the honest states are untouched: below the floor everywhere, no calls, and a legacy window',()=>{
 const thin=P.summarize(gabriel().slice(0,8),[],window);assert.equal(thin.status,'thin');assert.equal(thin.label,'Not enough to judge');assert.equal(thin.section,null);assert.ok(thin.sections.every(s=>s.enough===false));
 const none=P.summarize([],[],window);assert.equal(none.status,'no_calls');assert.ok(none.sections.every(s=>s.score===null&&s.calls===0));
 const legacy=P.summarize(Array.from({length:5},(_,i)=>({id:'l'+i,call_date:'2026-09-08T10:00:00Z',analysis_status:'done',analysis:{intro_score:70},period_review_current:false})),[],window);
 assert.equal(legacy.awaiting_new_grading,true);assert.ok(legacy.sections.every(s=>s.score===null));
 /* Block 018: on Team → Coaching a below-floor window with no verified example shows the one plain sentence — no "Not enough to judge" headline, no cells;
    the payload's thin state (asserted above) still serves the rep page's card and the drilldown. */
 const r=renderComputed(page([{user_id:'t',name:'Preston',calls:8,period_summary:thin},{user_id:'l',name:'Old',calls:5,period_summary:legacy}]),PROBE);
 assert.equal(r.title,null);assert.equal(r.cells.length,0);assert.equal(r.empty,'No coachable call found for these dates.');
});
