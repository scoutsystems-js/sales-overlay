'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/stage-eligibility');
const turns=[{speaker:'CLOSER',text:'Who else needs to be here for the decision?',start_seconds:10},{speaker:'PROSPECT',text:'Tomorrow at noon works for us both.',start_seconds:15}];
const context={discovery:{areas:[]},sales_conversation:true,ending:{state:'appropriate_continuation',reason:'A joint continuation was booked.',evidence_turns:[1,2]},pitch:{occurred:false,evidence_turns:[]},price:{occurred:false,evidence_turns:[]},prior_presentation:{established:false,evidence_turns:[]},finance:{state:'not_assessed',reason:'Not assessed.',evidence_turns:[],feasible_financing_ruled_out:null}};
const candidate={context,...Object.fromEntries(S.SECTIONS.map(k=>[k,{assessment:{state:'not_applicable',reason:'This stage was not due.',evidence_turns:[1,2]},grade:null,score:null,notes:null}]))};
const review={reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'The recorded continuation supports the eligibility.',counterevidence_turns:[],unsupported_claims:[],note_claims:[{clause:1,verdict:'supported',evidence_turns:[1]}]}))};
test('stage assessment uses two bounded structured requests and returns source-bound reviewed results',async()=>{
 const A=require('../lib/stage-assessment');const requests=[];
 const result=await A.run({turns,duration:15,material:{contextText:'Team offer',kbHash:'material'}},async request=>{requests.push(request);return requests.length===1?candidate:review;});
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.output_config.format.type==='json_schema'));
 assert.ok(require('../lib/stage-eligibility-review').verified(result.record,turns,S.guidanceHash({contextText:'Team offer',kbHash:'material'})));
 assert.equal(result.record.sections.close.state,'not_applicable');
});
test('a failed evidence check does not return a candidate as an approved score',async()=>{
 const A=require('../lib/stage-assessment');let calls=0;
 await assert.rejects(A.run({turns,duration:15,material:{kbHash:'material'}},async()=>{if(++calls===1)return candidate;throw Error('Reviewer unavailable');}),/Reviewer unavailable/);
});

test('offline reviewed QA makes one candidate and one independent review, never factual-proof reads',async()=>{
 const A=require('../lib/stage-assessment');const requests=[];
 const result=await A.runReviewedQa({turns,duration:15,material:{contextText:'Team offer',kbHash:'material'}},async request=>{
  requests.push(request);
  return requests.length===1?candidate:review;
 });
 assert.equal(requests.length,2);
 assert.equal(result.factual,undefined);
 assert.ok(require('../lib/stage-eligibility-review').verified(result.record,turns,S.guidanceHash({contextText:'Team offer',kbHash:'material'})));
});

test('unsafe candidate wording is withheld before it reaches the independent reviewer',async()=>{
 const A=require('../lib/stage-assessment');const requests=[];
 const unsafe={...candidate,context:{...context,discovery:{areas:[{area:'decision_makers',evidence_turns:[1,2]}]}},discovery:{assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[1]},grade:'C',score:75,notes:'The closer correctly learned the partner would attend.'}};
 const result=await A.run({turns,duration:15,material:{contextText:'Team offer',kbHash:'material'}},async request=>{
  requests.push(request);
  if(requests.length===2) assert.doesNotMatch(request.messages[0].content,/correctly learned/i);
  return requests.length===1?unsafe:review;
 });
 assert.equal(result.record.sections.discovery.state,'unmeasured');
});

test('a measured stage requires two factual reads before it is returned as verified',async()=>{
 const A=require('../lib/stage-assessment');const requests=[];
const measured={...candidate,context:{...context,discovery:{areas:[{area:'decision_makers',evidence_turns:[1,2]}]}},discovery:{assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[1]},grade:'C',score:75,notes:'Closer asked who would decide.'}};
 const factual={moment:2,status:'supported',claims:[{text:'Closer asked who would decide.',actor:'CLOSER',kind:'action',evidence:[{turn:1,speaker:'CLOSER',quote:turns[0].text}]}],evidence:[{turn:1,speaker:'CLOSER',quote:turns[0].text}],counterevidence:[],reason:'The source supports this observation.'};
 const result=await A.run({turns,duration:15,material:{contextText:'Team offer',kbHash:'material'}},async request=>{requests.push(request);return [measured,review,factual,factual][requests.length-1];});
 assert.equal(requests.length,4);
 assert.equal(result.factual.length,1);assert.equal(result.factual[0].responses.length,2);
 assert.ok(require('../lib/stage-observation-review').verified(result.record,turns,S.guidanceHash({contextText:'Team offer',kbHash:'material'})));
});

test('the output schema stays within the provider limit of sixteen union fields',()=>{
 const schema=require('../lib/stage-output-schema').producer;
 const count=x=>!x||typeof x!=='object'?0:(Array.isArray(x.type)||Array.isArray(x.anyOf)?1:0)+Object.values(x).reduce((n,v)=>n+(Array.isArray(v)?v.reduce((m,c)=>m+count(c),0):count(v)),0);
 assert.ok(count(schema)<=16);
});

test('the provider-facing stage transport uses the known compact unconstrained array shape',()=>{
 const sections=require('../lib/stage-output-schema').producer.properties.sections;
 assert.equal(sections.type,'array');
 assert.equal(Object.hasOwn(sections,'minItems'),false);
 assert.equal(Object.hasOwn(sections,'maxItems'),false);
 assert.equal(sections.items.type,'object');
 assert.deepEqual(Object.keys(sections.items.properties).sort(),['assessment','grade','notes','score','section']);
 const evidence=sections.items.properties.assessment.properties.evidence_turns;
 assert.equal(evidence.type,'object');
 assert.deepEqual(Object.keys(evidence.properties),['turn_1','turn_2','turn_3','turn_4','turn_5','turn_6','turn_7','turn_8']);
});

test('both stage generation and evidence review read the canonical coaching method',()=>{
 const guide=S.methodGuide();
 assert.ok(S.buildPrompt({turns},15,'Offer').includes(guide));
 assert.ok(require('../lib/stage-eligibility-review').prompt(candidate,turns,{contextText:'Offer'}).includes(guide));
 assert.notEqual(S.guidanceHash({kbHash:'a',contextText:'First offer'}),S.guidanceHash({kbHash:'a',contextText:'Changed offer'}));
});
