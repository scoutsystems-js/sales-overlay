'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/stage-eligibility'),R=require('../lib/stage-eligibility-review'),V=require('../lib/stage-observation-review');
const turns=[{speaker:'PROSPECT',text:'Yes, I have a laptop.',start_seconds:20}];
const original={version:S.VERSION,source_hash:S.sourceHash(turns),context:{},sections:Object.fromEntries(S.SECTIONS.map(stage=>[stage,{state:stage==='discovery'?'evaluated':'not_applicable',score:stage==='discovery'?75:null,grade:stage==='discovery'?'B':null,reason:'observed_work',notes:stage==='discovery'?'The prospect has no laptop.':null,evidence:[]}]))};
const method=R.apply(original,{reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'Supported.',counterevidence_turns:[],unsupported_claims:[]}))},turns,'material');
test('a factual contradiction blocks a score even when the method reviewer approved it',()=>{
 const response={observations:[{moment:2,sentences:[{sentence:1,status:'contradicted',counterevidence:[{turn:1,speaker:'PROSPECT',quote:turns[0].text}],reason:'The prospect explicitly owns one.'}]}]};
 const result=V.applyPair(method,[response,response],turns,'material');
 assert.equal(result.sections.discovery.score,null);assert.equal(result.sections.pitch.state,'not_applicable');
 assert.ok(V.verified(result,turns,'material'));
});
test('a missing factual result cannot approve a numeric score and source changes invalidate its proof',()=>{
 const result=V.apply(method,null,turns,'material');
 assert.equal(result.sections.discovery.state,'unmeasured');
 assert.equal(V.verified(result,[{...turns[0],text:'Changed source.'}],'material'),false);
});

test('each stage proof request is limited to one score and its selected evidence',()=>{
 const finding={moment:2,stage:'discovery',observation:'CLOSER: asked about a laptop.',evidence:[{turn:1,speaker:'PROSPECT',quote:turns[0].text}]};
 const prompt=V.proofPrompt(finding,turns);
 assert.match(prompt,/Moment 2/);
 assert.match(prompt,/Yes, I have a laptop/);
 assert.doesNotMatch(prompt,/FULL TRANSCRIPT/);
 assert.equal(V.proofContext(finding,turns).turns.length,1);
});
