'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../lib/period-stage-facts');
const context={hash:'source',turns:[{speaker:'CLOSER',text:'Ready to buy the program?',time:1},{speaker:'PROSPECT',text:'I need to decide whether it fits.',time:2},{speaker:'CLOSER',text:'Let us discuss that.',time:3}]};
const read={decisions:[{state:'undecided',evidence:[{turn:1,quote:context.turns[0].text},{turn:2,quote:context.turns[1].text}],reason:'A paid program decision is recorded.'}]};
test('two blind reads must locate the same decision; invented wording or readiness disagreement cannot license close coaching',()=>{
 const facts=F.finish(context,read,read);assert.equal(F.allows({section:'close',move:'tying back in'},facts,context),true);
 for(const other of [{decisions:[]},{decisions:[{...read.decisions[0],state:'ready'}]},{decisions:[{...read.decisions[0],evidence:[{turn:1,quote:'Invented purchase request.'},{turn:2,quote:context.turns[1].text}]}]}])assert.equal(F.allows({section:'close',move:'tying back in'},F.finish(context,read,other),context),false);
 assert.equal(F.allows({section:'close',move:'tying back in'},facts,{...context,hash:'changed'}),false);
});
test('no recorded decision allows discovery coaching but cannot become close coaching; ready buyers do not need more tying back',()=>{
 const none=F.finish(context,{decisions:[]},{decisions:[]});assert.equal(F.allows({section:'discovery',move:'digging for pain'},none,context),true);assert.equal(F.allows({section:'close',move:'asking for the sale'},none,context),false);assert.equal(F.allows({section:'close',move:'booking the follow-up'},none,context),true);
 const ready={decisions:[{...read.decisions[0],state:'ready'}]};assert.equal(F.allows({section:'close',move:'tying back in'},F.finish(context,ready,ready),context),false);
});
test('a decision can be evidenced by the prospect’s own consecutive turns, and one invalid exchange does not erase a valid one',()=>{
 const c={hash:'buyer',turns:[{speaker:'PROSPECT',text:'I need to discuss this.',time:1},{speaker:'PROSPECT',text:'Then I can decide whether to buy.',time:2}]};const d={state:'undecided',evidence:[{turn:1,quote:c.turns[0].text},{turn:2,quote:c.turns[1].text}]};
 const mixed={decisions:[d,{...d,evidence:[{turn:999,quote:'Invented.'}]}]};assert.equal(F.allows({section:'close',move:'tying back in'},F.finish(c,mixed,{decisions:[d]}),c),true);
});
test('uncertain purchase-stage evidence cannot erase an independently reviewable discovery or scheduling opportunity',()=>{
 const unknown=F.finish(context,{decisions:[{state:'ready',evidence:[{turn:1,quote:'Not in recording.'},{turn:2,quote:'Invented.'}]}]},{decisions:[]});assert.equal(unknown.status,'unknown');
 assert.equal(F.allows({section:'discovery',move:'uncovering goals'},unknown,context),true);assert.equal(F.allows({section:'close',move:'booking the follow-up'},unknown,context),true);
 assert.equal(F.allows({section:'close',move:'asking for the sale'},unknown,context),false);assert.equal(F.allows({section:'discovery',move:'tying back in'},unknown,context),false);
});
