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
 const patterns=[...groups.values()].map(g=>({...g,calls:g.examples.length,examples:g.examples.sort((a,b)=>String(b.call_date).localeCompare(String(a.call_date)))})).sort((a,b)=>(Number(b.section===weakest?.section)-Number(a.section===weakest?.section))||b.calls-a.calls||a.move.localeCompare(b.move));
 return {status:!calls.length?'no_calls':weakest?'ready':thin?'thin':'ungraded',from:window.from,to:window.to,calls:calls.length,graded_calls:analyses.length,section:weakest?.section||null,label:weakest?LABELS[weakest.section]:thin?THIN_LABEL:awaiting?NG.LABEL:calls.length?'Awaiting grades':'No calls',awaiting_new_grading:awaiting&&!thin,note:thin?thinReason:awaiting?NG.newGradingNote(legacy):null,score:weakest?Math.round(weakest.score):null,tied_sections:weakest?enough.filter(x=>x.mean===weakest.score).map(x=>x.section):[],sections:SECTION_ORDER.map(section=>({section,label:LABELS[section],score:stats[section].mean==null?null:Math.round(stats[section].mean),calls:stats[section].n})),patterns,reviewed_calls:calls.filter(c=>c.period_review_current).length};
}
module.exports={summarize};
