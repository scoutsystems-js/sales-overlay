'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),P=require('../lib/call-period-review'),F=require('../lib/period-observation-facts');
const context=P.prepare({outcome:'open',transcript_stored:[{speaker:'PROSPECT',text:'I want to retire.',start_seconds:1},{speaker:'CLOSER',text:'What kept you from taking the next step?',start_seconds:2},{speaker:'PROSPECT',text:'I was already in another program.',start_seconds:3}]});
const findings=[{moment:1,observation:'The closer did not ask what had stopped the prospect from acting.',recommendation:'Explore the reason for waiting.'}];
function response(){return{observations:[{moment:1,sentences:[{sentence:1,claims:[{text:'The prospect wants to retire.',actor:'PROSPECT',kind:'statement',evidence:[{turn:1,speaker:'PROSPECT',quote:'I want to retire.'}]}],status:'supported',evidence:[{turn:1,speaker:'PROSPECT',quote:'I want to retire.'}],counterevidence:[],reason:'Evidence located.'}]}]};}
test('a recorded contradiction blocks advice even after earlier coaching reviewers approved',()=>{const r=response();r.observations[0].sentences[0]={sentence:1,status:'contradicted',evidence:[],counterevidence:[{turn:2,speaker:'CLOSER',quote:'What kept you from taking the next step?'}],reason:'The closer asked this and received an answer.'};assert.equal(F.evaluate(findings,r,context)[0].approved,false);});
test('unclear claims, missing sentences and wrong speaker quotations cannot approve',()=>{for(const mutate of [r=>r.observations[0].sentences[0].status='unclear',r=>r.observations[0].sentences=[],r=>r.observations[0].sentences[0].evidence[0].speaker='CLOSER',r=>r.observations[0].sentences[0].evidence[0].quote='Something never said.']){const r=response();mutate(r);assert.equal(F.evaluate(findings,r,context)[0].approved,false);}});
test('a located supported observation survives the separate fact check',()=>{const f=[{moment:1,observation:'The prospect said they wanted to retire.'}];assert.equal(F.evaluate(f,response(),context)[0].approved,true);});
test('the fact-only reader never receives coaching guidance, recommendations or earlier verdicts',()=>{const text=F.prompt(findings,context);assert.doesNotMatch(text,/Explore the reason for waiting\./);assert.match(text,/FACTS ONLY/);assert.match(text,/same meaning/i);assert.match(text,/What kept you from taking the next step/);});

test('a claim about the prospect cannot use the closer’s words as their statement',()=>{
 const r=response();r.observations[0].sentences[0].claims=[{text:'The prospect wants to retire.',actor:'PROSPECT',kind:'statement',evidence:[{turn:2,speaker:'CLOSER',quote:'What kept you from taking the next step?'}]}];
 assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire.'}],r,context)[0].approved,false);
});
test('factual approval is bound to the exact advice and current call',()=>{
 const record=F.applyPair({findings:[{moment:1,observation:'The prospect wants to retire.',recommendation:'Clarify the desired result.'}]},[response(),response()],context);
 assert.equal(F.isVerified(record,context),true);
 assert.equal(F.isVerified({...record,findings:[{...record.findings[0],observation:'The prospect refused to retire.'}]},context),false);
 assert.equal(F.isVerified(record,{...context,hash:'changed'}),false);
});
test('an exact uniquely located quotation can recover its index without changing its speaker or words',()=>{
 const r=response();r.observations[0].sentences[0].evidence[0].turn=2;r.observations[0].sentences[0].claims[0].evidence[0].turn=2;
 assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire.'}],r,context)[0].approved,true);
 r.observations[0].sentences[0].claims[0].evidence[0].speaker='CLOSER';assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire.'}],r,context)[0].approved,false);
});
test('a supported plain-language restatement is not rejected merely for an inference label',()=>{
 const r=response();r.observations[0].sentences[0].claims[0].kind='inference';
 assert.equal(F.evaluate([{moment:1,observation:'Retiring is a stated goal for the prospect.'}],r,context)[0].approved,true);
 r.observations[0].sentences[0].status='unclear';assert.equal(F.evaluate([{moment:1,observation:'Retiring would make them happy.'}],r,context)[0].approved,false);
});
test('absence can use the sentence’s located exchange while positive actor claims still need their own source',()=>{
 const r=response();r.observations[0].sentences[0].claims.push({text:'No specific plan was agreed.',actor:'CALL',kind:'absence',evidence:[]});
 assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire, but no specific plan was agreed.'}],r,context)[0].approved,true);
 r.observations[0].sentences[0].claims[0].evidence=[];assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire.'}],r,context)[0].approved,false);
});
test('fact checks must agree; one rejection cannot be replaced by a later approval',()=>{
 const record={findings:[{moment:1,observation:'The prospect wants to retire.'}]},no=response();no.observations[0].sentences[0].status='contradicted';
 assert.equal(F.applyPair(record,[response(),no],context).findings.length,0);
 assert.equal(F.applyPair(record,[response(),response()],context).findings.length,1);
});
test('unlocatable extra citations are discarded only when every claim still has real speaker-matched evidence',()=>{
 const r=response();r.observations[0].sentences[0].claims[0].evidence.push({turn:2,speaker:'PROSPECT',quote:'Invented extra citation.'});r.observations[0].sentences[0].evidence.push({turn:2,speaker:'PROSPECT',quote:'Invented extra citation.'});
 assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire.'}],r,context)[0].approved,true);
 r.observations[0].sentences[0].claims[0].evidence.shift();assert.equal(F.evaluate([{moment:1,observation:'The prospect wants to retire.'}],r,context)[0].approved,false);
});
test('missing or incomplete second judgments are not agreement',()=>{
 const record={findings:[{moment:1,observation:'The prospect wants to retire.'}]};
 assert.equal(F.applyPair(record,[response(),{observations:[]}],context).findings.length,0);
 const incomplete=response();delete incomplete.observations[0].sentences[0].status;assert.equal(F.applyPair(record,[response(),incomplete],context).findings.length,0);
});
test('database JSON key ordering does not invalidate unchanged approved findings',()=>{
 const record=F.applyPair({findings:[{moment:1,observation:'The prospect wants to retire.',recommendation:'Clarify the desired result.',turn_ids:[1,2]}]},[response(),response()],context);
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().reverse().map(k=>[k,reorder(value[k])])):value;
 const stored=reorder(record);assert.equal(F.isVerified(stored,context),true);
 stored.findings[0].recommendation='Invent a different goal.';assert.equal(F.isVerified(stored,context),false);
});
