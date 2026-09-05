'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fnBody, stripComments} = require('./helpers/strip-comments');
const {renderComputed} = require('./helpers/electron-render');
const {selectImprovementFocus} = require('../lib/improvement-focus');
const {loadCoachableTeam} = require('../lib/coachable-team');
const source = fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8');
const live = stripComments(source);
const h = {id:'h1', type:'objection', resolution:'unhandled', section:'objection', objection_category:'fear', speaker:'PROSPECT', speaker_verified:true, timestamp_seconds:10, quote:'I am not certain this is the right decision.', coaching:'Explore the concern before moving to the next step.'};
const c = {id:'c1', user_id:'u1', call_date:'2026-09-04', outcome:'follow_up', highlights:[h]};
test('improvement selection uses stored coaching and refuses positive, unverified and unsupported moments',()=>{
 assert.equal(selectImprovementFocus([c]).length,1);
 for(const patch of [{coaching:null},{quote:''},{speaker_verified:null},{resolution:'handled'},{type:'strong_moment'},{coaching:'Stop isolating objections.'}]) assert.equal(selectImprovementFocus([{...c,highlights:[{...h,...patch}]}]).length,0,JSON.stringify(patch));
 assert.equal(selectImprovementFocus([c,{...c,id:'c2'}]).length,2);
 assert.equal(selectImprovementFocus([{...c,highlights:[h,{...h,id:'h2'}]}]).length,1);
});
test('real team gather attaches only located exchanges and preserves owner/outcome',async()=>{
 const tables = {fathom_calls:[{...c,fathom_call_id:'real-recording',not_a_sales_call:false,duplicate_of:null}],call_highlights:[{...h,fathom_call_id:'c1'}],call_analyses:[{fathom_call_id:'c1',status:'done',outcome:'follow_up',transcript_stored:{turns:[{speaker:'PROSPECT',start_seconds:10,text:h.quote},{speaker:'CLOSER',start_seconds:15,text:'What is the concern?'}]}}]};
 const admin={from(table){let filters=[];const q={select(){return q;},in(k,ids){filters.push(r=>ids.includes(r[k]));return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},not(){return q;},is(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(){return q;},then(resolve,reject){return Promise.resolve({data:tables[table].filter(r=>filters.every(f=>f(r))),error:null}).then(resolve,reject);}};return q;}};
 const good=await loadCoachableTeam(admin,['u1'],'2026-08-07','2026-09-05');
 assert.equal(good.reps[0].improvements.length,1);
 assert.equal(good.reps[0].improvements[0].call_evidence.owner_user_id,'u1');
 assert.equal(good.reps[0].improvements[0].call_evidence.outcome,'follow_up');
 tables.call_analyses[0].transcript_stored.turns[0].text='Unrelated words';
 assert.equal((await loadCoachableTeam(admin,['u1'],'2026-08-07','2026-09-05')).reps[0].improvements.length,0);
});
function page() {
 const item={...selectImprovementFocus([c])[0],moment:h};
 const state={view:'team-coaching',notedHighlightIds:{},teamCoachable:{reps:[{user_id:'u1',name:'Ava',calls:2,improvements:[item],items:[{kind:'strong_moment',moment:{quote:'Do not render positive evidence'}}]},{user_id:'u2',name:'Ben',calls:2,improvements:[{...item,user_id:'u2',call_id:'c2',coaching:'Check the decision process.'}]},{user_id:'u3',name:'Noor',calls:0,improvements:[]}]}};
 const funcs=['teamCoachableHtml','coachingRepWorkspaceHtml','coachingRepName','selectCoachingRep','selectCoachingMoment','fineTuneFromCoachingFocus','coachableItemHtml','missedPairHtml'].map(n=>fnBody(live,n)).join('\n');
 return '<html><head>'+source.slice(source.indexOf('<style>'),source.indexOf('</style>')+8)+'</head><body data-view="team-coaching"><main id="content" class="page"><div class="team-coaching-workspace" id="testHost"></div></main><script>var state='+JSON.stringify(state)+';var fineTarget;function escapeHtml(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\"/g,"&quot;");} function displayNameFromEmail(s){return s;}function canMarkStandard(){return true;}function laneProblem(){return null;}function formatTimestampDisplay(){return "00:00:10";}function outcomeLabel(){return "Follow-up";}function fineTuneCoaching(t){fineTarget=t;}'+funcs+';document.getElementById("testHost").innerHTML=teamCoachableHtml();</script></body></html>';
}
test('workspace switches closer, preserves correction target, and fits desktop and mobile',()=>{
 for(const width of [1400,979,390]) {
 const result=renderComputed(page(),`(()=>{let initial=document.body.innerText;document.querySelector('[data-user="u2"]').click();let after=document.body.innerText;document.querySelector('.review-ft-btn').click();return {initial,after,target:fineTarget,selected:state.coachingSelectedRep,overflow:document.documentElement.scrollWidth>innerWidth,panels:document.querySelectorAll('.coaching-rep-detail').length};})()`,{width});
 assert.equal(result.overflow,false,'width '+width);
 assert.equal(result.panels,1);
 assert.equal(result.selected,'u2');
 assert.match(result.after,/Check the decision process/);
 assert.doesNotMatch(result.initial,/Do not render positive evidence/);
 assert.equal(result.target.callId,'c2');assert.equal(result.target.highlightId,'h1');
 assert.match(result.initial,/closers without calls/);
 }
});
