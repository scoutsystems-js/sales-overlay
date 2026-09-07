'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-eligibility');
const context={discovery:{areas:[{area:'decision_makers',evidence_turns:[1]}]},sales_conversation:true,ending:{state:'appropriate_continuation',evidence_turns:[1]},pitch:{occurred:false,evidence_turns:[]},price:{occurred:false,evidence_turns:[]},prior_presentation:{established:false,evidence_turns:[]},finance:{state:'not_assessed',feasible_financing_ruled_out:null,evidence_turns:[]}};
const assess=(parsed,turns)=>S.assess({context,...parsed},turns);
const turns = [
 {speaker:'CLOSER',start_seconds:10,text:'Who else needs to be here for the decision?'},
 {speaker:'PROSPECT',start_seconds:15,text:'My partner. We can both join tomorrow.'},
 {speaker:'CLOSER',start_seconds:20,text:'Let us meet tomorrow at noon.'},
 {speaker:'PROSPECT',start_seconds:25,text:'Yes, noon works for both of us.'},
];
const evidence = [{speaker:'CLOSER',timestamp_seconds:10,quote:turns[0].text},{speaker:'PROSPECT',timestamp_seconds:15,quote:turns[1].text}];
const measured = {grade:'B',score:78,notes:'CLOSER: asked who would decide.',assessment:{state:'evaluated',reason:'Decision-maker qualification occurred.',evidence}};
// Simulated model response for persistence tests; semantic accuracy is tested on real calls.
function simulatedFacts(method){const V=require('../lib/stage-observation-review'),E=require('../lib/coaching-evidence-review');const evidence=[{turn:1,speaker:'CLOSER',quote:turns[0].text}];const response={observations:V.findings(method).map(f=>({moment:f.moment,sentences:E.adviceSentences(f.observation).map((text,i)=>({sentence:i+1,status:'supported',claims:[{text,actor:'CLOSER',kind:'action',evidence}],evidence,counterevidence:[],reason:'Source supports this synthetic observation.'}))}))};return V.applyPair(method,[response,response],turns,'material');}
function savedAssessment(r){const R=require('../lib/stage-eligibility-review');const checked=R.apply(r,{reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'Source supports this stage.',counterevidence_turns:[],unsupported_claims:[]}))},turns,'material');return S.toColumns(simulatedFacts(checked),String,turns,'material').stage_eligibility;}
test('a measured qualification is retained; an appropriately omitted stage never contributes a numeric score',()=>{
 const result=assess({discovery:measured,close:{...measured,score:0,assessment:{state:'not_applicable',reason:'The buyer and decision maker booked the full discussion for tomorrow.',evidence}}},turns);
 assert.equal(result.sections.discovery.state,'evaluated');assert.equal(result.sections.discovery.score,78);
 assert.equal(result.sections.close.state,'not_applicable');assert.equal(result.sections.close.score,null);assert.equal(result.sections.close.grade,null);
});
test('missing stage, malformed measurement, invented quote and wrong speaker become unmeasured, never zero',()=>{
 for(const bad of [undefined,{...measured,score:NaN},{...measured,score:101},{...measured,assessment:{...measured.assessment,evidence:[{...evidence[0],quote:'Invented sales behavior.'}]}},{...measured,assessment:{...measured.assessment,evidence:[{...evidence[0],speaker:'PROSPECT'}]}}]){
  const r=assess({discovery:bad},turns).sections.discovery;assert.equal(r.state,'unmeasured');assert.equal(r.score,null);
 }
});
test('an evidenced expected miss can be graded; absence alone cannot manufacture a failure',()=>{
 const r=assess({discovery:{...measured,score:45,grade:'D',assessment:{...measured.assessment,state:'expected_but_missed'}}},turns);
 assert.equal(r.sections.discovery.state,'expected_but_missed');assert.equal(r.sections.discovery.score,45);
 const without=assess({discovery:{...measured,assessment:{...measured.assessment,state:'expected_but_missed',evidence:[]}}},turns);
 assert.equal(without.sections.discovery.state,'unmeasured');
});
test('new assessments cannot be read as valid after their score columns change',()=>{
 const r=savedAssessment(assess({discovery:measured},turns));
 assert.equal(S.read({stage_eligibility:r,discovery_score:78},'discovery').score,78);
 assert.equal(S.read({stage_eligibility:r,discovery_score:22},'discovery').state,'unmeasured');
 assert.equal(S.read({discovery_score:22},'discovery').state,'legacy_unreviewed');
});
test('the unvalidated stage experiment does not change the normal live grader',()=>{
 const W=require('../lib/analysis-worker');const n={turns,closer_name:'Rep',speaker_confidence:'matched'};
 const full=W._buildSectionGraderPrompt(n,25,'Team offer',null,{});
 const stages=W._buildSectionGraderPrompt(n,25,'Team offer',null,{stageOnly:true});
 assert.ok(!full.includes(S.INSTRUCTIONS));assert.ok(stages.includes(S.INSTRUCTIONS));
 assert.ok(stages.includes('Team offer'));assert.ok(stages.includes(turns[0].text));
 assert.doesNotMatch(stages,/from the first 60 seconds|Then provide call-level fields|"cash_collected"/);
 assert.match(full,/Then provide call-level fields/);
});
test('period averages respect explicit eligibility rather than whichever numeric columns happen to exist',()=>{
 const R=require('../lib/section-ranking');
 const row={stage_eligibility:savedAssessment(assess({discovery:measured,close:{...measured,assessment:{...measured.assessment,state:'not_applicable'}}},turns)),discovery_score:78,close_score_earned:0};
 const stats=R.sectionStatsFromAnalyses([row]);
 assert.equal(stats.discovery.mean,78);assert.equal(stats.close.mean,null);assert.equal(stats.close.n,0);
 assert.equal(stats.close.eligibility.not_applicable,1);assert.equal(stats.pitch.eligibility.unmeasured,1);
});

