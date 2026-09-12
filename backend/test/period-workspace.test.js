'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fnBody,stripComments}=require('./helpers/strip-comments'),{renderComputed}=require('./helpers/electron-render');
const source=fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8'),live=stripComments(source);
const P=require('../lib/rep-period-coaching');
const S=require('../lib/stage-eligibility');
function assessed(scores){const sections=Object.fromEntries(S.SECTIONS.map(section=>{const score=section==='close'?scores.close_score_earned:scores[section+'_score'];return [section,typeof score==='number'?{state:'evaluated',score,grade:S.canonicalGrade(Math.round(score))}:{state:'not_applicable',score:null,grade:null}];}));return {...scores,stage_eligibility:{summary:{version:S.VERSION,review_version:require('../lib/stage-eligibility-review').VERSION,factual_version:require('../lib/stage-observation-review').VERSION,source_hash:'test-source',sections}}};}
const example={call_id:'call',call_date:'2026-09-01T12:00:00Z',section:'discovery',move:'qualifying financially',observation:'The available resources remained unresolved in this exchange.',recommendation:'Establish financial fit before presenting.',prospect_name:'Pat <script>',outcome:'follow_up',source:'fathom',clip_url:'https://fathom.video/calls/real?t=4',evidence:[{speaker:'PROSPECT',quote:'I do not know what is available.',timestamp_seconds:4},{speaker:'CLOSER',quote:'Let us look at the offer.',timestamp_seconds:8},{speaker:'PROSPECT',quote:'Okay.',timestamp_seconds:12}]};
const window={from:'2026-09-01',to:'2026-09-05'};
/* H768: ten calls, because the panel now carries the rep page's floor. */
const avaCalls=Array.from({length:10},(_,i)=>({id:i===0?'call':'call-'+i,call_date:example.call_date,analysis_status:'done',analysis:assessed({intro_score:55,discovery_score:40,pitch_score:70,close_score_earned:54}),period_review_current:true}));
const reps=[{user_id:'a',name:'Ava',calls:10,period_summary:P.summarize(avaCalls,[example],window)},{user_id:'b',name:'Ben',calls:0,period_summary:P.summarize([],[],window)}];
function page(){const funcs=['scoreColor','ymd','dayLabel','rangeLabelInclusive','coachingRepName','coachingRepWorkspaceHtml','coachingPeriodWorkspaceHtml','coachingPeriodExampleHtml','coachingExchangeHtml','coachingExchangeSegments','coachingExchangeGapLabel','selectCoachingRep'].map(n=>fnBody(live,n)).join('\n');return '<html><head>'+source.slice(source.indexOf('<style>'),source.indexOf('</style>')+8)+'</head><body data-view="team-coaching"><main class="page" id="content"></main><script>var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var state={teamCoachable:{reps:'+JSON.stringify(reps)+'}};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(c,u){window.opened=[c,u];}function syncHashFromState(){}'+funcs+';document.querySelector("#content").innerHTML=coachingRepWorkspaceHtml(state.teamCoachable.reps);</script></body></html>';}
test('real period workspace renders all reps, exact dates, evidence and owner-aware navigation without overflow',()=>{for(const width of [1400,979,390]){const r=renderComputed(page(),`(()=>{let text=document.body.innerText;document.querySelector('[data-call]').click();let opened=window.opened;let link=document.querySelector('a').href;document.querySelector('[data-user="b"]').click();return {text,opened,link,quiet:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,scripts:document.querySelectorAll('#content script').length};})()`,{width});assert.equal(r.overflow,false,'width '+width);assert.equal(r.scripts,0);assert.deepEqual(r.opened,['call','a']);assert.match(r.text,/Discovery/);assert.match(r.text,/Sep 1 - Sep 5/);assert.match(r.text,/Pat <script>/);assert.match(r.quiet,/No calls in this period/i);assert.equal(r.link,example.clip_url);}});

/* Block 018 (the reset): the stage-score grid left this view, so the Block 004 colour rule ("weak is red, never green") has no cells to
   measure here; what remains of it is that the WHAT TO COACH edge is never the accent. Was: the weakest cell's bar is --bad, never --accent. */
test('the coaching block carries no accent edge, and the stage grid is gone from this view',()=>{
 const result=renderComputed(page(),`(()=>{return {cells:document.querySelectorAll('.coaching-section-cell').length,next:getComputedStyle(document.querySelector('.coaching-example-next')).borderLeftColor};})()`);
 assert.equal(result.cells,0,'Block 018: no stage grid on Team → Coaching');
 assert.notEqual(result.next,'rgb(9, 224, 70)');
});

/* Block 018: the headings are "The call" only — the lowest-scoring-area framing, the score and the stage grid left; no internal counters. */
test('what to work on and the call are the only headings, without internal review counters',()=>{
 const r=renderComputed(page(),`({text:document.body.innerText,headings:[...document.querySelectorAll('.coaching-pattern-heading h4')].map(x=>x.textContent),eyebrow:(document.querySelector('.coaching-period-priority .coaching-period-eyebrow')||{}).textContent||null})`);
 assert.equal(r.eyebrow,'WHAT TO WORK ON');
 assert.doesNotMatch(r.text,/Lowest-scoring area|Stage scores this period|\/ ?100/i);
 assert.deepEqual(r.headings,['The call']);
 assert.doesNotMatch(r.text,/calls reviewed for examples|Examples cover|have not completed this review|reviewed .* calls|graded call/);
});
