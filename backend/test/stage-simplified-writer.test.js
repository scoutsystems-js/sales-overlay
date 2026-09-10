'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../lib/stage-eligibility');
const W=require('../lib/analysis-worker');

const turns=[
 {speaker:'CLOSER',start_seconds:10,text:'Let us agree on what we will cover today.'},
 {speaker:'PROSPECT',start_seconds:20,text:'I want to grow the business from ten to twenty clients.'},
 {speaker:'CLOSER',start_seconds:30,text:'What is keeping the business at ten clients today?'},
 {speaker:'PROSPECT',start_seconds:40,text:'I do not have a repeatable way to find clients.'},
 {speaker:'CLOSER',start_seconds:50,text:'Our program builds that repeatable client system around your goal.'},
 {speaker:'CLOSER',start_seconds:60,text:'The investment is ninety eight hundred dollars.'},
 {speaker:'PROSPECT',start_seconds:70,text:'That works. I want to move forward today.'},
 {speaker:'CLOSER',start_seconds:80,text:'I have processed the first forty nine hundred dollars.'},
];
const fullContext={
 sales_conversation:true,
 call_kind:'initial',
 ending:{state:'completed',evidence_turn_ids:[7,8]},
 pitch:{occurred:true,evidence_turn_ids:[5]},
 price:{occurred:true,evidence_turn_ids:[6]},
 prior_presentation:{established:false,evidence_turn_ids:[]},
 objection:{occurred:false,evidence_turn_ids:[]},
 finance:{state:'not_assessed',discovered_stage:null,feasible_financing_ruled_out:null,evidence_turn_ids:[]},
 close_due:true,
};
const stage=(stage,state,score,grade,evidence_turn_ids,reason='Observed source work.')=>({stage,state,score,grade,evidence_turn_ids,reason});
function payload(context=fullContext, changes={}) {
 const stages=[
  stage('intro','evaluated',92,'A',[1]),
  stage('discovery','evaluated',88,'B',[2,3,4]),
  stage('pitch','evaluated',95,'A',[5,6]),
  stage('objection_handling','not_applicable',null,null,[6,7],'No objection occurred.'),
  stage('close','evaluated',99,'A+',[7,8]),
 ].map(row=>changes[row.stage]?{...row,...changes[row.stage]}:row);
 return {stage_assessment:{context,stages}};
}
function assess(input){return S.assessProduction(input,turns);}

test('canonical score-to-grade mapping uses Justin’s exact boundaries',()=>{
 assert.deepEqual([98,97,90,89,80,79,70,69,60,59,0].map(S.canonicalGrade),['A+','A','A','B','B','C','C','D','D','F','F']);
 assert.equal(S.canonicalGrade(99),'A+');
 assert.equal(S.canonicalGrade(94),'A');
 assert.equal(S.canonicalGrade(89),'B');
 assert.equal(S.canonicalGrade(69),'D');
 assert.equal(S.canonicalGrade(59),'F');
});

test('normal completed sale saves one source-backed five-stage result and excludes no objection',()=>{
 const result=assess(payload());
 assert.equal(result.sections.discovery.state,'evaluated');
 assert.equal(result.sections.pitch.score,95);
 assert.equal(result.sections.close.grade,'A+');
 assert.equal(result.sections.objection.state,'not_applicable');
 const fields=S.toProductionColumns(result,String,turns,'normal-grader-v1');
 assert.deepEqual(S.stageMetric(fields,'pitch'),{state:'evaluated',contributes:true,score:95,grade:'A'});
 assert.deepEqual(S.stageMetric(fields,'objection'),{state:'not_applicable',contributes:false,score:null,grade:null});
 assert.match(fields.close_notes,/I want to move forward today/);
});

test('a bad or missing optional explanation hides only the explanation, not a supported score',()=>{
 const result=assess(payload(fullContext,{pitch:{reason:'Closer correctly established the only solution the prospect needed.'},close:{reason:null}}));
 assert.equal(result.sections.pitch.score,95);
 assert.equal(result.sections.pitch.notes,null);
 assert.equal(result.sections.close.score,99);
 assert.equal(result.sections.close.notes,null);
});

test('bad source references withhold only the affected stage while valid sibling scores survive',()=>{
 const result=assess(payload(fullContext,{pitch:{evidence_turn_ids:[999]}}));
 assert.equal(result.sections.pitch.state,'unmeasured');
 assert.equal(result.sections.discovery.score,88);
 assert.equal(result.sections.close.score,99);
});

test('a bad score-grade pair is withheld and valid canonical pairs survive',()=>{
 assert.equal(assess(payload(fullContext,{intro:{score:99,grade:'A'}})).sections.intro.state,'unmeasured');
 assert.equal(assess(payload(fullContext,{intro:{score:94,grade:'A+'}})).sections.intro.state,'unmeasured');
 for(const [score,grade] of [[89,'B'],[69,'D'],[59,'F']]){
  assert.equal(assess(payload(fullContext,{intro:{score,grade}})).sections.intro.score,score);
 }
});

