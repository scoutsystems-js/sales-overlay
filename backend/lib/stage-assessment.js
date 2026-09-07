'use strict';
const S = require('./stage-eligibility');
const R = require('./stage-eligibility-review');
const V = require('./stage-observation-review');
const F = require('./period-observation-facts');
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
  const review = await request({
    model: R.MODEL, max_tokens: R.MAX_TOKENS,
    output_config: {format: {type: 'json_schema', schema: schemas.reviewer}},
    messages: [{role: 'user', content: R.prompt(candidate, turns, material)}],
  });
  const hash=S.guidanceHash(material);
  const method=R.apply(assessment,review,turns,hash);
  const findings=V.findings(method);
  const factual=findings.length?[
    await request({model:S.MODEL,max_tokens:V.MAX_TOKENS,messages:[{role:'user',content:F.prompt(findings,V.context(turns))}]}),
    await request({model:S.MODEL,max_tokens:V.MAX_TOKENS,messages:[{role:'user',content:F.prompt(findings,V.context(turns))}]}),
  ]:[];
  return {candidate,review,factual,record:V.applyPair(method,factual,turns,hash)};
}
module.exports = {run};
