'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const E=require('../lib/coaching-evidence-review');
// Constructed approvals exercise the protocol, not model accuracy.
const checks=text=>E.adviceSentences(text).map((_,i)=>({sentence:i+1,status:'supported',counterevidence_turns:[],reason:'Fixture support.'}));
const quote='And I just hope that it is not something that will deter me from going forward.';
const turns=[{speaker:'PROSPECT',start_seconds:1765,text:quote},{speaker:'CLOSER',start_seconds:1778,text:'I know you said you have no idea what she will say.'},{speaker:'CLOSER',start_seconds:1780,text:'If she says the property is not compliant, what do you feel you will do then?'},{speaker:'PROSPECT',start_seconds:1800,text:'I would need to consider another property.'}];
const highlight={id:'h1',fathom_call_id:'c1',type:'objection',resolution:'unhandled',speaker:'PROSPECT',section:'close',observation:'UNVERIFIED_INTERPRETATION_NOT_FOR_WRITER',timestamp_seconds:1823,quote,closer_response:turns[1].text,closer_response_verified:true};
const analysis={transcript_stored:{turns},outcome:'follow_up',why_outcome:''};
const material={hasMaterial:true,kbHash:'team-a',contextText:'Explore the concern and establish the next step.',notes:{rows:[],text:''},doctrineBlock:()=>''};
const context=E.contextFor(highlight,analysis);
test('regression: context includes the question after the saved reply and anchors the actual timestamp',()=>{
 assert.equal(context.anchor,1765);assert.ok(E.block(context).includes(turns[2].text));assert.equal(E.contextFor({...highlight,quote:'An invented excerpt with enough length'},analysis),null);
 assert.equal(E.safeAdvice('At 00:30:23 you only acknowledged it.'),false);
});
test('review requires evidence and knowledge support; missing, unsure and forged approvals fail closed',()=>{
 const entries=[{moment:1,coaching:'Explore the remaining concern.'}];const approved={moment:1,verdict:'approve',sentence_checks:checks(entries[0].coaching),evidence_turns:[2,3],knowledge_refs:[E.knowledgeSources(material)[0].id],history_refs:[]};
 assert.equal(E.approvedEntries(entries,{reviews:[approved]},[context],material).length,1);
 for(const reviews of [[],[{...approved,verdict:'reject'}],[{...approved,verdict:'unsure'}],[{...approved,knowledge_refs:['K-invented']}],[{...approved,evidence_turns:[999]}],[approved,approved]]) assert.equal(E.approvedEntries(entries,{reviews},[context],material).length,0);
});
const usage=require('../lib/model-usage');let verdict='reject', prompts=[], draft='Explore the concern before proceeding.', invalidRef=false, draftRows=null, reviewRows=null, highlightRows=null;
usage.createWithUsage=async(params,ctx)=>{prompts.push({prompt:params.messages[0].content,lane:ctx.lane});return {content:[{text:ctx.lane==='coaching-review'?JSON.stringify({reviews:reviewRows||[{moment:1,verdict,sentence_checks:checks(draft),evidence_turns:[2,3],knowledge_refs:[invalidRef?'K-forged':E.knowledgeSources(material)[0].id],history_refs:[]}]}):'Context reference [42–43].\n```json\n'+JSON.stringify(draftRows||[{moment:1,coaching:draft}])+'\n```'}]};};
require('../lib/kb-material').loadKbMaterial=async()=>material;
const worker=require('../lib/analysis-worker');
test('production parser reads a fenced coaching array after prose containing transcript references',()=>{
 const text='The closer isolated correctly at [42–43].\n\n```json\n[{"moment":1,"coaching":null,"no_change":true}]\n```';
 assert.deepEqual(worker._extractFirstJsonArray(text),[{moment:1,coaching:null,no_change:true}]);
});
function admin(writes){return {from(table){let write;const q={select(){return q;},eq(key,value){if(write)(write.filters||(write.filters={}))[key]=value;return q;},in(){return q;},order(){return q;},gte(){return q;},lte(){return q;},update(p){write={table,p};writes.push(write);return q;},upsert(){return q;},maybeSingle:async()=>({data:table==='call_analyses'?analysis:null,error:null}),then(resolve,reject){return Promise.resolve({data:table==='call_highlights'?(highlightRows||[highlight]):[],error:null}).then(resolve,reject);}};return q;}};}
test('real worker sends full exchange and team knowledge to a separate reviewer; rejected advice is not persisted',async()=>{
 const writes=[];prompts=[];verdict='reject';const result=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
 assert.equal(prompts.length,2);assert.equal(prompts[1].lane,'coaching-review');
 assert.ok(prompts[0].prompt.includes('ACTION / ANSWER RECORD'));
 assert.ok(!prompts[0].prompt.includes('UNVERIFIED_INTERPRETATION_NOT_FOR_WRITER'));
 for(const p of prompts){assert.ok(p.prompt.includes(turns[2].text));assert.ok(p.prompt.includes(material.contextText));}
 assert.equal(result.written,0);assert.ok(!writes.some(w=>w.p.coaching));
 verdict='approve';writes.length=0;const approved=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
 assert.equal(approved.written,1);const saved=writes.find(w=>w.p.coaching);assert.equal(saved.p.coaching_review.anchor,1765);assert.equal(saved.p.coaching_review.kb_hash,'team-a');
});

