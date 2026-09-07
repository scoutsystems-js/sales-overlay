'use strict';
const S = require('./stage-eligibility');
const R = require('./stage-eligibility-review');
const F = require('./period-observation-facts');
const VERSION = 'stage-observation-facts-v3';
const MAX_TOKENS=4500;
function findings(record) {
  return S.SECTIONS.map((stage, index) => ({moment:index+1, stage, observation:record.sections[stage].notes||''}))
    .filter(f => typeof record.sections[f.stage].score === 'number');
}
function context(turns) { return {turns,hash:S.sourceHash(turns),fullCall:true,historyScope:'single_call'}; }
function apply(method, response, turns, materialHash) {
  if (!R.verified(method, turns, materialHash)) throw Error('Stage-method review is missing or stale');
  const decisions = F.evaluate(findings(method), response, context(turns));
  const sections = Object.fromEntries(S.SECTIONS.map((stage,index) => {
    const original = method.sections[stage];
    const accepted = typeof original.score !== 'number' || decisions.some(d=>d.moment===index+1 && d.approved);
    return [stage,accepted ? original : {state:'unmeasured',score:null,grade:null,notes:null,evidence:[],reason:'The stage observation was not supported by the call.'}];
  }));
  return {...method,sections,factual_review:{version:VERSION,method,response,sections_hash:R.fingerprint(sections)}};
}
function verified(record, turns, materialHash) {
  const proof = record?.factual_review;
  if (proof?.version !== VERSION || proof.sections_hash !== R.fingerprint(record.sections)) return false;
  if (record.version !== proof.method.version || record.source_hash !== proof.method.source_hash || R.fingerprint(record.context)!==R.fingerprint(proof.method.context)) return false;
  try { return apply(proof.method,proof.response,turns,materialHash).factual_review.sections_hash === proof.sections_hash; }
  catch { return false; }
}
module.exports = {VERSION,MAX_TOKENS,findings,context,apply,verified};
