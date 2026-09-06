'use strict';
// Exact dialogue pairs, assembled without a model or a prior interpretation.
// The grouping proves adjacency in supplied material, not causal meaning or
// completeness across parts of the call absent from that material.
function buildRecords(contexts) {
  return contexts.map((context,i)=>{
    const prelude=[], exchanges=[];
    for (const [index,turn] of context.turns.entries()) {
      const source={...turn,turn:index+1};
      if (turn.speaker==='CLOSER') {
        if (!exchanges.length || exchanges[exchanges.length-1].prospect.length) exchanges.push({closer:[],prospect:[]});
        exchanges[exchanges.length-1].closer.push(source);
      } else if (turn.speaker==='PROSPECT') {
        if (!exchanges.length) prelude.push(source);
        else exchanges[exchanges.length-1].prospect.push(source);
      } else {
        throw new Error('Action record requires speaker-verified context.');
      }
    }
    return {moment:i+1,scope:context.fullCall?'full_call':'excerpt',context_hash:context.hash,prelude,exchanges};
  });
}
function recordBlock(records) {
  return [
    'ACTION / ANSWER RECORD: exact consecutive closer turns followed by the next supplied prospect turns. No model summary. Read what was asked separately from what was answered. An unresolved answer does not erase the question. Empty prospect arrays mean no adjacent answer is supplied, not that the prospect was silent. Scope excerpt means omitted call sections remain unknown.',
    JSON.stringify(records)
  ].join('\n');
}
module.exports={buildRecords,recordBlock};
