'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/coaching-action-record');
const contexts=[{fullCall:false,hash:'context-a',turns:[{speaker:'PROSPECT',text:'I need to think.'},{speaker:'CLOSER',text:'About the model?'},{speaker:'CLOSER',text:'What is going through your head?'},{speaker:'PROSPECT',text:'I am weighing these two options.'},{speaker:'CLOSER',text:'Why choose this one?'}]}];
test('code pairs actual speaker runs without summarizing or dropping any turn',()=>{
 assert.equal(typeof R.buildRecords,'function');
 const record=R.buildRecords(contexts)[0];
 assert.equal(record.scope,'excerpt');assert.equal(record.context_hash,'context-a');
 assert.deepEqual(record.prelude.map(t=>t.turn),[1]);
 assert.deepEqual(record.exchanges[0].closer.map(t=>t.turn),[2,3]);
 assert.deepEqual(record.exchanges[0].prospect.map(t=>t.turn),[4]);
 assert.equal(record.exchanges[0].closer[1].text,contexts[0].turns[2].text);
 assert.deepEqual(record.exchanges[1].prospect,[]);
 const all=[...record.prelude,...record.exchanges.flatMap(e=>[...e.closer,...e.prospect])];
 assert.deepEqual(all.map(t=>t.text),contexts[0].turns.map(t=>t.text));
 assert.ok(record.exchanges.every(e=>!('action' in e)&&!('response' in e)));
});
test('the source scope is carried independently of how many pairs were formed',()=>{
 assert.equal(typeof R.buildRecords,'function');
 assert.equal(R.buildRecords([{...contexts[0],fullCall:true}])[0].scope,'full_call');
 assert.equal(R.buildRecords([{...contexts[0],turns:[]}])[0].exchanges.length,0);
});
const C=require('../lib/coaching');
test('evidence-first writing excludes prior interpretations but keeps the quote and team guidance',()=>{
 const prompt=C.buildCoachingPrompt([{quote:'I need to think.',observation:'UNSUPPORTED_OLD_OBSERVATION',closerResponse:'TRUNCATED_SAVED_REPLY'}],{actionRecords:[{moment:1,scope:'excerpt',exchanges:[]}],later:'UNSUPPORTED_OLD_SUMMARY',sellingContext:'TEAM_GUIDANCE',outcome:'follow_up'});
 assert.ok(!prompt.includes('UNSUPPORTED_OLD_OBSERVATION'));
 assert.ok(!prompt.includes('UNSUPPORTED_OLD_SUMMARY'));
 assert.ok(!prompt.includes('TRUNCATED_SAVED_REPLY'));
 assert.ok(prompt.includes('I need to think.'));assert.ok(prompt.includes('TEAM_GUIDANCE'));assert.ok(prompt.includes('ACTION / ANSWER'));
});
