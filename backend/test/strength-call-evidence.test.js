'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {buildEvidence,attachStrengthEvidence}=require('../lib/strength-call-evidence');
const item={quote:'Is there anything else holding you back?',spoke:'closer',call_id:'a'};
const analysis={outcome:'closed',transcript_stored:{turns:[{speaker:'CLOSER',text:item.quote,start_seconds:10},{speaker:'PROSPECT',text:'Only whether I can arrange the payments.',start_seconds:14}]}};
test('binds full transcript and actual call outcome without inferring a resolution',()=>{const e=buildEvidence(item,analysis,'https://example.com');assert.equal(e.outcome,'closed');assert.equal(e.response.quote,analysis.transcript_stored.turns[1].text);assert.equal(e.moment.timestamp_seconds,10);assert.equal(buildEvidence(item,{...analysis,outcome:null},null).outcome,null);});
test('refuses absent, ambiguous, wrong-speaker or unpaired evidence',()=>{assert.equal(buildEvidence({...item,quote:'Invented unsupported quotation here'},analysis),null);assert.equal(buildEvidence({...item,spoke:'prospect'},analysis),null);assert.equal(buildEvidence(item,{...analysis,transcript_stored:{turns:[analysis.transcript_stored.turns[0]]}}),null);assert.equal(buildEvidence(item,{...analysis,transcript_stored:{turns:[...analysis.transcript_stored.turns,...analysis.transcript_stored.turns]}}),null);});
test('cached strengths outside the authorized window never trigger a transcript read',async()=>{const result=await attachStrengthEvidence({from(){throw Error('unauthorized read');}},{working:[item]}, {meta:{}});assert.deepEqual(result.working,[]);});

test('withholds an outcome explanation that explicitly contradicts the recorded result',()=>{assert.equal(buildEvidence(item,{...analysis,why_outcome:'The primary blocker keeping the deal from closing was a partner discussion.'}),null);assert.equal(buildEvidence(item,{...analysis,outcome:'lost',why_outcome:'The deal closed after financing.'}),null);});