test('unique exact text repairs time and joins only adjacent same-speaker fragments; repeated quotes require a real anchor',()=>{
 const fragmented=[{speaker:'CLOSER',start_seconds:10,text:'Who else needs'}, {speaker:'CLOSER',start_seconds:11,text:'to be here for the decision?'}];
 const r=assess({discovery:{...measured,assessment:{...measured.assessment,evidence:[{...evidence[0],timestamp_seconds:900}]}}},fragmented);
 assert.equal(r.sections.discovery.score,78);assert.equal(r.sections.discovery.evidence[0].timestamp_seconds,10);
 const repeated=fragmented.concat(fragmented.map(t=>({...t,start_seconds:t.start_seconds+100})));
 const bad=assess({discovery:{...measured,assessment:{...measured.assessment,evidence:[{...evidence[0],timestamp_seconds:900}]}}},repeated);
 assert.equal(bad.sections.discovery.state,'unmeasured');
 const crossed=fragmented.map((t,i)=>({...t,speaker:i?'PROSPECT':t.speaker}));
 assert.equal(assess({discovery:measured},crossed).sections.discovery.state,'unmeasured');
});
test('indexed evidence is copied from the actual turn and invalid references withhold the measurement',()=>{
 const input={...measured,assessment:{state:'evaluated',reason:'The decision-maker check occurred.',evidence_turns:[1,2]}};
 const r=assess({discovery:input},turns);
 assert.equal(r.sections.discovery.evidence[0].quote,turns[0].text);
 assert.equal(r.sections.discovery.evidence[0].timestamp_seconds,10);
 assert.equal(assess({discovery:{...input,assessment:{...input.assessment,evidence_turns:[999]}}},turns).sections.discovery.state,'unmeasured');
});
test('persistence carries eligibility and earned scores together, with original source excerpts and no outcome writes',()=>{
 const r=assess({discovery:measured},turns);
 const review=require('../lib/stage-eligibility-review');
 const checked=review.apply(r,{reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'Source supports this stage.',counterevidence_turns:[],unsupported_claims:[]}))},turns,'material');
 const p=S.toColumns(simulatedFacts(checked),s=>'00:00:'+s,turns,'material');
 assert.equal(p.discovery_score,78);assert.equal(p.close_score_earned,null);
 assert.ok(p.discovery_notes.includes(turns[0].text));assert.deepEqual(p.stage_eligibility.sections,checked.sections);
 assert.equal(p.outcome,undefined);assert.equal(p.close_score,undefined);assert.equal(p.rep_period_coaching,undefined);
});