test('real worker withholds historical claims even when reviewer approves, and stores distinct reasons',async()=>{
 verdict='approve';draft='Twenty-one earlier calls have surfaced this same gap in qualification.';
 let writes=[];const result=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
 assert.equal(result.written,0);assert.ok(writes.some(w=>w.p.coaching_review?.category==='missing_evidence'));
 draft='Explore the concern before proceeding.';invalidRef=true;writes=[];
 assert.equal((await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1')).written,0);
 assert.ok(writes.some(w=>w.p.coaching_review?.category==='invalid_reference'));invalidRef=false;
});
test('knowledge IDs survive formatting changes; unknown or foreign references are refused',()=>{
 const sources=E.knowledgeSources(material);assert.equal(sources[0].id,E.knowledgeSources({...material,contextText:'Explore  the concern and establish the next step.'})[0].id);
 const advice=[{moment:1,coaching:'Explore the concern.'}];const r={moment:1,verdict:'approve',sentence_checks:checks(advice[0].coaching),knowledge_refs:[sources[0].id],evidence_turns:[2]};
 assert.equal(E.evaluateEntries(advice,{reviews:[r]},[context],material)[0].category,'approved');
 assert.equal(E.evaluateEntries(advice,{reviews:[r]},[context],{...material,contextText:'Another team uses different material.'})[0].category,'invalid_reference');
 assert.equal(E.evaluateEntries(advice,{reviews:[{...r,verdict:'reject',reason_code:'transcript_contradiction'}]},[context],material)[0].category,'transcript_contradiction');
});
test('memory statements require actual distinct earlier call IDs and a matching moment reference',()=>{
 const moment={type:'missed_opportunity'};const facts=E.historyFacts({missed_opportunity:{calls:999,call_ids:['c1','c2','c2','current']}},[moment],'current');
 assert.match(facts[0].text,/2 earlier calls/);assert.doesNotMatch(facts[0].text,/999/);
 const e=[{moment:1,coaching:'Explore the concern. '+facts[0].text}];const r={moment:1,verdict:'approve',sentence_checks:checks(e[0].coaching),knowledge_refs:[E.knowledgeSources(material)[0].id],evidence_turns:[1],history_refs:[facts[0].id]};
 assert.equal(E.approvedEntries(e,{reviews:[r]},[context],material,facts).length,1);
 assert.equal(E.approvedEntries(e,{reviews:[r]},[context],material,[]).length,0);
 assert.equal(E.approvedEntries(e,{reviews:[{...r,history_refs:['H-other']}]},[context],material,facts).length,0);
 assert.equal(E.approvedEntries([{moment:1,coaching:'Twenty-one earlier calls have surfaced this same gap.'}],{reviews:[r]},[context],material,facts).length,0);
});
test('accepted legacy reviews remain readable without upgrading their provenance',()=>{
 assert.equal(E.isApprovedReview({version:'coaching-evidence-v1',verdict:'approved'}),true);
 assert.equal(E.isApprovedReview({version:'coaching-evidence-v1',verdict:'rejected'}),false);
 assert.equal(E.isApprovedReview({version:'unknown',verdict:'approved'}),false);
});
test('history reads beyond one database page and refuses a failed page',async()=>{
 const H=require('../lib/coaching-history');const all=Array.from({length:1001},(_,i)=>({user_id:'u',pattern_key:'missed_opportunity',fathom_call_id:'c'+i,call_date:'2026-08-01'}));let calls=0,fail=false;
 const db={from(){let start=0,end=999;const q={select(){return q;},in(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},then(resolve,reject){calls++;return Promise.resolve({data:all.slice(start,end+1),error:fail&&start>0?{message:'read failed'}:null}).then(resolve,reject);}};return q;}};
 assert.equal((await H.loadHistory(db,['u'])).u.missed_opportunity.calls,1001);assert.equal(calls,2);
 fail=true;await assert.rejects(H.loadHistory(db,['u']),/read failed/);
});

test('the worker withholds overlong drafts before paying for a reviewer, without truncation',async()=>{
 const writes=[];prompts=[];draft=Array.from({length:91},()=> 'word').join(' ');verdict='approve';
 try {
  const result=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
  assert.equal(prompts.length,1);
  assert.equal(result.written,0);
  assert.ok(writes.some(w=>w.p.coaching_review?.category==='invalid_format'));
  assert.ok(!writes.some(w=>w.p.coaching));
 } finally {draft='Explore the concern before proceeding.';}
});

test('the real worker reviews and writes original moment 2 when moment 1 is no-change',async()=>{
 const writes=[];prompts=[];
 highlightRows=[highlight,{...highlight,id:'h2',observation:'A second candidate on the same located exchange.'}];
 draftRows=[{moment:1,coaching:null,no_change:true},{moment:2,coaching:'Explore the remaining concern.'}];
 reviewRows=[{moment:2,verdict:'approve',sentence_checks:checks(draftRows[1].coaching),evidence_turns:[1,2],knowledge_refs:[E.knowledgeSources(material)[0].id]}];
 try {
  const result=await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1');
  assert.equal(result.written,1);
  assert.match(prompts.find(p=>p.lane==='coaching-review').prompt,/Requested moment IDs: \[2\]/);
  assert.deepEqual(writes.filter(w=>w.p.coaching).map(w=>w.filters.id),['h2']);
  reviewRows[0].moment=1;writes.length=0;
  assert.equal((await worker._coachCallMoments(admin(writes),'c1','follow_up',null,null,'u1')).written,0);
  assert.ok(!writes.some(w=>w.p.coaching));
 } finally {highlightRows=null;draftRows=null;reviewRows=null;}
});
