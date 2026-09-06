'use strict';
const F=require('./followup-facts'),P=require('./followup-policy');
const U=require('./model-usage');
const {CLAUDE_COACHING_MODEL}=require('./coaching');
const {realCallsOnly}=require('./real-calls');
const {teamKeyFor}=require('./coaching-corrections');
async function countTokens(prompt) {
  const response=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:CLAUDE_COACHING_MODEL,messages:[{role:'user',content:prompt}]})});
  if(!response.ok)throw Error('Follow-up token measurement unavailable');
  return (await response.json()).input_tokens;
}
async function assessNewCallFollowup(admin,call,analysis,userId,deps={}) {
  if(!call||call.not_a_sales_call||call.duplicate_of||!realCallsOnly([call]).length||analysis.outcome!=='follow_up')return null;
  const input=F.prepareFacts(analysis);if(!input)return null;
  const owner=await teamKeyFor(admin,userId);
  const q=await admin.from('knowledge_base').select('id,category,scope,team_owner_id,content,metadata').eq('category','coaching_correction').eq('scope','team').eq('team_owner_id',owner).eq('metadata->>manager_followup_standard',P.STANDARD).limit(2);
  if(q.error)throw Error('Follow-up standard unavailable');
  const notes=q.data||[];
  if(notes.length!==1||notes[0].category!=='coaching_correction'||notes[0].scope!=='team'||notes[0].team_owner_id!==owner||notes[0].content!==P.STANDARD_TEXT||notes[0].metadata?.manager_followup_standard!==P.STANDARD)return null;
  async function checkCurrentCall() {
    const fresh=await admin.from('fathom_calls').select('id,fathom_call_id,user_id,not_a_sales_call,duplicate_of').eq('id',call.id).eq('user_id',userId).maybeSingle();
    if(fresh.error||!fresh.data||fresh.data.user_id!==userId||fresh.data.id!==call.id||fresh.data.not_a_sales_call||fresh.data.duplicate_of||!realCallsOnly([fresh.data]).length)throw Error('Follow-up call eligibility changed');
  }
  await checkCurrentCall();
  const tokens=await (deps.countTokens||countTokens)(input.prompt);
  const retries=deps.maxRetries===undefined?U.getAnthropic().maxRetries:deps.maxRetries;
  // Conservative reservation includes both reads, maximum output and every SDK
  // retry. This lane is pinned to the measured Sonnet rate; another model holds.
  if(CLAUDE_COACHING_MODEL!=='claude-sonnet-4-6'||!Number.isFinite(tokens)||tokens<1||!Number.isInteger(retries)||retries<0||2*(retries+1)*(tokens*3+1200*15)/1e6>20)throw Error('Follow-up operation exceeds measured budget');
  return F.readFollowupFacts(analysis,async(prompt,stage)=>{
    await checkCurrentCall();
    const response=await (deps.create||U.createWithUsage)({model:CLAUDE_COACHING_MODEL,max_tokens:1200,messages:[{role:'user',content:prompt}]},{userId,callId:call.id,lane:'manager-followup-'+stage});
    if(response.stop_reason!=='end_turn')return null;
    const raw=(response.content||[]).map(c=>c.text||'').join('');
    try{return JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch(_){return null;}
  });
}
module.exports={assessNewCallFollowup};
