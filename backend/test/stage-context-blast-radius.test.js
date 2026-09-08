'use strict';
// The evidence bound and the blast radius of a bad context field (Justin, 2026-09-07).
//  - A stage record keeps the 1–4 turn-id bound: a manager checks a score at a glance.
//  - A context fact carries no upper bound: nobody audits a context list, so a rule
//    built for score auditability must not withhold a score.
//  - The prompt states BOTH bounds and the validator enforces exactly the same
//    numbers — the two are read from one constant, so they cannot drift apart.
//  - A bad context field withholds only the stages that depend on it, never all
//    five. Only an unusable five-stage STRUCTURE fails closed to five unmeasured.
// Every fixture here sends more than four evidence ids somewhere, because the
// suite was green at bd744ea precisely because none ever did.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const S=require('../lib/stage-eligibility');
const W=require('../lib/analysis-worker');

const turns=Array.from({length:12},(_,i)=>({speaker:i%2?'PROSPECT':'CLOSER',start_seconds:10*(i+1),text:'Turn '+(i+1)+' of a real conversation about the program.'}));
const fullContext={
 sales_conversation:true,
 call_kind:'initial',
 ending:{state:'completed',evidence_turn_ids:[11,12]},
 pitch:{occurred:true,evidence_turn_ids:[5]},
 price:{occurred:true,evidence_turn_ids:[6]},
 prior_presentation:{established:false,evidence_turn_ids:[]},
 objection:{occurred:true,evidence_turn_ids:[7]},
 finance:{state:'not_assessed',discovered_stage:null,feasible_financing_ruled_out:null,evidence_turn_ids:[]},
 close_due:true,
};
const stage=(stage,state,score,grade,evidence_turn_ids,reason='Observed source work.')=>({stage,state,score,grade,evidence_turn_ids,reason});
function payload(context=fullContext, changes={}) {
 const stages=[
  stage('intro','evaluated',92,'A',[1]),
  stage('discovery','evaluated',88,'B',[2,3,4]),
  stage('pitch','evaluated',95,'A',[5,6]),
  stage('objection_handling','evaluated',81,'B',[7,8]),
  stage('close','evaluated',99,'A+',[9,10]),
 ].map(row=>changes[row.stage]?{...row,...changes[row.stage]}:row);
 return {stage_assessment:{context,stages}};
}
const assess=(input)=>S.assessProduction(input,turns);
const states=(r)=>Object.fromEntries(S.SECTIONS.map(k=>[k,r.sections[k].state+(r.sections[k].score===null?'':':'+r.sections[k].score)]));

test('a context fact may cite more than four turns; every stage still scores',()=>{
 const context={...fullContext,ending:{state:'completed',evidence_turn_ids:[1,2,3,4,5,6,7,8,9,10,11,12]},objection:{occurred:true,evidence_turn_ids:[7,8,9,10,11,12]}};
 const r=assess(payload(context));
 assert.equal(r.status,undefined,'the record is not withheld');
 assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'evaluated:88',pitch:'evaluated:95',objection:'evaluated:81',close:'evaluated:99'});
 assert.equal(r.context.ending.evidence_turn_ids.length,12,'the context list is stored as sent');
});

test('a stage record keeps the 1–4 bound: an over-long stage list withholds that stage only',()=>{
 const r=assess(payload(fullContext,{discovery:{evidence_turn_ids:[2,3,4,5,6,7,8,9]}}));
 assert.equal(r.sections.discovery.state,'unmeasured');
 assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'unmeasured',pitch:'evaluated:95',objection:'evaluated:81',close:'evaluated:99'});
 const four=assess(payload(fullContext,{discovery:{evidence_turn_ids:[2,3,4,5]}}));
 assert.equal(four.sections.discovery.score,88,'exactly the bound still scores');
});

