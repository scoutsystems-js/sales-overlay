'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=require('node:path').join(__dirname,'../lib/followup-facts.js');
const F=fs.existsSync(file)?require(file):{};
const analysis={outcome:'follow_up',transcript_stored:[{speaker:'CLOSER',start_seconds:100,text:'Tuesday at noon?'},{speaker:'PROSPECT',start_seconds:104,text:'Yes, that works.'}]};
const facts={state:'booked',further_contact:true,declined:false,ending_complete:true,evidence_turns:[1,2]};
test('fact reader assembles real quotes and never asks the model to authorize coaching',async()=>{
 assert.equal(typeof F.readFollowupFacts,'function');
 const prompts=[];const r=await F.readFollowupFacts(analysis,async p=>{prompts.push(p);return facts;});
 assert.equal(r.facts.state,'booked');assert.equal(r.evidence[0].quote,'Tuesday at noon?');assert.equal(prompts.length,2);
 assert.doesNotMatch(prompts[0],/Drill booking|TEAM GUIDANCE|knowledge_refs/);
});
test('a booked appointment in either read prevents a no-booking finding',async()=>{
 let n=0;const r=await F.readFollowupFacts(analysis,async()=>({...facts,state:n++?'booked':'not_booked'}));
 assert.equal(r.facts.state,'unknown');
});
test('missing turns, explicit uncertainty, contradictory refusal, and incomplete endings are held',async()=>{
 for(const patch of [{evidence_turns:[1,999]},{state:'unknown'},{declined:true},{ending_complete:false}]){
  const r=await F.readFollowupFacts(analysis,async()=>({...facts,...patch}));assert.equal(r.facts.state,'unknown');
 }
});
test('full-source hash changes when an earlier turn changes; malformed source never spends',async()=>{
 assert.notEqual(F.sourceHash(analysis),F.sourceHash({...analysis,transcript_stored:analysis.transcript_stored.slice(1)}));
 let count=0;const r=await F.readFollowupFacts({...analysis,transcript_stored:[{speaker:'UNKNOWN',text:'Hello',start_seconds:1}]},async()=>{count++;return facts;});
 assert.equal(count,0);assert.equal(r.facts.state,'unknown');
});
test('a complete scheduling exchange with more than twelve located turns remains valid',async()=>{
 const long={outcome:'follow_up',transcript_stored:Array.from({length:16},(_,i)=>({speaker:i%2?'PROSPECT':'CLOSER',text:i===14?'Tuesday 12:30?':i===15?'Yes, that works.':'Discussing availability.',start_seconds:400+i}))};
 const r=await F.readFollowupFacts(long,async()=>({...facts,evidence_turns:Array.from({length:16},(_,i)=>i+1)}));
 assert.equal(r.facts.state,'booked');assert.equal(r.evidence.length,16);
});
test('database JSON key ordering does not invalidate unchanged scheduling facts',()=>{
 const reordered={outcome:analysis.outcome,transcript_stored:analysis.transcript_stored.map(t=>({text:t.text,speaker:t.speaker,start_seconds:t.start_seconds}))};
 assert.equal(F.sourceHash(analysis),F.sourceHash(reordered));
});
