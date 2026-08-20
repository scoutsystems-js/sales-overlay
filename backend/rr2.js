const fs=require('fs');
const { createClient } = require('@supabase/supabase-js');
const keys=fs.readFileSync(__dirname+'/../API Keys.md','utf8');
const pick=n=>{const m=keys.match(new RegExp(n+'\\s*[=:]\\s*([^\\s`]+)'));return m?m[1]:null;};
['ANTHROPIC_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VOYAGE_API_KEY']
  .forEach(k=>{ if(!process.env[k]) process.env[k]=pick(k); });
const admin=createClient(pick('SUPABASE_URL'),pick('SUPABASE_SERVICE_ROLE_KEY'));
const IDS=[
  ['1. LOST (the embarrassment case)','2e1f53c4-4f37-4616-909b-f02b0e1e9769'],
  ['2. CLOSED (distinctive voice)','dc7dd705-8274-4438-9e06-421fc8ac6177'],
  ['3. ZOOM (control - must NOT ground)','1882494e-34de-4032-8bb8-1d96b5658991'],
];
(async()=>{
  const worker=require('./lib/analysis-worker');
  console.log('ANALYSIS_PROMPT_VERSION =', worker.ANALYSIS_PROMPT_VERSION, '\n');
  const before={};
  for(const [label,id] of IDS){
    const r=await admin.from('call_analyses')
      .select('user_id,follow_up_email,prompt_version,overall_score,outcome,status')
      .eq('fathom_call_id',id).maybeSingle();
    before[id]=r.data;
    console.log(label,'|',id.slice(0,8),'| user='+String(r.data.user_id).slice(0,8),
      '| '+r.data.prompt_version+' | status='+r.data.status);
  }
  for(const [label,id] of IDS){
    console.log('\n--- '+label+' ---');
    try{
      const res=await worker.analyzeCall(id, before[id].user_id);
      console.log('  ->', JSON.stringify({status:res.status, score:res.overall_score, reason:res.reason, err:res.error}));
    }catch(e){ console.log('  ERROR:', e.message); }
  }
  console.log('\n\n================= BEFORE / AFTER =================');
  for(const [label,id] of IDS){
    const a=await admin.from('call_analyses')
      .select('follow_up_email,prompt_version,outcome,overall_score,status')
      .eq('fathom_call_id',id).maybeSingle();
    console.log('\n########## '+label+'  ('+id.slice(0,8)+') ##########');
    console.log('version: '+before[id].prompt_version+' -> '+a.data.prompt_version
      +'   | score '+before[id].overall_score+' -> '+a.data.overall_score
      +'   | status='+a.data.status+'  outcome='+a.data.outcome);
    console.log('\n--- v23 BEFORE ---\n'+(before[id].follow_up_email||'(none)'));
    console.log('\n--- v24 AFTER ---\n'+(a.data.follow_up_email||'(none)'));
  }
})();
