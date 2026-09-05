'use strict';
// Legacy coaching tests keep testing their original concerns with a valid source
// exchange and an accepting review seam. Dedicated evidence tests exercise refusals.
function withEvidence(admin) {
  const original=admin.from.bind(admin);
  admin.from=function(table){
    const q=original(table);
    if(table==='call_highlights') {
      const then=q.then.bind(q);
      q.then=(resolve,reject)=>then(r=>resolve({...r,data:(r.data||[]).map(h=>({...h,speaker:h.speaker||'PROSPECT'}))}),reject);
    }
    if(table==='call_analyses') {
      let fields='', callId=null;const eq=q.eq.bind(q);q.eq=function(k,v){if(k==='fathom_call_id')callId=v;eq(k,v);return q;};const select=q.select.bind(q);const single=q.maybeSingle&&q.maybeSingle.bind(q);
      q.select=function(f){fields=f;select(f);return q;};
      q.maybeSingle=async function(){
        if(!fields.includes('transcript_stored')) return single?single():{data:null,error:null};
        const r=await original('call_highlights').select('*').eq('fathom_call_id',callId);
        const turns=(r.data||[]).flatMap((h,i)=>[{speaker:h.speaker||'PROSPECT',start_seconds:h.timestamp_seconds||i*30,text:h.quote},{speaker:'CLOSER',start_seconds:(h.timestamp_seconds||i*30)+2,text:h.closer_response||'What is your concern?'}]);
        return {data:{outcome:'lost',why_outcome:'',transcript_stored:{turns}},error:null};
      };
    }
    return q;
  };return admin;
}
function withReviewModel(original) {
  return async function(params,ctx){
    if(ctx&&ctx.lane==='coaching-review') {
      const p=params.messages[0].content;
      const support=(p.match(/\[(K-[a-f0-9]+)\]/)||[])[1];
      const ids=[...p.matchAll(/MOMENT (\d+) full_call=/g)].map(m=>Number(m[1]));
      return {content:[{text:JSON.stringify({reviews:ids.map(moment=>({moment,verdict:'approve',evidence_turns:[1],knowledge_refs:[support],history_refs:[]}))})}]};
    }
    return original(params,ctx);
  };
}
module.exports={withEvidence,withReviewModel};
