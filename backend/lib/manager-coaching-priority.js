'use strict';
const {realCallsOnly}=require('./real-calls');

// Counting/presentation contract only, not an issue detector or evidence reviewer.
// The caller must supply same-topic, current-source assessments verified against
// transcript and team guidance. A missing coaching note is NOT a negative finding.
// Not wired to the manager page until that assessment producer is implemented.
function summarizePriority({topic,calls,assessedCallIds,examples,from,to,memberIds}) {
  const start=Date.parse(from),end=Date.parse(to);
  if (!Number.isFinite(start)||!Number.isFinite(end)||start>end) throw new Error('A valid explicit priority window is required.');
  const members=memberIds ? new Set(memberIds) : null;
  const eligible=new Map(realCallsOnly(calls).filter(c=>c.id && c.not_a_sales_call!==true && !c.duplicate_of && (!members||members.has(c.user_id)) && Date.parse(c.call_date)>=start && Date.parse(c.call_date)<=end).map(c=>[c.id,c]));
  const assessed=new Set((assessedCallIds||[]).filter(id=>eligible.has(id)));
  const matches=new Map(),unsupported=new Set();
  for (const example of examples||[]) {
    const call=eligible.get(example.call_id);
    if (!call || !assessed.has(call.id)) continue;
    let validClip=false;
    try {validClip=['https:','http:'].includes(new URL(example.clip_url).protocol);} catch (_) { /* missing/invalid link cannot support an example */ }
    if (!(example.highlight_id || example.evidence_id) || typeof example.quote!=='string' || !example.quote.trim() || !validClip) {unsupported.add(call.id);continue;}
    if (!matches.has(call.id)) matches.set(call.id,{
      call_id:call.id,owner_user_id:call.user_id,call_date:call.call_date,
      prospect_name:call.prospect_name||'Unknown prospect',closer_name:call.closer_name||'Unknown closer',
      outcome:call.outcome||null,highlight_id:example.highlight_id||null,evidence_id:example.evidence_id||null,quote:example.quote,clip_url:example.clip_url,source:call.source||null,evidence:example.evidence||[]
    });
  }
  // A claimed match lacking usable evidence is unknown, never silently negative.
  for (const id of unsupported) if (!matches.has(id)) assessed.delete(id);
  const complete=assessed.size===eligible.size;
  const count=matches.size;
  return {
    topic,from,to,total_calls:eligible.size,assessed_calls:assessed.size,unassessed_calls:eligible.size-assessed.size,
    matching_calls:count,coverage_complete:complete,
    frequency:complete ? count+' of '+eligible.size+' calls' : count+' evidenced calls · '+assessed.size+' of '+eligible.size+' assessed',
    examples:[...matches.values()].sort((a,b)=>String(b.call_date).localeCompare(String(a.call_date))||String(a.call_id).localeCompare(String(b.call_id)))
  };
}
module.exports={summarizePriority};
