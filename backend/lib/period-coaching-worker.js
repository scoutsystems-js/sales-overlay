'use strict';
const P=require('./call-period-review'),U=require('./model-usage');
const {realCallsOnly}=require('./real-calls');
const MODEL='claude-sonnet-4-6',MAX_CALL_COST=2;
async function assessPeriodCoaching(admin,call,analysis,userId,deps={}) {
 if(!call||call.not_a_sales_call||call.duplicate_of||!realCallsOnly([call]).length)return null;
 const context=P.prepare(analysis);if(!context)return null;
 const material=await (deps.loadMaterial||require('./kb-material').loadKbMaterial)(admin,{userId,lane:'rep-period',maxChars:2500});if(!material.hasMaterial)return null;
 async function current(){const q=await admin.from('fathom_calls').select('id,fathom_call_id,user_id,not_a_sales_call,duplicate_of').eq('id',call.id).eq('user_id',userId).maybeSingle();if(q.error||!q.data||q.data.user_id!==userId||q.data.not_a_sales_call||q.data.duplicate_of||!realCallsOnly([q.data]).length)throw Error('Call eligibility changed');}
 let reserved=0;
 async function request(prompt,stage,maxTokens=P.MAX_TOKENS){await current();const messages=[{role:'user',content:prompt}];
  const count=deps.countTokens?await deps.countTokens(prompt):await (async()=>{const r=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:MODEL,messages})});if(!r.ok)throw Error('Token count unavailable');return (await r.json()).input_tokens;})();
  const retries=deps.maxRetries===undefined?U.getAnthropic().maxRetries:deps.maxRetries;
  if(!Number.isFinite(count)||count<1||!Number.isInteger(retries)||retries<0)throw Error('Budget measurement unavailable');
  const cost=(retries+1)*(count*3+maxTokens*15)/1e6;if(reserved+cost>MAX_CALL_COST)throw Error('Per-call review budget exceeded');reserved+=cost;
  await current();const r=await (deps.create||U.createWithUsage)({model:MODEL,max_tokens:maxTokens,messages},{userId,callId:call.id,lane:'rep-period-'+stage});if(r.stop_reason!=='end_turn')throw Error('Incomplete coaching review');
  return require('./analysis-worker')._extractFirstJsonObject(r.content.map(x=>x.text||'').join(''));
 }
 const draft=await request(P.writerPrompt(context,material,analysis.outcome),'draft');
 if(!draft||!Array.isArray(draft.findings))throw Error('Invalid coaching draft');
 const findings=P.candidates(draft,context,material);const review=findings.length?await request(P.reviewPrompt(findings,context,material,analysis.outcome),'review'):null;
 let record=P.finish(findings,review,context,material);
 if(record.findings.some(f=>f.move==='booking the follow-up')){
  // Reuse the factual reader only to validate this claim, never to choose the rep's priority.
  const facts=await require('./followup-facts').readFollowupFacts(analysis,(prompt,stage)=>request(P.schedulingPrompt(prompt),'scheduling-'+stage,1200));
  record=P.applySchedulingFacts(record,analysis,facts);
 }
 return record;
}
module.exports={assessPeriodCoaching,MAX_CALL_COST};
