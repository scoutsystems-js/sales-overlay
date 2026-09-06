'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/coaching');
const E = require('../lib/coaching-evidence-review');

// Prompt-contract regressions, not a model efficacy score. These exercise the
// assembled requests so stale instructions cannot survive in another branch.
test('every outcome branch permits unknown impact instead of requiring a cause or cost', () => {
  for (const outcome of ['closed', 'lost', 'follow_up', 'unknown', 'disqualified']) {
    for (const teamReasoning of ['', 'Check decision authority before the pitch.']) {
      const prompt = C.buildCoachingPrompt([], {outcome, dq:outcome === 'disqualified', teamReasoning});
      assert.doesNotMatch(prompt, /outcome AND its cause|STATE THE COST|may say it likely cost the deal|Say what to do and what it cost/);
      assert.match(prompt, /If the impact is unknown, leave it unknown/);
      assert.match(prompt, /observed continuation/i);
    }
  }
});

test('a missing verified reply is missing evidence, not evidence of silence', () => {
  const moment = C.toMoment({id:'h', quote:'I need to discuss this with my partner.', closer_response:'An unverified reply', closer_response_verified:false});
  const prompt = C.buildCoachingPrompt([moment], {});
  assert.doesNotMatch(prompt, /The closer did not reply to this\.|An unverified reply/);
  assert.match(prompt, /No verified reply is stored/);
});

test('the positive opening example obeys the timestamp and prospect-pronoun rules', () => {
  const prompt = C.buildCoachingPrompt([], {});
  const example = prompt.slice(prompt.indexOf('An example of that shape'), prompt.indexOf('DO NOT REPRODUCE THAT WORDING'));
  assert.ok(example.length > 30, 'exercise the actual example, not an empty slice');
  assert.doesNotMatch(example, /\b\d{1,2}:\d{2}\b|\b(?:he|she|him|her|his)\b|you never/i);
});

test('review instructions distinguish missed isolation, financial qualification and principles', () => {
  const prompt = E.buildReviewPrompt([], [], [], {contextText:'Team guidance'}, 'follow_up');
  assert.match(prompt, /missing isolation is not coaching against isolation/i);
  assert.match(prompt, /upstream financial qualification/i);
  assert.match(prompt, /principle is not a word track/i);
  assert.match(prompt, /quote the exact disputed claim/i);
});

test('supported principles can pass the existing evidence gate without accepting unverified history', () => {
  // Deliberately constructed approvals test the deterministic gate only.
  // They do not simulate an independent model reaching the right judgment.
  const material = {contextText:'Establish whether this is the only concern. Qualify financial fit before the pitch.'};
  const context = {fullCall:false, turns:[{speaker:'PROSPECT',text:'I need to discuss this with my partner.'},{speaker:'CLOSER',text:'All right, I will email you.'}]};
  const review = {reviews:[{moment:1,verdict:'approve',knowledge_refs:[E.knowledgeSources(material)[0].id],evidence_turns:[1,2]}]};
  for (const coaching of ['In this exchange, establish whether consulting their partner is the only remaining concern.', 'Clarify financial fit before continuing into the pitch.']) {
    assert.equal(E.approvedEntries([{moment:1,coaching}],review,[context],material).length,1);
  }
  for (const coaching of ['You never clarified financial fit throughout the call.', 'You have done this on three earlier calls.']) {
    assert.equal(E.approvedEntries([{moment:1,coaching}],review,[context],material).length,0);
  }
  assert.equal(E.approvedEntries([{moment:1,coaching:'Clarify the remaining concern.'}],{reviews:[{...review.reviews[0],knowledge_refs:['K-not-supplied']}]},[context],material).length,0);
});

test('v2 approved history retains its original provenance', () => {
  const previous = {version:'coaching-evidence-v2',verdict:'approved'};
  assert.equal(E.isApprovedReview(previous),true);
  assert.equal(previous.version,'coaching-evidence-v2');
});

const scopedMaterial = {contextText:'Agree a specific next conversation.'};
const excerpt = {fullCall:false,turns:[{speaker:'CLOSER',text:'Call me over the weekend.'}]};
function decide(coaching, context = excerpt, moment = 1) {
  return E.evaluateEntries([{moment,coaching}], {reviews:[{moment,verdict:'approve',evidence_turns:[1],knowledge_refs:[E.knowledgeSources(scopedMaterial)[0].id]}]}, Array.from({length:moment},()=>context), scopedMaterial)[0];
}

test('the saved Gabriel absence claims fail even with an approving reviewer and under the length limit', () => {
  for (const text of [
    'No price was presented and no confirmed next step was secured before the call ended.',
    'No objection was ever raised because price never dropped.',
    'The call ended before any close attempt.',
    'You did not ask about the decision maker.',
    'The prospect never said what needed to be resolved.',
    'At no point in the call was a price discussed.',
    'No price was presented. In this exchange, secure a callback.',
  ]) assert.equal(decide(text).verdict,'withheld',text);
});

test('scope checks preserve bounded observations, directional advice and full-call review eligibility', () => {
  for (const text of [
    'In this exchange, no confirmed time was set. Agree a specific callback.',
    'No confirmed time was set in the call ending. Agree a specific callback.',
    'During this exchange, you did not ask what the family discussion needed to resolve.',
    'Find out whether the family discussion is the only remaining concern.',
    'The call remains open. Agree a specific next conversation.',
    'Never stop isolating a concern merely because the deal remains open.',
  ]) assert.equal(decide(text).verdict,'approved',text);
  assert.equal(decide('No price was presented.',{...excerpt,fullCall:true}).verdict,'approved');
  assert.equal(decide('In this exchange, no price was presented anywhere in the call.').verdict,'withheld');
});

test('ninety words is an enforced maximum, never a truncation', () => {
  const ninety = Array.from({length:90},()=> 'word').join(' ');
  assert.equal(decide(ninety).verdict,'approved');
  assert.equal(decide(ninety+' extra').category,'invalid_format');
  assert.equal(decide('  '+ninety.replaceAll(' ','\n\t')+'  ').verdict,'approved');
});

test('a filtered moment keeps its identifier in the actual response example', () => {
  const prompt = E.buildReviewPrompt([{moment:2,coaching:'Agree a specific next conversation.'}], [{},{}], [excerpt,excerpt],scopedMaterial,'follow_up');
  const schema = JSON.parse(prompt.split('Return ONLY JSON: ')[1].split('. Cite only IDs')[0]);
  assert.deepEqual(schema.reviews.map(r=>r.moment),[2]);
  assert.match(prompt,/Requested moment IDs: \[2\]/);
  const wrong = E.evaluateEntries([{moment:2,coaching:'Agree a specific callback.'}],{reviews:[{moment:1,verdict:'approve',evidence_turns:[1],knowledge_refs:[E.knowledgeSources(scopedMaterial)[0].id]}]},[excerpt,excerpt],scopedMaterial);
  assert.equal(wrong[0].verdict,'withheld');
  assert.equal(decide('Agree a specific callback.',excerpt,2).verdict,'approved');
});
