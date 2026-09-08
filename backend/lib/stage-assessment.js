'use strict';
const S = require('./stage-eligibility');
const R = require('./stage-eligibility-review');
const V = require('./stage-observation-review');
const schemas = require('./stage-output-schema');

// Production's bounded stage lane: one candidate, local validation, and one
// independent review. Factual-proof pairs belong to offline QA, never here.
async function runProduction({turns, duration, material}, request) {
  if (!Array.isArray(turns) || !turns.length || !material) throw Error('Stage source or guidance missing');
  const candidate = await request({
    model: S.MODEL, max_tokens: S.MAX_TOKENS,
    output_config: {format: {type: 'json_schema', schema: schemas.producer}},
    messages: [{role: 'user', content: S.buildPrompt({turns}, duration, material.contextText)}],
  });
  const assessment = S.assess(candidate, turns);
  const reviewCandidate=S.reviewableCandidate(candidate,assessment);
  if (!reviewCandidate) return {candidate,review:null,record:assessment};
  const review = await request({
    model: R.MODEL, max_tokens: R.MAX_TOKENS,
    output_config: {format: {type: 'json_schema', schema: schemas.reviewer}},
    messages: [{role: 'user', content: R.prompt(reviewCandidate, turns, material)}],
  });
  const hash=S.guidanceHash(material);
  return {candidate,review,record:R.apply(assessment,review,turns,hash)};
}

// Offline QA retains the paired factual-proof reads used to pressure-test a
// reviewed candidate before a prompt or validator change is trusted.
async function run({turns, duration, material}, request) {
  const reviewed=await runProduction({turns,duration,material},request);
  if (!reviewed.review) return {...reviewed,factual:[],record:reviewed.record};
  const method=reviewed.record;
  const hash=S.guidanceHash(material);
  const findings=V.findings(method);
  const factual=[];
  for(const finding of findings){
    const prompt=V.proofPrompt(finding,turns);
    factual.push({moment:finding.moment,responses:prompt?[
      await request({model:S.MODEL,max_tokens:V.MAX_TOKENS,output_config:{format:{type:'json_schema',schema:schemas.proof}},messages:[{role:'user',content:prompt}]}),
      await request({model:S.MODEL,max_tokens:V.MAX_TOKENS,output_config:{format:{type:'json_schema',schema:schemas.proof}},messages:[{role:'user',content:prompt}]}),
    ]:[]});
  }
  return {...reviewed,factual,record:V.applyPairs(method,factual,turns,hash)};
}
module.exports = {run,runProduction};
