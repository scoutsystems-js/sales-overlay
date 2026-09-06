'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path').join(__dirname,'../lib/manager-followup-assessment.js');
const M=fs.existsSync(path)?require(path):{};
const analysis={outcome:'follow_up',transcript_stored:[{speaker:'CLOSER',start_seconds:0,text:'Shall we talk Tuesday at noon?'},{speaker:'PROSPECT',start_seconds:5,text:'Yes, Tuesday at noon works.'}]};
const material={hasMaterial:true,kbHash:'kb1',contextText:'Agree a definite follow-up appointment when further contact is needed.',notes:{text:''}};
const verdict=(state)=>({state,evidence_turns:[1,2],knowledge_refs:[],ending_complete:true,reason:'Reviewed the complete stored conversation.'});
test('a booked appointment cannot count as a missed follow-up when either assessment finds it',async()=>{
 assert.equal(typeof M.assessFollowup,'function');
 let n=0;const result=await M.assessFollowup({analysis,material,request:async()=>({...verdict(n++?'booked':'issue'),knowledge_refs:[require('../lib/coaching-evidence-review').knowledgeSources(material)[0].id]})});
 assert.equal(result.state,'unknown');assert.equal(n,2);
});
test('two independent booked findings produce a clear assessment with exact source quotes',async()=>{
 const result=await M.assessFollowup({analysis,material,request:async()=>verdict('booked')});
 assert.equal(result.state,'clear');assert.equal(result.evidence[0].quote,analysis.transcript_stored[0].text);
});
test('issue requires matching assessments, a complete ending, and located team guidance',async()=>{
 const source=require('../lib/coaching-evidence-review').knowledgeSources(material)[0].id;
 const request=async()=>({...verdict('issue'),knowledge_refs:[source]});
 const result=await M.assessFollowup({analysis,material,request});
 assert.equal(result.state,'issue');assert.equal(M.isCurrent(result,analysis,material),true);
 assert.equal(M.isCurrent(result,{...analysis,outcome:'closed'},material),false);
 assert.equal(M.isCurrent(result,analysis,{...material,kbHash:'changed'}),false);
 for(const patch of [{knowledge_refs:['invented']},{ending_complete:false},{evidence_turns:[999]}]){
  assert.equal((await M.assessFollowup({analysis,material,request:async()=>({...verdict('issue'),knowledge_refs:[source],...patch})})).state,'unknown');
 }
});
test('unknown speakers, missing guidance and oversized inputs never spend or become negative findings',async()=>{
 let count=0;const request=async()=>{count++;return verdict('booked');};
 for(const options of [{analysis:{...analysis,transcript_stored:[{speaker:'UNKNOWN',start_seconds:1,text:'hello'}]},material},{analysis,material:{hasMaterial:false}},{analysis:{...analysis,transcript_stored:[{speaker:'CLOSER',start_seconds:0,text:'x'.repeat(250001)}]},material}]){
  assert.equal((await M.assessFollowup({...options,request})).state,'unknown');
 }
 assert.equal(count,0);
});
test('closed calls are explicitly outside this open-call issue; unknown outcomes remain unknown',async()=>{
 const request=async()=>{throw Error('must not spend');};
 assert.equal((await M.assessFollowup({analysis:{...analysis,outcome:'closed'},material,request})).state,'not_applicable');
 assert.equal((await M.assessFollowup({analysis:{...analysis,outcome:null},material,request})).state,'unknown');
});
test('independent assessment never receives the first answer and provider errors propagate for accounting',async()=>{
 const prompts=[];
 await M.assessFollowup({analysis,material,request:async(prompt)=>{prompts.push(prompt);return verdict('booked');}});
 assert.equal(prompts.length,2);assert.equal(prompts[0],prompts[1]);assert.match(prompts[0],/Tuesday at noon works/);
 await assert.rejects(()=>M.assessFollowup({analysis,material,request:async()=>{throw Error('provider failed');}}),/provider failed/);
});
test('diagnostic agreement never marks a result publishable',async()=>{
 const result=await M.assessFollowup({analysis,material,request:async()=>verdict('booked')});
 assert.equal(result.publication_ready,false);
});
