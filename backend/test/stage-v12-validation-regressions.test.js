'use strict';
// Sanitized regression shapes from the four saved v12 validation candidates.
// The real transcripts remain in the private evidence ledger, not this repo.
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/stage-eligibility'),R=require('../lib/stage-eligibility-review'),V=require('../lib/stage-observation-review');
const turns=[
 {speaker:'CLOSER',start_seconds:10,text:'Are we expecting anyone else to be on this meeting?'},
 {speaker:'PROSPECT',start_seconds:15,text:'My partner cannot join this meeting.'},
 {speaker:'CLOSER',start_seconds:20,text:'Let us reschedule with both decision makers.'},
];
const context={discovery:{areas:[{area:'decision_makers',evidence_turns:[1,2]}]},sales_conversation:true,ending:{state:'appropriate_continuation',evidence_turns:[2,3]},pitch:{occurred:false,evidence_turns:[]},price:{occurred:false,evidence_turns:[]},prior_presentation:{established:false,evidence_turns:[]},finance:{state:'not_assessed',feasible_financing_ruled_out:null,evidence_turns:[]}};
const measured=(section,note)=>({section,assessment:{state:'evaluated',reason:'observed_work',evidence_turns:[1,2]},grade:'B',score:75,notes:note});
const assess=(input,c=context)=>S.assess({context:c,sections:[input]},turns);

test('saved candidate 1 rejects rule judgments in an otherwise factual stage note',()=>{
 const result=assess(measured('intro','Closer confirmed the partner was absent and correctly paused the call.'));
 assert.equal(result.sections.intro.state,'unmeasured');
});

test('saved candidate 1 rejects an unprovable closer-learning claim even without a judgment word',()=>{
 const result=assess(measured('intro','Closer learned the partner was absent and booked a continuation.'));
 assert.equal(result.sections.intro.state,'unmeasured');
});

test('saved candidate 3 rejects an unsupported adequacy conclusion in a stage note',()=>{
 const result=assess(measured('intro','Closer confirmed the prospect was at work and lacked adequate time.'));
 assert.equal(result.sections.intro.state,'unmeasured');
});

test('saved candidate 4 rejects empty Discovery areas and false pitch context with evidence',()=>{
 const empty={...context,discovery:{areas:[...context.discovery.areas,{area:'financial_resources',evidence_turns:[]}]}};
 assert.equal(assess(measured('discovery','Closer identified a decision maker.'),empty).sections.discovery.state,'unmeasured');
 const contradictory={...context,pitch:{occurred:false,evidence_turns:[1]}};
 assert.equal(assess(measured('intro','Closer confirmed the meeting attendee.'),contradictory).sections.intro.state,'unmeasured');
});

test('saved candidate 2 rejects a factual proof that assigns prospect evidence to closer action',()=>{
 const original={version:S.VERSION,source_hash:S.sourceHash(turns),context:{},sections:Object.fromEntries(S.SECTIONS.map(stage=>[stage,{state:stage==='discovery'?'evaluated':'not_applicable',score:stage==='discovery'?75:null,grade:stage==='discovery'?'B':null,reason:'observed_work',notes:stage==='discovery'?'Prospect reported having a partner.':null,evidence:[]}]))};
 const review={reviews:S.SECTIONS.map(stage=>({stage,verdict:'supported',facts_supported:true,omissions:[],reason:'Supported.',counterevidence_turns:[],unsupported_claims:[]}))};
 const method=R.apply(original,review,turns,'material');
 const bad={observations:[{moment:2,sentences:[{sentence:1,status:'supported',claims:[{text:'Closer confirmed the prospect had a partner.',actor:'CLOSER',kind:'action',evidence:[{turn:2,speaker:'PROSPECT',quote:turns[1].text}]}],evidence:[{turn:2,speaker:'PROSPECT',quote:turns[1].text}],counterevidence:[],reason:'The source supports the claim.'}]}]};
 const result=V.applyPair(method,[bad,bad],turns,'material');
 assert.equal(result.sections.discovery.state,'unmeasured');
 assert.equal(result.factual_review.decisions[0].approved,false);
});

test('review prompt forbids recording a non-deduction as an omission',()=>{
 const prompt=R.prompt({context,intro:measured('intro','Closer set a brief direction.')},turns,{contextText:''});
 assert.match(prompt,/Do not report a factual absence or a non-deduction as an omission/i);
});
