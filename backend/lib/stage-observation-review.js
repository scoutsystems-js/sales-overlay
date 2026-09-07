'use strict';
const S = require('./stage-eligibility');
const R = require('./stage-eligibility-review');
const F = require('./period-observation-facts');
const VERSION = 'stage-observation-facts-v5';
const MAX_TOKENS=800, MAX_PROOF_TURNS=8;
function findings(record) {
  return S.SECTIONS.map((stage, index) => ({moment:index+1, stage, observation:record.sections[stage].notes||'', evidence:record.sections[stage].evidence||[]}))
    .filter(f => typeof record.sections[f.stage].score === 'number');
}
function context(turns) { return {turns,hash:S.sourceHash(turns),fullCall:true,historyScope:'single_call'}; }
function proofContext(finding, turns) {
 const evidence=Array.isArray(finding?.evidence)?finding.evidence:[];
 if (!evidence.length || evidence.length>MAX_PROOF_TURNS) return null;
 const selected=evidence.map(item=>({turn:item?.turn,speaker:item?.speaker,text:item?.quote}));
 if (selected.some(item=>!Number.isInteger(item.turn)||item.turn<1||item.turn>turns.length||turns[item.turn-1]?.speaker!==item.speaker||turns[item.turn-1]?.text!==item.text)) return null;
 return {turns:selected,hash:S.sourceHash(turns),fullCall:false,historyScope:'stage_observation_evidence'};
}
function proofPrompt(finding, turns) {
 const compact=proofContext(finding,turns);
 if (!compact) return null;
 return [
  'FACTS ONLY. Check one proposed stage observation against only its supplied source turns. Do not grade the rep, give advice, infer a missing action, infer motive or impact, or search outside this bounded evidence.',
  'The observation has one sentence with one or two actor-prefixed factual clauses. Check each clause. A CLOSER action needs a CLOSER source turn; a PROSPECT answer or fact needs a PROSPECT source turn. If a clause is not established by these turns, return contradicted or unclear. Copy only short exact passages from the supplied turns. Never join passages or change a speaker.',
  'Return exactly one compact JSON object for this one moment. Use at most two claims and at most two citations in each list. Reason is at most 25 words.',
  'SOURCE EVIDENCE:\n'+compact.turns.map(item=>'[turn '+item.turn+'] '+item.speaker+': '+item.text).join('\n'),
  'OBSERVATION:\nMoment '+finding.moment+'\n'+finding.observation,
  'Return JSON only: '+JSON.stringify({moment:finding.moment,status:'supported|contradicted|unclear',claims:[{text:'One factual clause.',actor:'CLOSER|PROSPECT|CALL',kind:'statement|action|absence|inference',evidence:[{turn:1,speaker:'CLOSER|PROSPECT',quote:'Exact short passage.'}]}],evidence:[{turn:1,speaker:'CLOSER|PROSPECT',quote:'Exact short passage.'}],counterevidence:[],reason:'At most 25 words.'}),
 ].join('\n\n');
}
function compactResponse(finding,response) {
 return {observations:[{moment:finding.moment,sentences:[{sentence:1,claims:response?.claims,evidence:response?.evidence,counterevidence:response?.counterevidence,status:response?.status,reason:response?.reason}]}]};
}
function citationsStayInEvidence(response, allowed) {
 const citations=[...(response?.evidence||[]),...(response?.counterevidence||[]),...((response?.claims||[]).flatMap(claim=>claim?.evidence||[]))];
 return citations.length>0&&citations.every(citation=>allowed.has(citation?.turn));
}
function evaluateProof(finding,response,turns) {
 const compact=proofContext(finding,turns);
 if (!compact || response?.moment!==finding.moment || !citationsStayInEvidence(response,new Set(compact.turns.map(item=>item.turn)))) return {moment:finding.moment,approved:false,semantic_supported:false,category:'invalid_evidence',reason:'Proof must cite only this observation’s supplied evidence.'};
 return F.evaluate([finding],compactResponse(finding,response),context(turns))[0];
}
function sectionsWithProof(method, decisions) {
  return Object.fromEntries(S.SECTIONS.map((stage,index) => {
    const original = method.sections[stage];
    const accepted = typeof original.score !== 'number' || decisions.some(d=>d.moment===index+1 && d.approved);
    return [stage,accepted ? original : {state:'unmeasured',score:null,grade:null,notes:null,evidence:[],reason:'The stage observation was not supported by the call.'}];
  }));
}
function apply(method, response, turns, materialHash) {
  if (!R.verified(method, turns, materialHash)) throw Error('Stage-method review is missing or stale');
  const decisions = F.evaluate(findings(method), response, context(turns));
  const sections = sectionsWithProof(method, decisions);
  return {...method,sections,factual_review:{version:VERSION,method,response,sections_hash:R.fingerprint(sections)}};
}
function applyPair(method, responses, turns, materialHash) {
  if (!R.verified(method, turns, materialHash)) throw Error('Stage-method review is missing or stale');
  const proof=F.applyPair({findings:findings(method)},responses,context(turns));
  const decisions=proof.observation_review.decisions;
  const sections=sectionsWithProof(method,decisions);
  return {...method,sections,factual_review:{version:VERSION,method,responses,decisions,sections_hash:R.fingerprint(sections)}};
}
function applyPairs(method, pairs, turns, materialHash) {
 if (!R.verified(method, turns, materialHash)) throw Error('Stage-method review is missing or stale');
 const decisions=findings(method).map(finding=>{
  const pair=Array.isArray(pairs)?pairs.filter(item=>item?.moment===finding.moment)[0]:null;
  const responses=pair?.responses;
  const evaluations=Array.isArray(responses)&&responses.length===2?responses.map(response=>evaluateProof(finding,response,turns)):[];
  const semanticAgreement=evaluations.length===2&&evaluations.every(result=>result.semantic_supported);
  const grounded=semanticAgreement&&evaluations.some(result=>result.approved);
  return {moment:finding.moment,approved:grounded,category:grounded?'supported':evaluations.find(result=>result.category!=='supported')?.category||'invalid_evidence',reason:grounded?'Both factual reads support the observation and its claims have located evidence.':evaluations.find(result=>!result.approved)?.reason||'Two independent factual reads are required.'};
 });
 const sections=sectionsWithProof(method,decisions);
 return {...method,sections,factual_review:{version:VERSION,method,pairs,decisions,sections_hash:R.fingerprint(sections)}};
}
function verified(record, turns, materialHash) {
  const proof = record?.factual_review;
  if (proof?.version !== VERSION || proof.sections_hash !== R.fingerprint(record.sections)) return false;
  if (record.version !== proof.method.version || record.source_hash !== proof.method.source_hash || R.fingerprint(record.context)!==R.fingerprint(proof.method.context)) return false;
 if (Array.isArray(proof.pairs)) {
  try { return applyPairs(proof.method,proof.pairs,turns,materialHash).factual_review.sections_hash === proof.sections_hash; }
  catch { return false; }
 }
 if (!Array.isArray(proof.responses) || proof.responses.length!==2) return false;
 try { return applyPair(proof.method,proof.responses,turns,materialHash).factual_review.sections_hash === proof.sections_hash; }
 catch { return false; }
}
module.exports = {VERSION,MAX_TOKENS,MAX_PROOF_TURNS,findings,context,proofContext,proofPrompt,evaluateProof,apply,applyPair,applyPairs,verified};