test('a bad context field withholds only the stages that depend on it',()=>{
 // close_due feeds Close alone.
 let r=assess(payload({...fullContext,close_due:'yes'}));
 assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'evaluated:88',pitch:'evaluated:95',objection:'evaluated:81',close:'unmeasured'});
 assert.deepEqual(r.context_invalid_fields,['close_due']);
 assert.equal(r.context.close_due,null,'the bad field is stored as null, the rest as sent');
 assert.equal(r.context.pitch.occurred,true);
 // pitch, price, prior_presentation and objection feed Objection Handling alone.
 for(const field of ['pitch','price','prior_presentation','objection']){
  r=assess(payload({...fullContext,[field]:{occurred:'maybe',established:'maybe',evidence_turn_ids:[999]}}));
  assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'evaluated:88',pitch:'evaluated:95',objection:'unmeasured',close:'evaluated:99'},field);
  assert.deepEqual(r.context_invalid_fields,[field]);
 }
 // finance feeds the early-DQ rule on Pitch, Objection Handling and Close; Intro and Discovery survive.
 r=assess(payload({...fullContext,finance:{state:'genuine_dq',discovered_stage:null,feasible_financing_ruled_out:null,evidence_turn_ids:[]}}));
 assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'evaluated:88',pitch:'unmeasured',objection:'unmeasured',close:'unmeasured'});
 // ending feeds the cut-off rule, which only bites an expected_but_missed stage.
 r=assess(payload({...fullContext,ending:{state:'ended',evidence_turn_ids:[]}},{close:{state:'expected_but_missed',score:40,grade:'F'}}));
 assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'evaluated:88',pitch:'evaluated:95',objection:'evaluated:81',close:'unmeasured'});
 // sales_conversation feeds every scored stage; an unscored stage survives.
 r=assess(payload({...fullContext,sales_conversation:'yes'},{objection_handling:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]}}));
 assert.deepEqual(states(r),{intro:'unmeasured',discovery:'unmeasured',pitch:'unmeasured',objection:'not_applicable',close:'unmeasured'});
 // call_kind feeds nothing: recorded as unknown, nothing withheld.
 r=assess(payload({...fullContext,call_kind:'discovery'}));
 assert.deepEqual(states(r),{intro:'evaluated:92',discovery:'evaluated:88',pitch:'evaluated:95',objection:'evaluated:81',close:'evaluated:99'});
 assert.deepEqual(r.context_invalid_fields,['call_kind']);
});

test('an unusable five-stage structure still fails closed to five unmeasured, and a missing context is structural',()=>{
 const missingContext=payload();delete missingContext.stage_assessment.context;
 for(const broken of [missingContext,{stage_assessment:{context:fullContext,stages:payload().stage_assessment.stages.slice(0,4)}},{stage_assessment:{context:fullContext,stages:[...payload().stage_assessment.stages.slice(0,4),payload().stage_assessment.stages[0]]}},{stage_assessment:{context:'x',stages:payload().stage_assessment.stages}},{}]){
  const r=assess(broken);
  assert.equal(r.status,'withheld');
  for(const name of S.SECTIONS) assert.equal(r.sections[name].state,'unmeasured');
  const fields=S.toProductionColumns(r,String,turns);
  assert.deepEqual(S.stageMetric({...fields,discovery_score:100},'discovery'),{state:'unmeasured',contributes:false,score:null,grade:null});
 }
});

test('the prompt states both bounds from the same constant the validator enforces',()=>{
 assert.equal(S.MAX_PRODUCTION_EVIDENCE,4);
 assert.equal(S.CONTEXT_EVIDENCE_MAX,null);
 assert.match(S.EVIDENCE_PROMPT_RULE,new RegExp('1-'+S.MAX_PRODUCTION_EVIDENCE+' '));
 assert.match(S.EVIDENCE_PROMPT_RULE,/no upper bound/);
 const prompt=W._buildSectionGraderPrompt({turns,closer_name:'Rep',speaker_confidence:'matched'},120,'Team offer',null,{});
 assert.ok(prompt.includes(S.EVIDENCE_PROMPT_RULE),'the grader prompt carries the shared rule verbatim');
 assert.doesNotMatch(prompt.replace(S.EVIDENCE_PROMPT_RULE,''),/1-4 strong transcript turn identifiers/,'no second statement of the bound survives in the prompt');
});

test('replay: the saved reply for the early financial DQ call now measures what the grader graded',()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','stage-reply-3a99156c.json'),'utf8'));
 // The transcript text is not offline; the validator reads only that a cited turn
 // exists, has text and a time. Placeholders carry the ids at the real length.
 const source=Array.from({length:fixture.source_turns},(_,i)=>({speaker:i%2?'PROSPECT':'CLOSER',start_seconds:i+1,text:'turn '+(i+1)}));
 const r=S.assessProduction({stage_assessment:fixture.stage_assessment},source);
 assert.equal(fixture.old_validator.status,'withheld','at bd744ea the six-id finance list withheld all five');
 // The finance list of six ids is now accepted, so the record is measured:
 // Intro 72 C and the three not_applicable stages read exactly as the grader wrote them.
 // Discovery cited EIGHT turns. Under the ruling the stage bound stays 1–4, so
 // Discovery is withheld by the bound the grader was never told (v56) — the
 // v57 prompt states it. Justin's expectation for this replay was Discovery 80 B;
 // the code does not produce it and this test records the ruled behaviour, not
 // the expectation. Reported, not tuned.
 assert.deepEqual(states(r),{intro:'evaluated:72',discovery:'unmeasured',pitch:'not_applicable',objection:'not_applicable',close:'not_applicable'});
 assert.equal(r.sections.intro.grade,'C');
 assert.equal(fixture.stage_assessment.stages.find(s=>s.stage==='discovery').evidence_turn_ids.length,8);
 assert.match(r.sections.discovery.reason,/evidence or state is invalid/);
 assert.equal(r.context.finance.evidence_turn_ids.length,6);
 assert.equal(r.context_invalid_fields,undefined);
});
