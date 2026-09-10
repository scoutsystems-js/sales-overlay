'use strict';
const P=require('./call-period-review'),U=require('./model-usage');
const {realCallsOnly}=require('./real-calls');
// Measured 65,475-token call: nine reads plus one transport retry each reserve < $6.
// This is a worst-case envelope, not a target; unsupported findings stop before later reads.
const MODEL='claude-sonnet-4-6',INDEPENDENT_MODEL='claude-opus-4-6',MAX_CALL_COST=6;
async function assessPeriodCoaching(admin,call,analysis,userId,deps={}) {
 if(!call||call.not_a_sales_call||call.duplicate_of||!realCallsOnly([call]).length)return null;
 const context=P.prepare(analysis);if(!context)return null;
 const material=await (deps.loadMaterial||require('./period-coaching-material').loadPeriodMaterial)(admin,{userId,lane:'rep-period',maxChars:2500});if(!material.hasMaterial)return null;
 async function current(){const q=await admin.from('fathom_calls').select('id,fathom_call_id,user_id,not_a_sales_call,duplicate_of').eq('id',call.id).eq('user_id',userId).maybeSingle();if(q.error||!q.data||q.data.user_id!==userId||q.data.not_a_sales_call||q.data.duplicate_of||!realCallsOnly([q.data]).length)throw Error('Call eligibility changed');}
 let reserved=0;
 async function request(prompt,stage,maxTokens=P.MAX_TOKENS){const model=['independent-review','observation-facts'].includes(stage)?INDEPENDENT_MODEL:MODEL;await current();const messages=[{role:'user',content:prompt}];
  const count=deps.countTokens?await deps.countTokens(prompt):await (async()=>{const r=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,messages})});if(!r.ok)throw Error('Token count unavailable');return (await r.json()).input_tokens;})();
  const retries=deps.maxRetries===undefined?1:deps.maxRetries;
  if(!Number.isFinite(count)||count<1||!Number.isInteger(retries)||retries<0)throw Error('Budget measurement unavailable');
  const inputPrice=model===INDEPENDENT_MODEL?5:3,outputPrice=model===INDEPENDENT_MODEL?25:15;
  const cost=(retries+1)*(count*inputPrice+maxTokens*outputPrice)/1e6;if(reserved+cost>MAX_CALL_COST)throw Error('Per-call review budget exceeded');reserved+=cost;
  await current();const r=await (deps.create||U.createWithUsage)({model,max_tokens:maxTokens,messages},{userId,callId:call.id,lane:'rep-period-'+stage},{maxRetries:retries});if(r.stop_reason!=='end_turn')throw Error('Incomplete coaching review');
  return require('./analysis-worker')._extractFirstJsonObject(r.content.map(x=>x.text||'').join(''));
 }
 const stageFacts=await require('./period-stage-facts').read(context,request);
 const draft=await request(P.writerPrompt(context,material,analysis.outcome,stageFacts),'draft');
 if(!draft||!Array.isArray(draft.findings))throw Error('Invalid coaching draft');
 const findings=P.candidates(draft,context,material);const review=findings.length?await request(P.reviewPrompt(findings,context,material,analysis.outcome,stageFacts),'review'):null;
 let record=P.finish(findings,review,context,material,stageFacts);
 if(record.findings.length){
  const eligible=findings.filter(f=>record.findings.some(r=>r.moment===f.moment));
  const independent=await request(P.reviewPrompt(eligible,context,material,analysis.outcome,stageFacts),'independent-review');
  record=P.applyIndependentReview(record,eligible,independent,context,material);
 }
 if(record.findings.some(f=>f.move==='booking the follow-up')){
  // Reuse the factual reader only to validate this claim, never to choose the rep's priority.
  const facts=await require('./followup-facts').readFollowupFacts(analysis,(prompt,stage)=>request(P.schedulingPrompt(prompt),'scheduling-'+stage,1200));
  record=P.applySchedulingFacts(record,analysis,facts);
 }
 if(record.findings.length){
  const O=require('./period-observation-facts'),first=await request(O.prompt(record.findings,context),'observation-facts',O.MAX_TOKENS);
  const decisions=O.evaluate(record.findings,first,context),eligible=record.findings.filter(f=>decisions.some(d=>d.moment===f.moment&&d.semantic_supported));
  const second=eligible.length?await request(O.prompt(eligible,context),'observation-facts',O.MAX_TOKENS):{observations:[]};
  record=O.applyPair(record,[first,second],context);
 }
 record.verified=P.verifiedSlice(record,analysis);   // H770: the record carries the turns its read-time checks touch
 return record;
}
module.exports={assessPeriodCoaching,MAX_CALL_COST};