test('a correct early financial DQ grades Discovery and excludes later stages without penalties',()=>{
 const context={...fullContext,ending:{state:'completed',evidence_turn_ids:[4]},pitch:{occurred:false,evidence_turn_ids:[]},price:{occurred:false,evidence_turn_ids:[]},close_due:false,finance:{state:'genuine_dq',discovered_stage:'discovery',feasible_financing_ruled_out:true,evidence_turn_ids:[3,4]}};
 const result=assess(payload(context,{pitch:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[3,4]},objection_handling:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},close:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[3,4]}}));
 assert.equal(result.sections.discovery.state,'evaluated');
 for(const name of ['pitch','objection','close']) assert.deepEqual(S.stageMetric(S.toProductionColumns(result,String,turns,'normal-grader-v1'),name),{state:'not_applicable',contributes:false,score:null,grade:null});
});

test('a late financial DQ can retain an evidence-backed Discovery expected miss',()=>{
 const context={...fullContext,finance:{state:'genuine_dq',discovered_stage:'late',feasible_financing_ruled_out:true,evidence_turn_ids:[6,7]}};
 const result=assess(payload(context,{discovery:{state:'expected_but_missed',score:55,grade:'F',evidence_turn_ids:[3,6,7]},close:{score:72,grade:'C'}}));
 assert.equal(result.sections.discovery.state,'expected_but_missed');
 assert.equal(result.sections.discovery.score,55);
 /* H768 (Justin, 2026-09-10) REVERSES the Block 4 reading that a late DQ leaves the close scored: a genuine financial DQ is
    one miss, coached once — Objection and Close are not applicable whenever the DQ is discovered. Was: close.score 72. */
 assert.equal(result.sections.close.state,'not_applicable');
 assert.equal(result.sections.close.score,null);
});

test('no pitch or price cannot create objection or purchase-close penalties',()=>{
 const context={...fullContext,pitch:{occurred:false,evidence_turn_ids:[]},price:{occurred:false,evidence_turn_ids:[]},close_due:false,ending:{state:'appropriate_continuation',evidence_turn_ids:[4]}};
 const result=assess(payload(context,{pitch:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},objection_handling:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},close:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[4]}}));
 assert.equal(result.sections.objection.state,'not_applicable');
 assert.equal(result.sections.close.state,'not_applicable');
});

test('appropriate continuation and cutoff do not manufacture Close misses',()=>{
 const continuation={...fullContext,ending:{state:'appropriate_continuation',evidence_turn_ids:[2]},pitch:{occurred:false,evidence_turn_ids:[]},price:{occurred:false,evidence_turn_ids:[]},close_due:false};
 assert.equal(assess(payload(continuation,{pitch:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},objection_handling:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},close:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[2]}})).sections.close.state,'not_applicable');
 const cutoff={...fullContext,ending:{state:'cut_off',evidence_turn_ids:[4]},pitch:{occurred:null,evidence_turn_ids:[]},price:{occurred:null,evidence_turn_ids:[]},close_due:null};
 assert.equal(assess(payload(cutoff,{pitch:{state:'unmeasured',score:null,grade:null,evidence_turn_ids:[]},objection_handling:{state:'unmeasured',score:null,grade:null,evidence_turn_ids:[]},close:{state:'expected_but_missed',score:40,grade:'F',evidence_turn_ids:[4]}})).sections.close.state,'unmeasured');
});

test('a follow-up grades only work due on that follow-up',()=>{
 const followup={...fullContext,call_kind:'follow_up',pitch:{occurred:false,evidence_turn_ids:[]},price:{occurred:false,evidence_turn_ids:[]},close_due:true};
 const result=assess(payload(followup,{intro:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},discovery:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},pitch:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},objection_handling:{state:'not_applicable',score:null,grade:null,evidence_turn_ids:[]},close:{score:99,grade:'A+',evidence_turn_ids:[7,8]}}));
 assert.equal(result.sections.close.score,99);
 assert.equal(result.sections.discovery.state,'not_applicable');
});

test('a broken five-stage payload fails closed and never admits legacy raw scores',()=>{
 const broken=payload();broken.stage_assessment.stages.pop();
 const result=assess(broken);
 for(const name of S.SECTIONS) assert.equal(result.sections[name].state,'unmeasured');
 const fields=S.toProductionColumns(result,String,turns,'normal-grader-v1');
 assert.deepEqual(S.stageMetric({...fields,discovery_score:100},'discovery'),{state:'unmeasured',contributes:false,score:null,grade:null});
});

test('normal worker uses the parsed normal-grader record without a candidate or reviewer request',()=>{
 const fields=W._stageColumnsFromGrader(payload(),turns);
 assert.equal(fields.stage_eligibility.summary.verification,'normal_grader');
 assert.equal(fields.discovery_score,88);
 assert.equal(fields.close_score_earned,99);
});

test('normal worker production path does not invoke the offline candidate or reviewer lane',()=>{
 const fs=require('node:fs');
 const source=fs.readFileSync(require.resolve('../lib/analysis-worker'),'utf8');
 const stageBlock=source.slice(source.indexOf('var stageColumns = stageColumnsFromGrader'),source.indexOf('var analysisPayload ='));
 assert.match(stageBlock,/stageColumnsFromGrader/);
 assert.doesNotMatch(stageBlock,/offlineStageColumnsForQa|stageAssessment\.runProduction|createWithUsage/);
});
