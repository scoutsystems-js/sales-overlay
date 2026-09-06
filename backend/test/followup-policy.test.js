'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=require('node:path').join(__dirname,'../lib/followup-policy.js');
const P=fs.existsSync(file)?require(file):{};
const facts={state:'not_booked',further_contact:true,declined:false,ending_complete:true};
const policy={id:'note',category:'coaching_correction',scope:'team',team_owner_id:'owner',content:'When a sale remains open and further contact is needed, try to agree a specific day and time before ending the call. Don’t flag a confirmed appointment or a prospect who explicitly declines to schedule.',metadata:{manager_followup_standard:'agree_day_time_v1'}};
test('missing or unrelated guidance never authorizes a coaching recommendation',()=>{
 assert.equal(typeof P.classifyFollowup,'function');
 for(const notes of [[],[{...policy,metadata:{}}],[{...policy,category:'user_upload'}],[{...policy,team_owner_id:'foreign'}]]){
  assert.equal(P.classifyFollowup({facts,outcome:'follow_up',notes,teamOwner:'owner'}).state,'unknown');
 }
});
test('explicit team standard makes the same observed facts coachable without a model interpreting policy',()=>{
 const result=P.classifyFollowup({facts,outcome:'follow_up',notes:[policy],teamOwner:'owner'});
 assert.equal(result.state,'issue');assert.equal(result.policy_id,'note');
});
test('booked appointment, declined scheduling and no further contact do not become missed-booking coaching',()=>{
 for(const patch of [{state:'booked'},{state:'declined',declined:true},{state:'no_contact_needed',further_contact:false}]){
  const result=P.classifyFollowup({facts:{...facts,...patch},outcome:'follow_up',notes:[policy],teamOwner:'owner'});
  assert.notEqual(result.state,'issue');assert.notEqual(result.state,'unknown');
 }
});
test('unknown inputs and incomplete endings remain unknown, even with an approved standard',()=>{
 for(const patch of [{state:'unknown'},{ending_complete:false},{further_contact:null},{declined:null}]){
  assert.equal(P.classifyFollowup({facts:{...facts,...patch},outcome:'follow_up',notes:[policy],teamOwner:'owner'}).state,'unknown');
 }
});
test('a closed call is outside this issue; ambiguous outcome is not a negative observation',()=>{
 assert.equal(P.classifyFollowup({facts,outcome:'closed',notes:[policy],teamOwner:'owner'}).state,'not_applicable');
 assert.equal(P.classifyFollowup({facts,outcome:null,notes:[policy],teamOwner:'owner'}).state,'unknown');
});
test('policy fingerprint changes if its wording changes and does not accept missing team ownership',()=>{
 const a=P.classifyFollowup({facts,outcome:'follow_up',notes:[policy],teamOwner:'owner'});
 const b=P.classifyFollowup({facts,outcome:'follow_up',notes:[{...policy,content:'Changed standard'}],teamOwner:'owner'});
 assert.ok(a.policy_hash);assert.equal(b.state,'unknown');
 assert.equal(P.classifyFollowup({facts,outcome:'follow_up',notes:[{...policy,team_owner_id:null}],teamOwner:null}).state,'unknown');
});