test('missing structural facts, an objection before presentation, and unproven financial DQ cannot yield trusted grades',()=>{
 assert.equal(S.assess({discovery:measured},turns).sections.discovery.state,'unmeasured');
 assert.equal(assess({objection:measured},turns).sections.objection.state,'unmeasured');
 const doubtful={...context,finance:{state:'genuine_dq',feasible_financing_ruled_out:false,evidence_turns:[2]}};
 assert.equal(assess({context:doubtful,discovery:measured},turns).sections.discovery.state,'unmeasured');
});

test('valid long source evidence is not discarded by an arbitrary turn count',()=>{
 const long=Array.from({length:30},(_,i)=>({speaker:'CLOSER',start_seconds:i,text:'Source line '+i}));
 const ids=long.map((_,i)=>i+1);
 const c={...context,pitch:{occurred:true,evidence_turns:ids}};
 const r=assess({context:c,discovery:{...measured,assessment:{state:'evaluated',reason:'Relevant work is evidenced.',evidence_turns:ids}}},long);
 assert.equal(r.sections.discovery.score,78);
});
test('an absent stage can use actual conversation context, but an unevidenced miss cannot',()=>{
 const empty={...measured,assessment:{state:'not_applicable',reason:'The decision-maker conversation was continued.',evidence_turns:[]}};
 assert.equal(assess({close:empty},turns).sections.close.state,'not_applicable');
 assert.equal(assess({close:{...empty,assessment:{...empty.assessment,state:'expected_but_missed'}}},turns).sections.close.state,'unmeasured');
});

test('unreviewed stage candidates cannot become saved score columns',()=>{
 assert.throws(()=>S.toColumns(assess({discovery:measured},turns),String,turns,'material'),/review/i);
});

test('structured stage arrays use stage identity and reject duplicate entries',()=>{
 const row={...measured,section:'discovery',assessment:{state:'evaluated',reason:'The decision maker was checked.',evidence_turns:[1,2]}};
 assert.equal(S.assess({context,sections:[row]},turns).sections.discovery.score,78);
 assert.equal(S.assess({context,sections:[row,row]},turns).sections.discovery.state,'unmeasured');
});

test('saved stage summaries stay small and cannot treat an unchecked candidate as reviewed',()=>{
 const r=assess({discovery:measured},turns);
 assert.equal(S.read({stage_eligibility:r,discovery_score:78},'discovery').state,'unmeasured');
 const R=require('../lib/stage-eligibility-review');
 const checked=R.apply(r,{reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'Supported.',counterevidence_turns:[],unsupported_claims:[]}))},turns,'material');
 const saved=S.toColumns(simulatedFacts(checked),String,turns,'material');
 assert.ok(JSON.stringify(saved.stage_eligibility.summary).length<1000);
 assert.equal(S.read({...saved,stage_eligibility:saved.stage_eligibility.summary},'discovery').score,78);
});

test('internal rejection reasons do not become customer-facing stage notes',()=>{
 const R=require('../lib/stage-eligibility-review');
 const checked=R.apply(assess({discovery:measured},turns),{reviews:[]},turns,'material');
 checked.sections.discovery.reason='Internal reviewer could not apply knowledge-base doctrine.';
 // Rebuild the valid proof with the rejection reason as reviewer data.
 const rejected=R.apply(assess({discovery:measured},turns),{reviews:[{stage:'discovery',verdict:'unknown',reason:checked.sections.discovery.reason}]},turns,'material');
 assert.equal(S.toColumns(simulatedFacts(rejected),String,turns,'material').discovery_notes,null);
});

