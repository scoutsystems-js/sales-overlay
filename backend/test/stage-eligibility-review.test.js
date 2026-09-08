'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/stage-eligibility-review');
const S=require('../lib/stage-eligibility');
const turns=[{speaker:'PROSPECT',text:'I have fifteen thousand saved.',start_seconds:10}];
const assessment={version:S.VERSION,source_hash:S.sourceHash(turns),context:{},sections:Object.fromEntries(S.SECTIONS.map(k=>[k,{state:'evaluated',score:75,grade:'C',notes:'The available savings were checked.',reason:'Financial information was established.',evidence:[{speaker:'PROSPECT',quote:turns[0].text,timestamp_seconds:10}]}]))};
const supported={reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'The actual exchange supports this judgment.',counterevidence_turns:[],unsupported_claims:[]}))};
test('a rejected or missing independent stage review withholds that grade without erasing supported stages',()=>{
 const response={reviews:supported.reviews.map(r=>r.stage==='discovery'?{...r,verdict:'contradicted',reason:'Savings were already disclosed.',counterevidence_turns:[1],unsupported_claims:['Savings were never checked.']}:r).filter(r=>r.stage!=='pitch')};
 const result=R.apply(assessment,response,turns,'material');
 assert.equal(result.sections.discovery.state,'unmeasured');assert.equal(result.sections.discovery.score,null);
 assert.equal(result.sections.pitch.state,'unmeasured');assert.equal(result.sections.intro.score,75);
});
test('a supported verdict with counterevidence or duplicate reviews cannot approve a stage',()=>{
 const response={reviews:[...supported.reviews,{...supported.reviews[0]}]};
 assert.equal(R.apply(assessment,response,turns,'material').sections.intro.score,null);
 const other={reviews:supported.reviews.map(r=>({...r,counterevidence_turns:[1]}))};
 assert.ok(Object.values(R.apply(assessment,other,turns,'material').sections).every(s=>s.score===null));
});
test('approval survives JSON key reordering but not changed source, guidance or grade',()=>{
 const r=R.apply(assessment,supported,turns,'material');
 assert.ok(R.verified(r,turns,'material'));
 const reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reorder(x[k])])):x;
 assert.ok(R.verified(reorder(r),turns,'material'));
 assert.equal(R.verified({...r,sections:{...r.sections,intro:{...r.sections.intro,score:99}}},turns,'material'),false);
 assert.equal(R.verified(r,[{...turns[0],text:'Changed source.'}],'material'),false);
 assert.equal(R.verified(r,turns,'changed'),false);
});

test('review proof binds conversation context as well as stage scores',()=>{
 const r=R.apply(assessment,supported,turns,'material');
 assert.equal(R.verified({...r,context:{finance:{state:'genuine_dq'}}},turns,'material'),false);
});

test('a small deduction for work not established as due still withholds the grade',()=>{
 const response={reviews:supported.reviews.map(r=>({...r,omissions:[{claim:'Did not finish discovery.',due_now:null,evidence_turns:[]}]}))};
 assert.ok(Object.values(R.apply(assessment,response,turns,'material').sections).every(s=>s.score===null));
});

test('the evidence reviewer cannot infer a fault from the numeric grade',()=>{
 const candidate={context:{ending:{state:'completed'}},intro:{score:72,grade:'C',notes:'The call direction was established.',assessment:{state:'evaluated',reason:'The agenda was agreed.',evidence_turns:[1]}}};
 const p=R.prompt(candidate,turns,{contextText:''});
 assert.ok(!p.includes('"score":72'));assert.ok(!p.includes('"grade":"B"'));
 assert.ok(p.includes('The call direction was established.'));
});

function atomicReview({note,evidence,review}) {
 return {
  version:S.VERSION,
  source_hash:S.sourceHash(turns),
  context:{},
  sections:Object.fromEntries(S.SECTIONS.map(stage=>[stage,stage==='discovery'?{
   state:'evaluated',score:75,grade:'C',notes:note,reason:'observed_work',evidence,
  }:{state:'not_applicable',score:null,grade:null,notes:null,reason:'not_reached',evidence:[]}])) ,
  response:{reviews:S.SECTIONS.map(stage=>stage==='discovery'?review:{stage,verdict:'supported',facts_supported:true,omissions:[],reason:'No score proposed.',counterevidence_turns:[],unsupported_claims:[],note_claims:[]})},
 };
}

test('a partner being absent cannot pass review as partner decision necessity',()=>{
 const source=[{speaker:'CLOSER',text:'Will your partner be on the call?',start_seconds:1},{speaker:'PROSPECT',text:'My partner cannot join this meeting.',start_seconds:2}];
 const note='Closer asked whether the partner would join; Prospect said the partner needed to be present for the decision.';
 const review={stage:'discovery',verdict:'supported',facts_supported:true,omissions:[],reason:'The note is supported.',counterevidence_turns:[],unsupported_claims:[],note_claims:[{clause:1,verdict:'supported',evidence_turns:[1]},{clause:2,verdict:'contradicted',evidence_turns:[2]}]};
 const input=atomicReview({note,evidence:[{speaker:'CLOSER',quote:source[0].text,timestamp_seconds:1,turn:1},{speaker:'PROSPECT',quote:source[1].text,timestamp_seconds:2,turn:2}],review});
 input.source_hash=S.sourceHash(source);
 assert.equal(R.apply(input,input.response,source,'material').sections.discovery.state,'unmeasured');
});

test('family involvement cannot pass review as decision dependency or wrong actor attribution',()=>{
 const source=[{speaker:'CLOSER',text:'Does your decision depend on your brother?',start_seconds:1},{speaker:'PROSPECT',text:'No, he would move forward separately.',start_seconds:2}];
 const note='Closer asked whether the decision depended on the brother; Prospect said the decision depended on the brother.';
 const review={stage:'discovery',verdict:'supported',facts_supported:true,omissions:[],reason:'The note is supported.',counterevidence_turns:[],unsupported_claims:[],note_claims:[{clause:1,verdict:'supported',evidence_turns:[1]},{clause:2,verdict:'contradicted',evidence_turns:[2]}]};
 const input=atomicReview({note,evidence:[{speaker:'CLOSER',quote:source[0].text,timestamp_seconds:1,turn:1},{speaker:'PROSPECT',quote:source[1].text,timestamp_seconds:2,turn:2}],review});
 input.source_hash=S.sourceHash(source);
 assert.equal(R.apply(input,input.response,source,'material').sections.discovery.state,'unmeasured');
});

test('review prompt requires each scored note clause to be directly grounded in its cited actor evidence',()=>{
 const candidate={context:{},discovery:{assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[1]},score:75,notes:'Closer asked who would decide.'}};
 const prompt=R.prompt(candidate,[{speaker:'PROSPECT',text:'I decide alone.',start_seconds:1}],{contextText:''});
 assert.match(prompt,/each factual clause/i);
 assert.match(prompt,/cited evidence/i);
 assert.match(prompt,/actor is wrong/i);
});

test('a proof from an older stage policy cannot be promoted under the new policy',()=>{
 const old={...assessment,version:'old-stage-policy'};
 const r=R.apply(old,supported,turns,'material');
 assert.equal(R.verified(r,turns,'material'),false);
});
