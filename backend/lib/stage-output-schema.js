'use strict';
// Transport contract only. Evidence and business-rule checks remain mandatory.
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'};
const nullableBoolean={type:['boolean','null']};
const ids={type:'array',items:{type:'integer'}};
const nonemptyIds={type:'array',minItems:1,items:{type:'integer'}};
const choice=values=>({type:'string',enum:values});
const assessment=object({state:choice(['evaluated','not_applicable','expected_but_missed','unmeasured']),reason:choice(['observed_work','appropriate_continuation','early_financial_dq','late_financial_dq','not_reached','no_objection','recording_incomplete','not_sales','missing_work','insufficient_evidence']),evidence_turns:ids});
const stage=object({assessment,grade:{type:'string',description:'A, B, C, D or F for a measured stage; empty otherwise.'},score:{type:['number','null']},notes:{type:'string',description:'A scored note is one sentence of one or two factual clauses using only the grammar Closer asked...; Prospect said.... Empty otherwise.'}});
const context=object({discovery:object({areas:{type:'array',items:object({area:choice(['pain','goals','current_situation','decision_makers','why_now','financial_resources']),evidence_turns:nonemptyIds})}}),sales_conversation:nullableBoolean,ending:object({state:choice(['completed','appropriate_continuation','cut_off','unknown']),evidence_turns:ids}),pitch:object({occurred:nullableBoolean,evidence_turns:ids}),price:object({occurred:nullableBoolean,evidence_turns:ids}),prior_presentation:object({established:nullableBoolean,evidence_turns:ids}),finance:object({state:choice(['qualified','genuine_dq','unresolved','not_assessed']),evidence_turns:ids,feasible_financing_ruled_out:nullableBoolean})});
const proof=object({moment:{type:'integer'},status:choice(['supported','contradicted','unclear']),claims:{type:'array',items:object({text:string,actor:choice(['CLOSER','PROSPECT','CALL']),kind:choice(['statement','action','absence','inference']),evidence:{type:'array',items:object({turn:{type:'integer'},speaker:choice(['CLOSER','PROSPECT']),quote:string})}})},evidence:{type:'array',items:object({turn:{type:'integer'},speaker:choice(['CLOSER','PROSPECT']),quote:string})},counterevidence:{type:'array',items:object({turn:{type:'integer'},speaker:choice(['CLOSER','PROSPECT']),quote:string})},reason:string});
const producer=object({context,sections:object({intro:stage,discovery:stage,pitch:stage,objection:stage,close:stage})});
const reviewer=object({reviews:{type:'array',items:object({stage:choice(['intro','discovery','pitch','objection','close']),verdict:choice(['supported','contradicted','unknown']),facts_supported:{type:'boolean'},omissions:{type:'array',items:object({claim:string,due_now:nullableBoolean,evidence_turns:ids})},reason:string,counterevidence_turns:ids,unsupported_claims:{type:'array',items:string}})}});
module.exports={producer,reviewer,proof};
