'use strict';
/* BLOCK 018 (SCOUT-SHARED-CONTEXT.md) — ONE VERIFIED CALL IS ENOUGH. Justin's ruling: a manager should see only (1) what
   this rep needs help with and (2) one real call that shows it. One verified, useful call is enough to coach from; more
   calls may strengthen a point but are never required. The live failure: Gabriel, 18 calls, 16 graded Discovery calls,
   a stated "lowest-scoring area", then "not enough reviewed evidence" and no Call Example — an empty experience produced
   by review mechanics while a verified Close finding sat collapsed under "Other coaching". So: the displayed coaching
   item's FIRST requirement is a stored, verified example; the score-selected stage only breaks ties (it is preferred
   when it has an example; it is never shown empty); an item from another stage is shown as ITS OWN stage, never as
   proof of the score-selected one; a single call is never called a pattern; with no verified example anywhere the
   page says one plain sentence. The stage-score grid, "More calls with this", "Other coaching from these calls" and the
   rep list's counts and stage labels leave this view. Selection-and-presentation only: no grade, score, eligibility,
   record, prompt or review changes. Rendered with the page's real functions and stylesheet. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fnBody,stripComments}=require('./helpers/strip-comments'),{renderComputed}=require('./helpers/electron-render');
const source=fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8'),live=stripComments(source);
const P=require('../lib/rep-period-coaching');
const S=require('../lib/stage-eligibility');
function assessed(scores){const sections=Object.fromEntries(S.SECTIONS.map(section=>{const score=section==='close'?scores.close_score_earned:scores[section+'_score'];return [section,typeof score==='number'?{state:'evaluated',score,grade:S.canonicalGrade(Math.round(score))}:{state:'not_applicable',score:null,grade:null}];}));return {...scores,stage_eligibility:{summary:{version:S.VERSION,review_version:require('../lib/stage-eligibility-review').VERSION,factual_version:require('../lib/stage-observation-review').VERSION,source_hash:'test-source',sections}}};}
const window={from:'2026-09-07',to:'2026-09-11T23:59:59Z'};
/* Gabriel's live shape: Discovery is the score-selected (lowest at the floor) stage over 16 calls; Objection Handling and Close sit below the floor. */
function gabrielCalls(){return Array.from({length:16},(_,i)=>({id:'g'+i,call_date:'2026-09-'+String(7+(i%5)).padStart(2,'0')+'T10:00:00Z',analysis_status:'done',analysis:assessed({intro_score:77,discovery_score:73,pitch_score:80,objection_score:i<7?69:undefined,close_score_earned:i<8?61:undefined}),period_review_current:true}));}
const EV=[{speaker:'PROSPECT',quote:'Can we pick this up next week? I have to run.',timestamp_seconds:2340},{speaker:'CLOSER',quote:'Sure — reach out whenever works and we will set something up.',timestamp_seconds:2346},{speaker:'PROSPECT',quote:'Sounds good, thanks.',timestamp_seconds:2351}];
function finding(id,section,move,day,extra){return Object.assign({call_id:id,call_date:'2026-09-'+String(day).padStart(2,'0')+'T12:00:00Z',section,move,observation:'The call ended with an open invitation to reconnect rather than an agreed day and time.',recommendation:'Secure a confirmed day and time before ending when the sale remains open.',prospect_name:'Marcus',outcome:'follow_up',source:'fathom',clip_url:'https://fathom.video/calls/77?t=2340',turn_ids:[1,2,3],decision_turns:[],decision_located:true,evidence:EV},extra||{});}
const CLOSE1=finding('g3','close','booking the follow-up',10);
const CLOSE2=finding('g5','close','booking the follow-up',8,{observation:'A second call that ended the same way.',recommendation:'Secure a confirmed day and time before ending when the sale remains open.'});
const DISC=finding('g0','discovery','qualifying financially',9,{observation:'Available capital was not established before the pitch.',recommendation:'Establish available capital and credit before presenting.',evidence:[{speaker:'PROSPECT',quote:'I have some savings put aside.',timestamp_seconds:400},{speaker:'CLOSER',quote:'Great, let me walk you through the program.',timestamp_seconds:410}]});
function rep(id,name,calls,summary){return {user_id:id,name,calls,recent_calls:[{call_id:'g0',user_id:id,call_date:'2026-09-09T10:00:00Z',outcome:'follow_up',analysis_status:'done'}],items:[],improvements:[],line:null,period_summary:summary};}
function page(reps,selected){const funcs=['scoreColor','ymd','dayLabel','rangeLabelInclusive','coachingRepName','coachingRepWorkspaceHtml','coachingPeriodWorkspaceHtml','coachingPeriodExampleHtml','coachingExchangeHtml','coachingExchangeSegments','coachingExchangeGapLabel','selectCoachingRep'].map(n=>fnBody(live,n)).join('\n');return '<html><head>'+source.slice(source.indexOf('<style>'),source.indexOf('</style>')+8)+'</head><body data-view="team-coaching"><main class="page" id="content"></main><script>var COLORS={win:"#09e046",follow_up:"#fbbf24",loss:"#f87171"};var state={teamCoachable:{reps:'+JSON.stringify(reps)+'},coachingSelectedRep:'+JSON.stringify(selected||null)+'};var MONTH_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function formatTimestampDisplay(s){return String(s);}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(c,u){window.opened=[c,u];}function syncHashFromState(){}'+funcs+';document.querySelector("#content").innerHTML=coachingRepWorkspaceHtml(state.teamCoachable.reps);</script></body></html>';}
const PROBE=`(()=>{const T=s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\\s+/g,' ').trim():null;};
 const ex=document.querySelector('.coaching-rep-detail > .coaching-period-example');const d=ex&&ex.querySelector('.coaching-exact-exchange');if(d)d.open=true;
 const btn=ex&&ex.querySelector('[data-call]');if(btn)btn.click();
 return {primary:T('.coaching-period-priority'),eyebrow:T('.coaching-period-priority .coaching-period-eyebrow'),title:T('.coaching-period-priority h4'),coach:T('.coaching-period-priority .coaching-example-next p'),
  example:ex?{meta:ex.querySelector('.coaching-example-meta').innerText.replace(/\\s+/g,' ').trim(),observation:ex.querySelector('p').innerText,lines:[...ex.querySelectorAll('.coaching-exact-exchange blockquote')].map(b=>b.innerText.replace(/\\s+/g,' ').trim()),clip:(ex.querySelector('.coaching-example-actions a')||{}).href||null,actions:[...ex.querySelectorAll('.coaching-example-actions a,.coaching-example-actions button')].map(b=>b.innerText),owner:btn?btn.dataset.owner:null,call:btn?btn.dataset.call:null}:null,
  opened:window.opened||null,empty:T('.coaching-period-empty'),
  grid:document.querySelectorAll('.coaching-section-grid,.coaching-section-cell').length,more:document.querySelectorAll('.coaching-more').length,other:document.querySelectorAll('.coaching-other').length,score:document.querySelectorAll('.coaching-period-score').length,
  repList:[...document.querySelectorAll('.coaching-rep-choice')].map(b=>b.innerText.replace(/\\s+/g,' ').trim()),text:document.body.innerText,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()`;
