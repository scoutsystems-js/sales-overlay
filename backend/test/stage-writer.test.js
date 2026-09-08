'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/stage-eligibility');
const W=require('../lib/analysis-worker');

const turns=[
 {speaker:'CLOSER',start_seconds:10,text:'Who will make the purchase decision?'},
 {speaker:'PROSPECT',start_seconds:15,text:'I will make the purchase decision.'},
 {speaker:'CLOSER',start_seconds:20,text:'The price is one hundred dollars.'},
 {speaker:'PROSPECT',start_seconds:25,text:'Yes, I will buy it today.'},
];
const context={discovery:{areas:[{area:'decision_makers',evidence_turns:[1,2]}]},sales_conversation:true,ending:{state:'completed',evidence_turns:[4]},pitch:{occurred:true,evidence_turns:[3]},price:{occurred:true,evidence_turns:[3]},prior_presentation:{established:false,evidence_turns:[]},finance:{state:'not_assessed',evidence_turns:[],feasible_financing_ruled_out:null}};
const candidate={context,...Object.fromEntries(S.SECTIONS.map(stage=>[stage,{assessment:{state:'not_applicable',reason:'not_reached',evidence_turns:[]},grade:null,score:null,notes:null}]))};
candidate.discovery={assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[1]},grade:'B',score:75,notes:'Closer asked who would decide.'};
candidate.pitch={assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[3]},grade:'B',score:72,notes:'Closer stated the price.'};
candidate.close={assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[4]},grade:'A',score:84,notes:'Prospect said they would buy today.'};
const review={reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'The source supports this stage.',counterevidence_turns:[],unsupported_claims:[],note_claims:stage==='discovery'?[{clause:1,verdict:'supported',evidence_turns:[1]}]:stage==='pitch'?[{clause:1,verdict:'supported',evidence_turns:[3]}]:stage==='close'?[{clause:1,verdict:'supported',evidence_turns:[4]}]:[]}))};

test('writer stage lane uses one candidate and review, then persists only reviewed eligibility fields',async()=>{
 const calls=[];
 const fields=await W._stageColumnsForAnalysis({turns,duration:30,material:{contextText:'Offer',kbHash:'material'}},async request=>{
  calls.push(request);return calls.length===1?candidate:review;
 });
 assert.equal(calls.length,2,'the writer must not run factual-proof reads');
 assert.equal(S.stageMetric(fields,'discovery').score,75);
 const persisted=W._applyStageEligibilityToPayload({status:'done',overall_score:70,intro_score:1,discovery_score:1,pitch_score:1,objection_score:1,close_score_earned:1,close_score:1},fields,'closed');
 assert.equal(persisted.status,'done');
 assert.equal(persisted.overall_score,70);
 assert.equal(persisted.discovery_score,75);
 assert.equal(persisted.discovery_grade,'B');
 assert.match(persisted.discovery_notes,/Closer asked who would decide/);
 assert.equal(persisted.pitch_score,72);
 assert.equal(persisted.close_score_earned,84);
 assert.equal(persisted.close_score,100);
 assert.notEqual(persisted.discovery_score,1,'ordinary grader values cannot leak through');
});

test('candidate or reviewer failure writes five unmeasured stages without failing the normal payload',async()=>{
 const invalid={context:{},sections:[]};
 for(const failure of [Error('Candidate unavailable'),null,invalid]){
  let calls=0;
  const fields=await W._stageColumnsForAnalysis({turns,duration:30,material:{contextText:'Offer',kbHash:'material'}},async()=>{
   calls++;
   if(failure===invalid) return invalid;
   if(failure) throw failure;
   if(calls===1)return candidate;
   throw Error('Reviewer unavailable');
  });
  assert.equal(fields.stage_eligibility.summary.status,'withheld');
  const persisted=W._applyStageEligibilityToPayload({status:'done',overall_score:70,intro_score:99,discovery_score:99,pitch_score:99,objection_score:99,close_score_earned:99,close_score:99},fields,'closed');
  assert.equal(persisted.status,'done');
  for(const stage of S.SECTIONS){
   assert.deepEqual(S.stageMetric(persisted,stage),{state:'unmeasured',contributes:false,score:null,grade:null});
   assert.equal(persisted[stage==='close'?'close_score_earned':stage+'_score'],null);
  }
  assert.equal(persisted.close_score,null);
 }
});
