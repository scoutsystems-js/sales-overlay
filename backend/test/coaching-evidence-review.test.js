'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const E=require('../lib/coaching-evidence-review');
const quote='And I just hope that it is not something that will deter me from going forward.';
const turns=[{speaker:'PROSPECT',start_seconds:1765,text:quote},{speaker:'CLOSER',start_seconds:1778,text:'I know you said you have no idea what she will say.'},{speaker:'CLOSER',start_seconds:1780,text:'If she says the property is not compliant, what do you feel you will do then?'},{speaker:'PROSPECT',start_seconds:1800,text:'I would need to consider another property.'}];
const highlight={id:'h1',fathom_call_id:'c1',type:'objection',resolution:'unhandled',speaker:'PROSPECT',section:'close',timestamp_seconds:1823,quote,closer_response:turns[1].text,closer_response_verified:true};
const analysis={transcript_stored:{turns},outcome:'follow_up',why_outcome:''};
const material={hasMaterial:true,kbHash:'team-a',contextText:'Explore the concern and establish the next step.',notes:{rows:[],text:''},doctrineBlock:()=>''};
const context=E.contextFor(highlight,analysis);
test('regression: context includes the question after the saved reply and anchors the actual timestamp',()=>{
 assert.equal(context.anchor,1765);assert.ok(E.block(context).includes(turns[2].text));assert.equal(E.contextFor({...highlight,quote:'An invented excerpt with enough length'},analysis),null);
 assert.equal(E.safeAdvice('At 00:30:23 you only acknowledged it.'),false);
});
test('review requires evidence and knowledge support; missing, unsure and forged approvals fail closed',()=>{
 const entries=[{moment:1,coaching:'Explore the remaining concern.'}];const approved={moment:1,verdict:'approve',evidence_turns:[2,3],kb_support:material.contextText};
 assert.equal(E.approvedEntries(entries,{reviews:[approved]},[context],material).length,1);
 for(const reviews of [[],[{...approved,verdict:'reject'}],[{...approved,verdict:'unsure'}],[{...approved,kb_support:'Invented team rule'}],[{...approved,evidence_turns:[999]}],[approved,approved]]) assert.equal(E.approvedEntries(entries,{reviews},[context],material).length,0);
});
const usage=require('../lib/model-usage');let verdict='reject', prompts=[];
usage.createWithUsage=async(params,ctx)=>{prompts.push({prompt:params.messages[0].content,lane:ctx.lane});return {content:[{text:ctx.lane==='coaching-review'?JSON.stringify({reviews:[{moment:1,verdict,evidence_turns:[2,3],kb_support:material.contextText}]}):JSON.stringify([{moment:1,coaching:'You only acknowledged the concern and did not explore it.'}])}]};};
require('../lib/kb-material').loadKbMaterial=async()=>material;
const worker=require('../lib/analysis-worker');
function admin(writes){return {from(table){const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},gte(){return q;},lte(){return q;},update(p){writes.push({table,p});return q;},upsert(){return q;},maybeSingle:async()=>({data:table==='call_analyses'?analysis:null,error:null}),then(resolve,reject){return Promise.resolve({data:table==='call_highlights'?[highlight]:[],error:null}).then(resolve,reject);}};return q;}};}
test('real worker sends full exchange and team knowledge to a separate reviewer; rejected advice is not persisted',async()=>{
 const writes=[];prompts=[];verdict='reject';const result=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
 assert.equal(prompts.length,2);assert.equal(prompts[1].lane,'coaching-review');
 for(const p of prompts){assert.ok(p.prompt.includes(turns[2].text));assert.ok(p.prompt.includes(material.contextText));}
 assert.equal(result.written,0);assert.ok(!writes.some(w=>w.p.coaching));
 verdict='approve';writes.length=0;const approved=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
 assert.equal(approved.written,1);const saved=writes.find(w=>w.p.coaching);assert.equal(saved.p.coaching_review.anchor,1765);assert.equal(saved.p.coaching_review.kb_hash,'team-a');
});
