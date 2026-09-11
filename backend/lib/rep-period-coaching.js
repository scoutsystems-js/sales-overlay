'use strict';
const {sectionStatsFromAnalyses,LABELS,SECTION_ORDER,rankSections,THIN_LABEL}=require('./section-ranking');
/* H768 (Justin, 2026-09-10): THE SAME FLOOR AS THE REP PAGE, FROM THE SAME SOURCE. This panel named a weakest area from ONE
   counted call while section-ranking refuses below MIN_CALLS_TO_RANK. rankSections decides; below the floor the panel says
   what it is based on in the rep page's own words and names no area. */
const NG=require('./new-grading-copy');
function summarize(allCalls,examples,window={}) {
 const from=Date.parse(window.from),to=Date.parse(window.to);
 const calls=(allCalls||[]).filter(c=>Date.parse(c.call_date)>=from&&Date.parse(c.call_date)<=to);
 const ids=new Set(calls.map(c=>c.id));
 const analyses=calls.filter(c=>c.analysis_status==='done').map(c=>c.analysis||{});
 const stats=sectionStatsFromAnalyses(analyses);
 const means=Object.fromEntries(SECTION_ORDER.map(k=>[k,stats[k].mean]));
 const ranked=rankSections(stats);const enough=ranked.filter(x=>x.enough);
 const weakest=enough.length?{section:enough[0].section,score:enough[0].mean}:null;
 const thin=!weakest&&SECTION_ORDER.some(k=>stats[k].n>0);
 const thinReason=thin?[...ranked].sort((a,b)=>b.n-a.n)[0].reason:null;
 const legacy=stats.intro.eligibility.legacy_unreviewed;
 const awaiting=!weakest&&calls.length>0&&legacy>0;
 const groups=new Map();
 for(const item of examples||[]){if(!ids.has(item.call_id)||!item.evidence?.length||!item.observation||!item.recommendation)continue;
  const key=item.section+'|'+item.move;const group=groups.get(key)||{section:item.section,move:item.move,examples:[]};
  if(!group.examples.some(e=>e.call_id===item.call_id))group.examples.push(item);groups.set(key,group);
 }
 const patterns=[...groups.values()].map(g=>({...g,calls:g.examples.length,examples:g.examples.sort((a,b)=>String(b.call_date).localeCompare(String(a.call_date)))}));
 /* Block 002 (SCOUT-BUILD-SESSION.md, Justin's rule): THE FOCUS IS THE LOWEST STAGE'S. lowest stage → the strongest supported
    pattern WITHIN it → one representative call. A pattern supports the lowest stage when it IS that stage's, or — the one
    cross-stage signal on record — when the lowest stage is a decision stage (close, objection) and an example's cited
    exchange carries the located purchase decision (`decision_turns`, from call-period-review). Recurrence is preferred
    (more supporting calls), then recency; a single call is a focus with recurring:false, never a trend. A finding from
    another stage is never the reason: it stays in `patterns`, listed and counted, and `focus_note` says so. Guard
    test/coaching-focus-selection.test.js. */
 const DECISION_STAGES=['close','objection'];
 /* Block 005: cross-stage support runs ONE way — an EARLIER stage's gap carried into the decision may explain a later
    stage; a LATER stage's finding never explains an earlier one merely because its exchange holds the decision (three
    live reps had a Close finding as their Objection Handling diagnosis). */
 const earlier=g=>SECTION_ORDER.indexOf(g.section)<SECTION_ORDER.indexOf(weakest.section);
 const supporting=g=>!weakest?[]:g.section===weakest.section?g.examples:DECISION_STAGES.includes(weakest.section)&&earlier(g)?g.examples.filter(e=>Array.isArray(e.decision_turns)&&e.decision_turns.length):[];
 const candidates=patterns.map(g=>({section:g.section,move:g.move,examples:supporting(g)})).filter(c=>c.examples.length)
  .map(c=>({section:c.section,move:c.move,calls:c.examples.length,recurring:c.examples.length>=2,support:c.section===weakest.section?'same_section':'purchase_decision_in_exchange',example:c.examples[0]}))
  .sort((a,b)=>b.calls-a.calls||String(b.example.call_date).localeCompare(String(a.example.call_date))||a.move.localeCompare(b.move));
 /* Block 003 (SCOUT-BUILD-SESSION.md, Justin's correction): THE SCORE SAYS WHERE, THE PERIOD'S EVIDENCE SAYS WHY. With the
    lowest stage found, every reviewed instance of THAT stage in the window is read. The behaviour identity is the
    reviewer-classified `move` (a closed vocabulary) — no new pass, no text clustering. Distinct calls are counted against
    the reviewed calls where the stage counted (`reviewed_calls`). RECURRENCE: two distinct calls; one call is `isolated`
    and never a trend. OUTLIER: no recurring pattern, and without the single lowest score the stage would no longer be
    the lowest — the low average is one call, said plainly. INSUFFICIENT: nothing supports the stage; the stage is kept,
    nothing else is substituted. STRENGTH (Discovery only, from the stage record's own work record,
    context.discovery.areas): an area with evidenced work on two or more calls and on more than half of the graded
    Discovery calls; nothing structured exists for the other stages, so none is claimed. The representative example is
    the primary pattern's most recent finding — evidence for the diagnosis, never the diagnosis. The summary is written
    in code from these counts. Guard test/coaching-focus-diagnosis.test.js. */
 const AREA_LABELS={pain:'pain',goals:'goals',current_situation:'current situation',decision_makers:'decision makers',why_now:'why now',financial_resources:'financial resources'};
 const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
 let focus=null;
 if(weakest){
  const M=require('./stage-eligibility'),label=LABELS[weakest.section];
  const counted=calls.filter(c=>c.analysis_status==='done'&&M.stageMetric(c.analysis||{},weakest.section).contributes);
  const reviewedIds=new Set(counted.filter(c=>c.period_review_current).map(c=>c.id));patterns.filter(g=>g.section===weakest.section).forEach(g=>g.examples.forEach(e=>reviewedIds.add(e.call_id)));const reviewed=reviewedIds.size;
  const primary=candidates[0]||null,secondary=candidates.slice(1,3).map(c=>({section:c.section,move:c.move,calls:c.calls}));
  let outlier=null;
  if(!(primary&&primary.recurring)&&counted.length>=3&&enough[1]){
   const scores=counted.map(c=>M.stageMetric(c.analysis||{},weakest.section).score),at=scores.indexOf(Math.min(...scores));
   const rest=scores.filter((_,i)=>i!==at),meanWithout=rest.reduce((a,b)=>a+b,0)/rest.length;
   if(meanWithout>enough[1].mean)outlier={call_id:counted[at].id,score:scores[at],mean_without:Math.round(meanWithout)};
  }
  let strength=null;
  if(weakest.section==='discovery'){
   const withRecord=counted.filter(c=>Array.isArray(c.analysis?.stage_eligibility?.context?.discovery?.areas)),tally={};
   withRecord.forEach(c=>{new Set(c.analysis.stage_eligibility.context.discovery.areas.map(a=>a&&a.area).filter(a=>AREA_LABELS[a])).forEach(a=>{tally[a]=(tally[a]||0)+1;});});
   const top=Object.entries(tally).filter(([,n])=>n>=2&&n*2>withRecord.length).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,2);
   if(top.length){const n=Math.min(...top.map(([,c])=>c));strength={areas:top.map(([a])=>a),calls:n,of:withRecord.length,sentence:cap(top.map(([a])=>AREA_LABELS[a]).join(' and '))+(top.length>1?' were':' was')+' established in '+n+' of '+withRecord.length+' graded Discovery call'+(withRecord.length===1?'':'s')+'.'};}
  }
  const state=primary&&primary.recurring?'pattern':outlier?'outlier':primary?'isolated':'insufficient';
  const phrase=c=>cap(c.move)+(c.support==='purchase_decision_in_exchange'?', carried into the purchase decision,':'');
  const once=primary&&!primary.recurring?' '+phrase(primary)+' came up in one call.':'';
  const summary=state==='pattern'?label+' needs the most attention. '+phrase(primary)+' came up in '+primary.calls+' of '+reviewed+' reviewed '+label+' call'+(reviewed===1?'':'s')+'.'+(secondary.length?' '+secondary.map(x=>cap(x.move)+' in '+x.calls).join('; ')+'.':'')
   :state==='outlier'?label+' is the lowest-scoring area, but the reviewed calls do not show a consistent '+label+' problem. The low average is driven mostly by one call.'+once
   :state==='isolated'?label+' is the lowest-scoring area, but the reviewed calls show no repeated issue.'+once
   :label+' is the lowest-scoring area, but there is not yet enough reviewed evidence to identify a reliable coaching pattern.';
  focus={section:weakest.section,label,state,summary,move:primary?primary.move:null,move_section:primary?primary.section:null,calls:primary?primary.calls:0,recurring:!!(primary&&primary.recurring),support:primary?primary.support:null,example:primary?primary.example:null,secondary,reviewed_calls:reviewed,strength,outlier};
 }
 const isFocus=g=>!!(focus&&focus.move)&&g.section===focus.section&&g.move===focus.move;
 patterns.sort((a,b)=>(Number(isFocus(b))-Number(isFocus(a)))||(Number(b.section===weakest?.section)-Number(a.section===weakest?.section))||b.calls-a.calls||a.move.localeCompare(b.move));
 return {focus,status:!calls.length?'no_calls':weakest?'ready':thin?'thin':'ungraded',from:window.from,to:window.to,calls:calls.length,graded_calls:analyses.length,section:weakest?.section||null,label:weakest?LABELS[weakest.section]:thin?THIN_LABEL:awaiting?NG.LABEL:calls.length?'Awaiting grades':'No calls',awaiting_new_grading:awaiting&&!thin,note:thin?thinReason:awaiting?NG.newGradingNote(legacy):null,score:weakest?Math.round(weakest.score):null,tied_sections:weakest?enough.filter(x=>x.mean===weakest.score).map(x=>x.section):[],sections:SECTION_ORDER.map(section=>({section,label:LABELS[section],score:stats[section].mean==null?null:Math.round(stats[section].mean),calls:stats[section].n})),patterns,reviewed_calls:calls.filter(c=>c.period_review_current).length};
}
module.exports={summarize};
