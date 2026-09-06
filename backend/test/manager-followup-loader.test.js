'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path').join(__dirname,'../lib/manager-followup-loader.js');
const L=fs.existsSync(path)?require(path):{};
const F=require('../lib/followup-facts'),P=require('../lib/followup-policy');
const transcript=[{speaker:'CLOSER',text:'Call me over the weekend.',start_seconds:100},{speaker:'PROSPECT',text:'Yes, I will call you.',start_seconds:105}];
const facts={state:'not_booked',further_contact:true,declined:false,ending_complete:true,evidence_turns:[1,2]};
const analysis={fathom_call_id:'c1',status:'done',outcome:'follow_up',prospect_name:'Pat',transcript_stored:transcript};
analysis.manager_followup_facts={version:F.VERSION,source_hash:F.sourceHash(analysis),reads:[facts,facts]};
const note={id:'policy',scope:'team',category:'coaching_correction',team_owner_id:'owner',content:P.STANDARD_TEXT,metadata:{manager_followup_standard:P.STANDARD}};
const call={id:'c1',user_id:'rep',call_date:'2026-09-05T12:00:00Z',recording_url:'https://fathom.video/calls/example',source:'fathom',analysis_status:'done',outcome:'follow_up'};
function db(rows=[analysis],notes=[note]){return {from(table){let ids;const q={select(){return q},eq(){return q},not(){return q},order(){return q},range(){return q},in(_,v){ids=v;assert.ok(v.length<=100);return q},then(resolve){return Promise.resolve({data:table==='knowledge_base'?notes:rows.filter(r=>ids.includes(r.fathom_call_id))}).then(resolve)}};return q;}};}
const opts={calls:[call,{...call,id:'c2'}],memberIds:['rep'],teamOwner:'owner',names:{rep:'Closer'},from:'2026-09-05T00:00:00Z',to:'2026-09-05T23:59:59Z'};
test('live loader produces named linked evidence and distinguishes unchecked calls',async()=>{
 assert.equal(typeof L.loadFollowupPriority,'function');const result=await L.loadFollowupPriority(db(),opts);
 assert.equal(result.matching_calls,1);assert.equal(result.assessed_calls,1);assert.equal(result.unassessed_calls,1);
 assert.equal(result.examples[0].prospect_name,'Pat');assert.equal(result.examples[0].closer_name,'Closer');assert.match(result.examples[0].clip_url,/t=100/);
});
test('stale source, foreign policy, excluded calls and corrupted stored evidence never count',async()=>{
 for(const [admin,options] of [[db([{...analysis,transcript_stored:[...transcript,{speaker:'CLOSER',start_seconds:200,text:'Tuesday at noon then.'}]}]),opts],[db([analysis],[{...note,team_owner_id:'foreign'}]),opts],[db(),{...opts,calls:[{...call,not_a_sales_call:true}]}],[db([{...analysis,manager_followup_facts:{...analysis.manager_followup_facts,reads:[{...facts,evidence_turns:[999]},facts]}}]),opts]]){
  const result=await L.loadFollowupPriority(admin,options);assert.equal(result.matching_calls,0);
 }
});
test('closed calls are assessed outside this open-sale issue and Zoom does not promise seeking',async()=>{
 const r=await L.loadFollowupPriority(db(),{...opts,calls:[{...call,source:'zoom'},{...call,id:'c2',outcome:'closed'}]});
 assert.equal(r.assessed_calls,2);assert.equal(r.examples[0].source,'zoom');
});
