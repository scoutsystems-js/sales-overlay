'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../lib/call-period-review'),E=require('../lib/coaching-evidence-review'),S=require('../lib/period-stage-facts');
function finish(rows,response,context,material){const read={decisions:[{state:'undecided',evidence:[{turn:4,quote:context.turns[3].text},{turn:5,quote:context.turns[4].text}]}]};return P.finish(rows,response,context,material,S.finish(context,read,read));}
const analysis={outcome:'follow_up',transcript_stored:[{speaker:'PROSPECT',text:'I want to have evenings with my children.',start_seconds:1},{speaker:'CLOSER',text:'What would that change for you?',start_seconds:2},{speaker:'PROSPECT',text:'I could stop missing their games.',start_seconds:3},{speaker:'CLOSER',text:'Think about the offer and call me.',start_seconds:2000},{speaker:'PROSPECT',text:'I need to decide whether to join.',start_seconds:2001}]};
const material={kbHash:'kb',contextText:'Bring the prospect’s stated goals back into the decision at the close.'};
test('period coaching can name tying back in without changing the closed buying-signal vocabulary',()=>{const f={section:'close',move:'tying back in',observation:'The prospect described missing family time. The closer ended with an invitation to think about the offer.',recommendation:'Connect the stated goal to the decision before ending.',turn_ids:[1,2,3,4],knowledge_refs:[E.knowledgeSources(material)[0].id]};assert.equal(P.candidates({findings:[f]},P.prepare(analysis),material).length,1);assert.equal(require('../lib/arc-cause').ALL_MOVES.includes('tying back in'),false);});
test('broader coaching prompt explicitly checks depth, pitch fit and later use without making every objection proof of a discovery miss',()=>{const p=P.writerPrompt(P.prepare(analysis),material,analysis.outcome);assert.match(p,/discovery depth/i);assert.match(p,/pitch fit/i);assert.match(p,/objection alone does not prove/i);assert.match(p,/later use/i);});

test("review explicitly refuses a pitch transition treated as the close",()=>{assert.match(P.reviewPrompt([],P.prepare(analysis),material,analysis.outcome),/does not establish the close/);});

function reviewFixture(){
 const context=P.prepare(analysis),f={section:'close',move:'tying back in',observation:'The closer ended with an invitation to think about the offer.',recommendation:'Connect the stated goal to the decision before ending.',turn_ids:[1,2,3,4],knowledge_refs:[E.knowledgeSources(material)[0].id]};
 const findings=P.candidates({findings:[f]},context,material);
 const review={reviews:[{moment:1,skill_check:{section:'close',move:'tying back in',status:'supported',evidence_turns:[1,3,4],reason:'A disclosure was unused at the decision.'},verdict:'approve',reason_code:'supported',reason:'The later decision left the stated goal unused.',knowledge_refs:f.knowledge_refs,knowledge_checks:[{id:f.knowledge_refs[0],quote:material.contextText,reason:'The team calls for using the stated goal at the decision.'}],evidence_turns:[1,2,3,4],history_refs:[],opportunity:{status:'evidenced',cue_turns:[1,3],response_turns:[4],continuation_turns:[4],reason:'The decision is recorded.'},sentence_checks:E.adviceSentences(findings[0].coaching).map((_,i)=>({sentence:i+1,status:'supported',support_turns:[1,3,4],countercheck:{turns:[2],effect:'does_not_undermine',reason:'The earlier question explores the goal; it does not use it at the later decision.'},reason:'Both the factual claim and the applicable principle are supported.'}))}]};return{context,findings,review};
}
test('period review distinguishes examined dialogue from actual contradiction without discarding either',()=>{const {context,findings,review}=reviewFixture();assert.equal(finish(findings,review,context,material).findings.length,1);for(const effect of ['undermines','uncertain']){const r=structuredClone(review);r.reviews[0].sentence_checks[0].countercheck.effect=effect;assert.equal(finish(findings,r,context,material).findings.length,0);}});
test('period review refuses generic advice without an evidenced opportunity and refuses invented references',()=>{const {context,findings,review}=reviewFixture();for(const mutate of [r=>delete r.opportunity,r=>r.opportunity.status='uncertain',r=>r.opportunity.cue_turns=[999],r=>r.sentence_checks[0].support_turns=[],r=>r.sentence_checks[0].countercheck.turns=[999],r=>r.sentence_checks[0].counterevidence_turns=[2]]){const r=structuredClone(review);mutate(r.reviews[0]);assert.equal(finish(findings,r,context,material).findings.length,0);}});
test('an evidenced exchange split into many short turns reaches review instead of being silently discarded',()=>{
 const a={outcome:'lost',transcript_stored:Array.from({length:16},(_,i)=>({speaker:i%2?'CLOSER':'PROSPECT',text:'Exact source fragment '+i+'.',start_seconds:i}))};const f={section:'discovery',move:'uncovering goals',observation:'The closer presented price after the prospect asked about fit.',recommendation:'Clarify the decision criteria before presenting a discount.',turn_ids:Array.from({length:16},(_,i)=>i+1),knowledge_refs:[E.knowledgeSources(material)[0].id]};
 assert.equal(P.candidates({findings:[f]},P.prepare(a),material).length,1);
 assert.equal(P.candidates({findings:[{...f,turn_ids:f.turn_ids.concat(999)}]},P.prepare(a),material).length,0);
});