const CLUTTER=/not enough reviewed evidence|lowest-scoring area|reviewed .* calls|came up in \d|graded call|pattern|trend|Stage scores this period|More calls with this|Other coaching from these calls|\/ ?100/i;

test('payload: one verified example is enough — the coaching item is that finding, and one call is never a pattern',()=>{
 const p=P.summarize(gabrielCalls(),[CLOSE1],window);
 assert.equal(p.coaching.state,'item',JSON.stringify(p.coaching));
 assert.equal(p.coaching.section,'close');assert.equal(p.coaching.label,'Close');assert.equal(p.coaching.move,'booking the follow-up');
 assert.equal(p.coaching.calls,1);assert.equal(p.coaching.recurring,false);
 assert.equal(p.coaching.example.call_id,'g3');assert.equal(p.coaching.from_lowest_stage,false,'Discovery is the score-selected stage; the item is shown as its own stage, never as proof of Discovery');
 const two=P.summarize(gabrielCalls(),[CLOSE1,CLOSE2],window);assert.equal(two.coaching.calls,2);assert.equal(two.coaching.recurring,true);assert.equal(two.coaching.example.call_id,'g3','the most recent supporting call is the example');
});
test('payload: the score-selected stage is preferred when it HAS an example; below the floor or on a legacy window an example still coaches',()=>{
 const both=P.summarize(gabrielCalls(),[CLOSE1,CLOSE2,DISC],window);
 assert.equal(both.section,'discovery');assert.equal(both.coaching.section,'discovery','the lowest stage wins when it has a verified example');assert.equal(both.coaching.from_lowest_stage,true);assert.equal(both.coaching.example.call_id,'g0');
 const thin=P.summarize(gabrielCalls().slice(0,8),[CLOSE1],window);assert.equal(thin.status,'thin');assert.equal(thin.coaching.state,'item');assert.equal(thin.coaching.example.call_id,'g3');
 const legacy=P.summarize([{id:'g3',call_date:'2026-09-10T10:00:00Z',analysis_status:'done',analysis:{intro_score:70},period_review_current:true}],[CLOSE1],window);assert.equal(legacy.coaching.state,'item');
 const none=P.summarize(gabrielCalls(),[],window);assert.equal(none.coaching.state,'none');assert.equal(none.coaching.copy,'No coachable call found for these dates.');
 const empty=P.summarize([],[],window);assert.equal(empty.status,'no_calls');assert.equal(empty.coaching.state,'none');
});
test('RENDERED — Gabriel\'s live shape (a Discovery score, a verified Close call): the page says what to work on and shows that call, never an empty priority plus collapsed other coaching',()=>{
 const reps=[rep('g','Gabriel',18,P.summarize(gabrielCalls(),[CLOSE1],window)),rep('n','Nick',13,P.summarize(gabrielCalls(),[DISC],window))];
 for(const width of [1400,390]){const r=renderComputed(page(reps,'g'),PROBE,{width});
  assert.equal(r.overflow,false,'width '+width);
  assert.equal(r.eyebrow,'WHAT TO WORK ON');assert.match(String(r.title),/^booking the follow-up$/i);assert.match(r.primary,/\bClose\b/,'the item carries its OWN stage');assert.doesNotMatch(r.primary,/Discovery/);
  assert.equal(r.coach,CLOSE1.recommendation);
  assert.ok(r.example,'one real call is shown');assert.equal(r.example.observation,CLOSE1.observation);assert.match(r.example.meta,/^Marcus Gabriel · 2026-09-10 Open$/);
  assert.deepEqual(r.example.lines,['Marcus · 2340 Can we pick this up next week? I have to run.','Gabriel · 2346 Sure — reach out whenever works and we will set something up.','Marcus · 2351 Sounds good, thanks.'],'the exchange is the stored evidence, speaker by speaker, verbatim');
  assert.equal(r.example.clip,CLOSE1.clip_url);assert.deepEqual(r.example.actions,['Watch clip ↗','Review Full Call']);
  assert.deepEqual([r.example.call,r.example.owner],['g3','g'],'Review Full Call names the example\'s call and the REP as owner');assert.deepEqual(r.opened,['g3','g']);
  assert.equal(r.empty,null,'no empty primary area');assert.equal(r.other,0);assert.equal(r.more,0);assert.equal(r.grid,0);assert.equal(r.score,0);
  assert.doesNotMatch(r.text,CLUTTER,'no score, count, pattern, review or other-coaching clutter: '+r.text.slice(0,400));
  assert.doesNotMatch(r.primary,/\b1 calls?\b|\bone call\b/i,'a single call is not counted at');
  assert.deepEqual(r.repList,['Gabriel','Nick'],'the rep selector is names only');
 }
});
test('RENDERED — two supporting calls may say so; the most recent one is the call shown',()=>{
 const r=renderComputed(page([rep('g','Gabriel',18,P.summarize(gabrielCalls(),[CLOSE1,CLOSE2],window))],'g'),PROBE);
 assert.match(r.primary,/2 calls/);assert.doesNotMatch(r.primary,/pattern|trend/i);assert.equal(r.example.call,'g3');
});
test('RENDERED — no verified example anywhere: one plain sentence, no numbers, no review language; no calls at all keeps its own sentence',()=>{
 const reps=[rep('g','Gabriel',18,P.summarize(gabrielCalls(),[],window)),rep('q','Quiet',0,P.summarize([],[],window))];
 for(const width of [1400,390]){const r=renderComputed(page(reps,'g'),PROBE,{width});
  assert.equal(r.primary,null);assert.equal(r.example,null);
  assert.equal(r.empty,'No coachable call found for these dates.');
  assert.doesNotMatch(r.text.replace(/Sep \d+ - Sep \d+/,''),/\d/,'no numerical explanation anywhere on the panel: '+r.text.slice(0,300));
  assert.doesNotMatch(r.text,/not enough|reviewed|evidence|graded|analysed|new checks/i);
  assert.equal(r.grid,0);assert.equal(r.other,0);assert.equal(r.score,0);
 }
 const q=renderComputed(page(reps,'q'),PROBE);assert.match(q.text,/no calls in this period/i);assert.equal(q.example,null);
});
