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
const h = {coaching_review:{version:require('../lib/coaching-evidence-review').VERSION,verdict:'approved'},id:'h1', type:'objection', resolution:'unhandled', section:'objection', objection_category:'fear', speaker:'PROSPECT', speaker_verified:true, timestamp_seconds:10, quote:'I am not certain this is the right decision.', coaching:'Explore the concern before moving to the next step.'};
const c = {id:'c1', user_id:'u1', call_date:'2026-09-04', outcome:'follow_up', highlights:[h]};
test('improvement selection uses stored coaching and refuses positive, unverified and unsupported moments',()=>{
 assert.equal(selectImprovementFocus([c]).length,1);
 for(const patch of [{coaching:null},{quote:''},{speaker_verified:null},{resolution:'handled'},{type:'strong_moment'},{coaching:'Stop isolating objections.'}]) assert.equal(selectImprovementFocus([{...c,highlights:[{...h,...patch}]}]).length,0,JSON.stringify(patch));
 assert.equal(selectImprovementFocus([c,{...c,id:'c2'}]).length,2);
 assert.equal(selectImprovementFocus([{...c,highlights:[h,{...h,id:'h2'}]}]).length,1);
});
test('real team gather attaches only located exchanges and preserves owner/outcome',async()=>{
 const tables = {fathom_calls:[{...c,fathom_call_id:'real-recording',not_a_sales_call:false,duplicate_of:null}],call_highlights:[{...h,fathom_call_id:'c1'}],call_analyses:[{fathom_call_id:'c1',status:'done',outcome:'follow_up',why_outcome:'Unreviewed explanation about why the call ended.',transcript_stored:{turns:[{speaker:'PROSPECT',start_seconds:10,text:h.quote},{speaker:'CLOSER',start_seconds:15,text:'What is the concern?'}]}}]};
 const admin={from(table){let filters=[];const q={select(){return q;},in(k,ids){filters.push(r=>ids.includes(r[k]));return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},not(){return q;},is(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(){return q;},then(resolve,reject){return Promise.resolve({data:tables[table].filter(r=>filters.every(f=>f(r))),error:null}).then(resolve,reject);}};return q;}};
 tables.call_highlights[0].coaching_review.context_hash=require('../lib/coaching-evidence-review').contextFor(tables.call_highlights[0],tables.call_analyses[0]).hash;
 const good=await loadCoachableTeam(admin,['u1'],'2026-08-07','2026-09-05');
 assert.equal(good.reps[0].improvements.length,1);
 assert.equal(good.reps[0].improvements[0].call_evidence.owner_user_id,'u1');
 assert.equal(good.reps[0].improvements[0].call_evidence.outcome,'follow_up');
 assert.equal(good.reps[0].improvements[0].call_evidence.result_explanation,null,'approval of coaching does not approve an older outcome explanation');
 tables.call_highlights[0].coaching_review.kb_hash='current';
 assert.equal((await loadCoachableTeam(admin,['u1'],'2026-08-07','2026-09-05','changed')).reps[0].improvements.length,0);
 tables.fathom_calls.push({...tables.fathom_calls[0],id:'c2'});
 tables.call_highlights.push({...h,id:'h2',fathom_call_id:'c2',objection_category:null,section:'discovery',coaching_review:{...tables.call_highlights[0].coaching_review}});
 tables.call_analyses.push({...tables.call_analyses[0],fathom_call_id:'c2',transcript_stored:JSON.parse(JSON.stringify(tables.call_analyses[0].transcript_stored))});
 tables.call_analyses[0].transcript_stored.turns[0].text='Unrelated words';
 const fallback=await loadCoachableTeam(admin,['u1'],'2026-08-07','2026-09-05','current');
 assert.equal(fallback.reps[0].improvements[0].call_id,'c2');
});
function page() {
 const item={...selectImprovementFocus([c])[0],moment:h};
 const state={view:'team-coaching',notedHighlightIds:{},teamCoachable:{reps:[{user_id:'u1',name:'Ava',calls:2,improvements:[item],items:[{kind:'strong_moment',moment:{quote:'Do not render positive evidence'}}]},{user_id:'u2',name:'Ben',calls:2,improvements:[{...item,user_id:'u2',call_id:'c2',coaching:'Check the decision process.'}]},{user_id:'u3',name:'Noor',calls:0,improvements:[]}]}};
 const funcs=['noMaterialHtml','teamCoachableHtml','coachingRepWorkspaceHtml','coachingRepName','selectCoachingRep','selectCoachingMoment','fineTuneFromCoachingFocus','coachableItemHtml','missedPairHtml'].map(n=>fnBody(live,n)).join('\n');
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

test('team gather keeps recent calls when no improvement passes review',async()=>{
 const tables={fathom_calls:[{id:'kept',fathom_call_id:'real-1',user_id:'u1',call_date:'2026-09-04',not_a_sales_call:false,duplicate_of:null},{id:'excluded',fathom_call_id:'real-2',user_id:'u1',not_a_sales_call:true}],call_analyses:[{fathom_call_id:'kept',status:'done',outcome:'closed'}],call_highlights:[]};
 const admin={from(t){const q={select(){return q},in(){return q},gte(){return q},lte(){return q},not(){return q},is(){return q},order(){return q},range(){return q},then(resolve){return Promise.resolve({data:tables[t],error:null}).then(resolve)}};return q}};
 const result=await loadCoachableTeam(admin,['u1','u2'],'2026-08-07','2026-09-05');
 assert.equal(result.reps[0].improvements.length,0);assert.equal(result.reps[0].calls,1);
 assert.deepEqual(result.reps[0].recent_calls,[{call_id:'kept',user_id:'u1',call_date:'2026-09-04',outcome:'closed',analysis_status:'done'}]);assert.deepEqual(result.reps[1].recent_calls,[]);
});
test('no-coaching and no-material states retain call review with the correct owner',()=>{
 const html=page().replace('document.getElementById("testHost").innerHTML=teamCoachableHtml();',`state.teamCoachable.no_material=true;state.teamCoachable.copy='Add team materials for coaching.';state.teamCoachable.reps[0].improvements=[];state.teamCoachable.reps[1].improvements=[];state.teamCoachable.reps[0].recent_calls=[{call_id:'kept',user_id:'u1',call_date:'2026-09-04',outcome:'closed',analysis_status:'done'}];function openCallReview(id,user){window.opened=[id,user];}document.getElementById("testHost").innerHTML=teamCoachableHtml();`);
 const result=renderComputed(html,`(()=>{const b=document.querySelector('[data-coaching-call]');if(b)b.click();return {text:document.body.innerText,opened:window.opened};})()`,{width:979});
 assert.match(result.text,/2 calls in this period/);assert.match(result.text,/Add team materials/);assert.deepEqual(result.opened,['kept','u1']);
});