test('a cited source cannot license a rule the reviewer invented',()=>{const {context,findings,review}=reviewFixture();review.reviews[0].knowledge_checks[0].quote='A general tomorrow promise is always a booked appointment.';assert.equal(finish(findings,review,context,material).findings.length,0);});

test('period audit separates observations from recommendations rather than requiring a missed action to have happened',()=>{const {context,findings}=reviewFixture();const prompt=P.reviewPrompt(findings,context,material,'lost');assert.match(prompt,/S1 OBSERVATION/);assert.match(prompt,/S2 RECOMMENDATION/);assert.match(prompt,/not a claim that the rep already performed it/);});
test('guidance quotations may omit Markdown emphasis while invented or changed words still fail',()=>{
 const m={...material,contextText:'Bring the prospect’s **stated goals** back into the decision at the close.'};const {context,findings,review}=reviewFixture();const id=E.knowledgeSources(m)[0].id;findings[0].knowledge_refs=[id];review.reviews[0].knowledge_refs=[id];review.reviews[0].knowledge_checks=[{id,quote:material.contextText,reason:'The same words without visual emphasis.'}];
 assert.equal(finish(findings,review,context,m).findings.length,1);
 review.reviews[0].knowledge_checks[0].quote=material.contextText.replace('stated goals','invented goals');assert.equal(finish(findings,review,context,m).findings.length,0);
});
test('manager route uses the complete material reader and passes both current guidance identities to the gather',()=>{
 const fs=require('node:fs'),{stripComments}=require('./helpers/strip-comments');const source=stripComments(fs.readFileSync(require.resolve('../routes/team'),'utf8'));const start=source.indexOf("router.get('/coachable-moments'");const route=source.slice(start,source.indexOf("router.",start+10));
 assert.match(route,/loadPeriodMaterial\(admin/);assert.match(route,/legacy:m\.legacyKbHash/);assert.match(route,/current:m\.kbHash/);
});
test('typographic apostrophes do not erase a genuine source quotation',()=>{
 const {context,findings,review}=reviewFixture();review.reviews[0].knowledge_checks[0].quote=material.contextText.replaceAll('’',"'");assert.equal(finish(findings,review,context,material).findings.length,1);
});
test('two drafts in one section are independently reviewed rather than both discarded',()=>{
 const {context,findings}=reviewFixture();const two=[findings[0],{...findings[0],move:'asking for the sale'}];assert.equal(P.candidates({findings:two},context,material).length,2);
});
test('many short source fragments do not disqualify an otherwise reviewable exchange',()=>{
 const {findings}=reviewFixture();const a={...analysis,transcript_stored:Array.from({length:40},(_,i)=>({speaker:i%2?'CLOSER':'PROSPECT',text:'Source fragment '+i+'.',start_seconds:i}))};const f={...findings[0],turn_ids:Array.from({length:40},(_,i)=>i+1)};assert.equal(P.candidates({findings:[f]},P.prepare(a),material).length,1);
});
test('manager corrections retain their authority ahead of base-script guidance',()=>{
 const m={...material,notes:{text:'Financing exceptions are allowed.'}};const prompt=P.writerPrompt(P.prepare(analysis),m,'lost');assert.ok(prompt.indexOf('MANAGER CORRECTION')<prompt.indexOf('TEAM SOURCE'));assert.match(prompt,/manager corrections.*precedence/i);
});
test('a second independent rejection cannot be overridden by a first approval',()=>{
 const {context,findings,review}=reviewFixture();const record=finish(findings,review,context,material);assert.equal(record.findings.length,1);const negative=structuredClone(review);negative.reviews[0].verdict='reject';negative.reviews[0].reason_code='transcript_contradiction';negative.reviews[0].reason='The closer already did this.';
 assert.equal(P.applyIndependentReview(record,findings,negative,context,material).findings.length,0);
 assert.equal(P.applyIndependentReview(record,findings,review,context,material).findings.length,1);
});
test('the independent review supplies the checked skill, and a missing or unsupported classification cannot publish',()=>{
 const {context,findings,review}=reviewFixture();const record=finish(findings,review,context,material);
 const missing=structuredClone(review);delete missing.reviews[0].skill_check;assert.equal(P.applyIndependentReview(record,findings,missing,context,material).findings.length,0);
 const checked=structuredClone(review);checked.reviews[0].skill_check={section:'close',move:'booking the follow-up',status:'supported',evidence_turns:[1,3,4],reason:'The proposed action is scheduling.'};
 const result=P.applyIndependentReview(record,findings,checked,context,material);assert.equal(result.findings[0].move,'booking the follow-up');assert.equal(P.applySchedulingFacts(result,analysis,null).findings.length,0);
});
