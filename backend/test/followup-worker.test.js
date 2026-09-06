'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=require('node:path').join(__dirname,'../lib/followup-worker.js');const W=fs.existsSync(file)?require(file):{};
const P=require('../lib/followup-policy');
const note={id:'n',scope:'team',category:'coaching_correction',team_owner_id:'owner',content:P.STANDARD_TEXT,metadata:{manager_followup_standard:P.STANDARD}};
function admin(notes=[note]){return {from(t){const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:t==='fathom_calls'?{id:'c',user_id:'rep'}:{managed_by:'owner'}}),then(resolve){return Promise.resolve({data:notes}).then(resolve)}};return q;}};}
const analysis={outcome:'follow_up',transcript_stored:[{speaker:'CLOSER',start_seconds:1,text:'Call me next week.'},{speaker:'PROSPECT',start_seconds:2,text:'Okay.'}]};
const answer={state:'not_booked',further_contact:true,declined:false,ending_complete:true,evidence_turns:[1,2]};
const deps={countTokens:async()=>1000,maxRetries:0,create:async()=>({stop_reason:'end_turn',content:[{text:JSON.stringify(answer)}]})};
test('new-call entry reads facts only for eligible calls on a team with the confirmed standard',async()=>{
 assert.equal(typeof W.assessNewCallFollowup,'function');
 assert.equal((await W.assessNewCallFollowup(admin(),{id:'c',user_id:'rep'},analysis,'rep',deps)).facts.state,'not_booked');
 let requests=0;const never={...deps,countTokens:async()=>{requests++;return 1000;}};
 for(const [db,call,a] of [[admin([]),{id:'c'},analysis],[admin(),{id:'c',not_a_sales_call:true},analysis],[admin(),{id:'c',duplicate_of:'x'},analysis],[admin(),{id:'seed-x',fathom_call_id:'seed-x'},analysis],[admin(),{id:'c'},{...analysis,outcome:'closed'}]])assert.equal(await W.assessNewCallFollowup(db,call,a,'rep',never),null);
 assert.equal(requests,0);
});
test('the real assessment entry refuses the entire operation above its spend ceiling',async()=>{
 let calls=0;await assert.rejects(()=>W.assessNewCallFollowup(admin(),{id:'c'},analysis,'rep',{...deps,countTokens:async()=>10000000,create:async()=>{calls++;}}),/budget/);assert.equal(calls,0);
});
test('production analysis does not dispatch the dedicated scheduling review',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../lib/analysis-worker.js'),'utf8');
 assert.doesNotMatch(source,/assessNewCallFollowup|require\(['"]\.\/followup-worker/);
});
