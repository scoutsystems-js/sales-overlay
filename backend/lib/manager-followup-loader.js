'use strict';
const {CHUNK}=require('./chunk');
const {realCallsOnly}=require('./real-calls');
const {summarizePriority}=require('./manager-coaching-priority');
const F=require('./followup-facts');
const P=require('./followup-policy');
const {clipHref}=require('./clip-link');
const TOPIC={id:'booking_follow_up',section:'close',title:'Drill booking the follow-up'};
async function loadFollowupPriority(admin,{calls,memberIds,teamOwner,names,from,to}) {
  const members=new Set(memberIds||[]),start=Date.parse(from),end=Date.parse(to);
  const eligible=realCallsOnly(calls||[]).filter(c=>members.has(c.user_id)&&!c.not_a_sales_call&&!c.duplicate_of&&Date.parse(c.call_date)>=start&&Date.parse(c.call_date)<=end).map(c=>({...c,closer_name:names?.[c.user_id]||null}));
  const byId=new Map(eligible.map(c=>[c.id,c])),assessed=[],examples=[],notes=[];
  if(teamOwner) for(let page=0;page<10;page++){
    const r=await admin.from('knowledge_base').select('id,category,scope,team_owner_id,content,metadata').eq('category','coaching_correction').eq('scope','team').eq('team_owner_id',teamOwner).eq('metadata->>manager_followup_standard',P.STANDARD).order('id').range(page*100,page*100+99);
    if(r.error)throw Error('Follow-up standard unavailable');notes.push(...(r.data||[]));if((r.data||[]).length<100)break;if(page===9)throw Error('Follow-up standard read incomplete');
  }
  for(const c of eligible) if(c.analysis_status==='done'&&['closed','lost','disqualified','no_show'].includes(c.outcome))assessed.push(c.id);
  const ids=eligible.filter(c=>!assessed.includes(c.id)).map(c=>c.id);
  for(let i=0;i<ids.length;i+=CHUNK){
    const q=await admin.from('call_analyses').select('fathom_call_id,status,outcome,prospect_name,transcript_stored,manager_followup_facts').in('fathom_call_id',ids.slice(i,i+CHUNK)).eq('status','done').not('manager_followup_facts','is',null);
    if(q.error)throw Error('Follow-up evidence unavailable');
    for(const analysis of q.data||[]){
      const call=byId.get(analysis.fathom_call_id),saved=analysis.manager_followup_facts;
      if(!call||analysis.status!=='done'||!saved||saved.version!==F.VERSION||saved.source_hash!==F.sourceHash(analysis)||!Array.isArray(saved.reads)||saved.reads.length!==2)continue;
      // Reconstruct from stored model decisions and current transcript; never trust
      // a persisted quote, classification or cached manager-policy approval.
      let read=0;const reconstructed=await F.readFollowupFacts(analysis,async()=>saved.reads[read++]);
      const classification=P.classifyFollowup({facts:reconstructed.facts,outcome:analysis.outcome,notes,teamOwner});
      if(classification.state==='unknown')continue;
      assessed.push(call.id);call.outcome=analysis.outcome;call.prospect_name=analysis.prospect_name;
      if(classification.state==='issue'){
        const evidence=reconstructed.evidence,first=evidence[0];
        examples.push({call_id:call.id,evidence_id:first.evidence_id,quote:evidence.map(e=>e.speaker+': '+e.quote).join('\n'),clip_url:call.recording_url?clipHref(call.recording_url,first.timestamp_seconds):null,evidence});
      }
    }
  }
  return summarizePriority({topic:TOPIC,calls:eligible,memberIds,assessedCallIds:assessed,examples,from,to});
}
module.exports={loadFollowupPriority};
