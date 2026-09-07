'use strict';
const S = require('./stage-eligibility');
const R = require('./stage-eligibility-review');
const V = require('./stage-observation-review');
const schemas = require('./stage-output-schema');

// One candidate followed by an independent evidence review. The caller owns
// spending, retry policy and persistence; this function never writes to a database.
async function run({turns, duration, material}, request) {
  if (!Array.isArray(turns) || !turns.length || !material) throw Error('Stage source or guidance missing');
  const candidate = await request({
    model: S.MODEL, max_tokens: S.MAX_TOKENS,
    output_config: {format: {type: 'json_schema', schema: schemas.producer}},
    messages: [{role: 'user', content: S.buildPrompt({turns}, duration, material.contextText)}],
  });
  const assessment = S.assess(candidate, turns);
  const reviewCandidate=S.reviewableCandidate(candidate,assessment);
  if (!reviewCandidate) return {candidate,review:null,factual:[],record:assessment};
  const review = await request({
    model: R.MODEL, max_tokens: R.MAX_TOKENS,
    output_config: {format: {type: 'json_schema', schema: schemas.reviewer}},
    messages: [{role: 'user', content: R.prompt(reviewCandidate, turns, material)}],
  });
  const hash=S.guidanceHash(material);
  const method=R.apply(assessment,review,turns,hash);
  const findings=V.findings(method);
  const factual=[];
  for(const finding of findings){
    const prompt=V.proofPrompt(finding,turns);
    factual.push({moment:finding.moment,responses:prompt?[
      await request({model:S.MODEL,max_tokens:V.MAX_TOKENS,output_config:{format:{type:'json_schema',schema:schemas.proof}},messages:[{role:'user',content:prompt}]}),
      await request({model:S.MODEL,max_tokens:V.MAX_TOKENS,output_config:{format:{type:'json_schema',schema:schemas.proof}},messages:[{role:'user',content:prompt}]}),
    ]:[]});
  }
  return {candidate,review,factual,record:V.applyPairs(method,factual,turns,hash)};
}
module.exports = {run};
