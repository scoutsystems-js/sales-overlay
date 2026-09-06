'use strict';
const {sectionStatsFromAnalyses,LABELS,SECTION_ORDER}=require('./section-ranking');
const {weakestSection}=require('./rep-card-metrics');
function summarize(allCalls,examples,window={}) {
 const from=Date.parse(window.from),to=Date.parse(window.to);
 const calls=(allCalls||[]).filter(c=>Date.parse(c.call_date)>=from&&Date.parse(c.call_date)<=to);
 const ids=new Set(calls.map(c=>c.id));
 const analyses=calls.filter(c=>c.analysis_status==='done').map(c=>c.analysis||{});
 const stats=sectionStatsFromAnalyses(analyses);
 const means=Object.fromEntries(SECTION_ORDER.map(k=>[k,stats[k].mean]));
 const weakest=weakestSection(means);
 const groups=new Map();
 for(const item of examples||[]){if(!ids.has(item.call_id)||!item.evidence?.length||!item.observation||!item.recommendation)continue;
  const key=item.section+'|'+item.move;const group=groups.get(key)||{section:item.section,move:item.move,examples:[]};
  if(!group.examples.some(e=>e.call_id===item.call_id))group.examples.push(item);groups.set(key,group);
 }
 const patterns=[...groups.values()].map(g=>({...g,calls:g.examples.length,examples:g.examples.sort((a,b)=>String(b.call_date).localeCompare(String(a.call_date)))})).sort((a,b)=>(Number(b.section===weakest?.section)-Number(a.section===weakest?.section))||b.calls-a.calls||a.move.localeCompare(b.move));
 return {status:!calls.length?'no_calls':!weakest?'ungraded':'ready',from:window.from,to:window.to,calls:calls.length,graded_calls:analyses.length,section:weakest?.section||null,label:weakest?LABELS[weakest.section]:calls.length?'Awaiting grades':'No calls',score:weakest?Math.round(weakest.score):null,tied_sections:weakest?SECTION_ORDER.filter(k=>means[k]===weakest.score):[],sections:SECTION_ORDER.map(section=>({section,label:LABELS[section],score:stats[section].mean==null?null:Math.round(stats[section].mean),calls:stats[section].n})),patterns,reviewed_calls:calls.filter(c=>c.period_review_current).length};
}
module.exports={summarize};