test('a method review alone cannot bypass the independent factual check when saving',()=>{
 const R=require('../lib/stage-eligibility-review');
 const checked=R.apply(assess({discovery:measured},turns),{reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'Supported.',counterevidence_turns:[],unsupported_claims:[]}))},turns,'material');
 assert.throws(()=>S.toColumns(checked,String,turns,'material'),/review/i);
});

test('recorded discovery work cannot be labelled not applicable, and non-sales context cannot carry stage scores',()=>{
 const qualified={...context,discovery:{areas:[{area:'decision_makers',evidence_turns:[1,2]}]}};
 const missing={...measured,assessment:{state:'not_applicable',reason:'appropriate_continuation',evidence_turns:[1,2]}};
 assert.equal(assess({context:qualified,discovery:missing},turns).sections.discovery.state,'unmeasured');
 assert.equal(assess({context:{...context,sales_conversation:false},intro:measured},turns).sections.intro.state,'unmeasured');
});

test('an explicitly unobserved discovery area is rejected instead of being silently normalized',()=>{
  const c={...context,discovery:{areas:[{area:'decision_makers',evidence_turns:[1,2]},{area:'financial_resources',evidence_turns:[]}]}};
  const result=assess({context:c,discovery:measured,intro:measured},turns);
 assert.equal(result.sections.discovery.state,'unmeasured');
 assert.equal(result.sections.intro.state,'unmeasured');
});

test('scored notes require explicit factual actor clauses before review',()=>{
 const factual={...measured,notes:'CLOSER: asked who else would decide; PROSPECT: said their partner would join tomorrow.'};
 assert.equal(assess({discovery:factual},turns).sections.discovery.score,78);
 const vague={...factual,notes:'The closer asked who else would decide and correctly learned the partner would join.'};
 assert.equal(assess({discovery:vague},turns).sections.discovery.state,'unmeasured');
});

test('scored notes are one short factual sentence, not a disguised narrative',()=>{
 const narrative={...measured,notes:'CLOSER: asked who would decide. PROSPECT: said their partner would join tomorrow.'};
 assert.equal(assess({discovery:narrative},turns).sections.discovery.state,'unmeasured');
 const long={...measured,notes:'CLOSER: asked who would decide with several extra words that make this otherwise factual actor statement much longer than the allowed thirty five words for one stage note and add a needless description of the call conversation.'};
 assert.equal(assess({discovery:long},turns).sections.discovery.state,'unmeasured');
});

test('false context flags cannot carry stage evidence',()=>{
 const contradictoryPrice={...context,price:{occurred:false,evidence_turns:[1]}};
 assert.equal(assess({context:contradictoryPrice,intro:measured},turns).sections.intro.state,'unmeasured');
 const contradictoryPrior={...context,prior_presentation:{established:false,evidence_turns:[1]}};
 assert.equal(assess({context:contradictoryPrior,intro:measured},turns).sections.intro.state,'unmeasured');
});

test('scheduling-only evidence cannot create a Discovery area',()=>{
 const scheduling=[
  {speaker:'CLOSER',start_seconds:1,text:'Are you at work right now?'},
  {speaker:'PROSPECT',start_seconds:2,text:'Yes, I can only meet on weekends.'},
  {speaker:'CLOSER',start_seconds:3,text:'Let us reschedule for Saturday.'},
 ];
 const schedulingContext={...context,discovery:{areas:[{area:'current_situation',evidence_turns:[1,2,3]}]},ending:{state:'appropriate_continuation',evidence_turns:[2,3]}};
 const score={...measured,assessment:{...measured.assessment,evidence_turns:[1,2,3]},notes:'CLOSER: asked whether the prospect was at work; PROSPECT: said weekends were available.'};
 assert.equal(assess({context:schedulingContext,discovery:score},scheduling).sections.discovery.state,'unmeasured');
});
