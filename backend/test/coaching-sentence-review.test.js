'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/coaching-evidence-review');
const coaching='In this exchange, no specific question surfaced what the thinking-it-over period needs to resolve. Establish what their reflection must answer.';
const material={contextText:'Explore the remaining concern.'};
const context={fullCall:false,turns:[{speaker:'CLOSER',text:"When you say that, are we talking on the model? Is it on sober living? What's going through your head?"}]};
const review={moment:1,verdict:'approve',knowledge_refs:[E.knowledgeSources(material)[0].id],evidence_turns:[1],sentence_checks:[{sentence:1,status:'contradicted',counterevidence_turns:[1],reason:'The closer asked what the thinking concerned.'},{sentence:2,status:'supported',counterevidence_turns:[],reason:'Directional guidance.'}]};
const decide=r=>E.evaluateEntries([{moment:1,coaching}],{reviews:[r]},[context],material)[0];
test('a global approval cannot override a contradicted sentence (actual Godwin failure shape)',()=>assert.equal(decide(review).category,'transcript_contradiction'));
test('every sentence must receive one supported check, with no counterevidence',()=>{
 const good={...review,sentence_checks:review.sentence_checks.map(c=>({...c,status:'supported',counterevidence_turns:[]}))};
 assert.equal(decide(good).verdict,'approved');
 for(const checks of [undefined,[],[good.sentence_checks[0]],[...good.sentence_checks,good.sentence_checks[0]],good.sentence_checks.map(c=>({...c,status:'unknown'})),good.sentence_checks.map(c=>({...c,counterevidence_turns:[1]}))])assert.equal(decide({...good,sentence_checks:checks}).verdict,'withheld');
});
test('the prompt numbers actual sentences so a reviewer cannot silently omit a clause-bearing sentence',()=>{
 const prompt=E.buildReviewPrompt([{moment:1,coaching}],[],[context],material,'follow_up');
 assert.ok(prompt.includes('[S1] In this exchange'));assert.ok(prompt.includes('[S2] Establish'));
});
