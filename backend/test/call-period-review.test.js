'use strict';const test=require('node:test'),assert=require('node:assert/strict'),P=require('../lib/call-period-review'),E=require('../lib/coaching-evidence-review');
const a={outcome:'follow_up',transcript_stored:[{speaker:'PROSPECT',text:'I have not checked what I can invest.',start_seconds:1},{speaker:'CLOSER',text:'Let us discuss the program.',start_seconds:2},{speaker:'PROSPECT',text:'All right, let us do that.',start_seconds:3}]};const m={kbHash:'k',contextText:'Establish available resources before presenting the offer.'};
const f={section:'discovery',move:'qualifying financially',observation:'The closer moved into the program while available resources remained unresolved.',recommendation:'Establish financial fit before presenting the offer.',turn_ids:[1,2,3],knowledge_refs:[E.knowledgeSources(m)[0].id]};
test('source identity includes outcome and exact speaker turns; rejects missing roles and fabricated evidence',()=>{assert.equal(P.prepare(a).hash,P.prepare(JSON.parse(JSON.stringify(a))).hash);assert.notEqual(P.prepare(a).hash,P.prepare({...a,outcome:'closed'}).hash);assert.equal(P.prepare({...a,transcript_stored:[...a.transcript_stored,{speaker:'UNKNOWN',text:'Who?',start_seconds:4}]}),null);assert.equal(P.candidates({findings:[f]},P.prepare(a),m).length,1);assert.equal(P.candidates({findings:[{...f,turn_ids:[1,2,99]}]},P.prepare(a),m).length,0);});
test('a draft alone cannot publish, and stale knowledge or changed transcripts cannot reuse approval',()=>{const c=P.prepare(a),rows=P.candidates({findings:[f]},c,m);assert.equal(P.finish(rows,null,c,m).findings.length,0);const record={version:P.VERSION,source_hash:c.hash,kb_hash:'k',findings:[{...f,moment:1}],decisions:[{moment:1,verdict:'approved'}]};assert.equal(P.storedExamples(record,a,'changed',{}),null);assert.equal(P.storedExamples(record,{...a,outcome:'closed'},'k',{}),null);assert.equal(P.storedExamples(record,a,'k',{}).length,1);});
test('correct work cannot become an improvement pattern even if a reviewer approves its factual text',()=>{const c=P.prepare(a);assert.equal(P.candidates({findings:[{...f,recommendation:'No change needed; the follow-up was booked correctly.'}]},c,m).length,0);const record={version:P.VERSION,source_hash:c.hash,kb_hash:'k',decisions:[{moment:1,verdict:'approved'}],findings:[{...f,moment:1,recommendation:'No change needed; the follow-up was booked correctly.'}]};assert.deepEqual(P.storedExamples(record,a,'k',{}),[]);});

test('booking claims require independent current scheduling facts; confirmed or unknown arrangements are withheld',()=>{
 const a={outcome:'follow_up',transcript_stored:[{speaker:'CLOSER',text:'Tomorrow at one?',start_seconds:1},{speaker:'PROSPECT',text:'Yes.',start_seconds:2}]};
 const F=require('../lib/followup-facts');
 const record={findings:[{move:'booking the follow-up'},{move:'digging for pain'}]};
 const facts={version:F.VERSION,source_hash:F.sourceHash(a),facts:{state:'not_booked',further_contact:true,declined:false,ending_complete:true}};
 assert.equal(P.applySchedulingFacts(record,a,facts).findings.length,2);
 assert.equal(P.applySchedulingFacts(record,a,{...facts,facts:{...facts.facts,state:'booked'}}).findings.length,1);
 assert.equal(P.applySchedulingFacts(record,a,null).findings.length,1);
 assert.equal(P.applySchedulingFacts(record,a,{...facts,source_hash:'stale'}).findings.length,1);
});

test('filtered original moment IDs keep their full-call context',()=>{
 const c=P.prepare(a),rows=P.candidates({findings:[f]},c,m).map(x=>({...x,moment:3}));
 const review={reviews:[{moment:3,verdict:'approve',knowledge_refs:f.knowledge_refs,evidence_turns:[1,2,3],history_refs:[],sentence_checks:E.adviceSentences(rows[0].coaching).map((_,i)=>({sentence:i+1,status:'supported',counterevidence_turns:[],reason:'Supported by the exchange.'}))}]};
 assert.equal(P.finish(rows,review,c,m).findings.length,1);
});
