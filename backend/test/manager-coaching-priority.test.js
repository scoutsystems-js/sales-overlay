'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../lib/manager-coaching-priority.js');
const P=fs.existsSync(file)?require(file):{};
const calls=Array.from({length:8},(_,i)=>({id:'c'+i,prospect_name:'Prospect '+i,user_id:'rep',closer_name:'Closer A',call_date:'2026-09-05T12:00:00Z'}));
const example=id=>({call_id:id,highlight_id:'h'+id,quote:'An exact verified excerpt.',clip_url:'https://example.test/clip/'+id});
const options={topic:{id:'booking_follow_up',title:'Drill booking the follow-up'},calls,assessedCallIds:calls.map(c=>c.id),examples:[example('c0'),example('c1'),example('c2')],from:'2026-09-05T00:00:00Z',to:'2026-09-05T23:59:59Z'};
test('three calls with repeated excerpts still count as three of eight',()=>{
 assert.equal(typeof P.summarizePriority,'function');
 const p=P.summarizePriority({...options,examples:[...options.examples,example('c0')],calls:[...calls,calls[0]]});
 assert.equal(p.matching_calls,3);assert.equal(p.total_calls,8);assert.equal(p.coverage_complete,true);assert.equal(p.frequency,'3 of 8 calls');
 assert.equal(p.examples[0].prospect_name,'Prospect 0');assert.equal(p.examples[0].closer_name,'Closer A');assert.equal(p.examples[0].owner_user_id,'rep');assert.equal(p.examples[0].clip_url,'https://example.test/clip/c0');
});
test('unassessed calls remain visible and never become negative findings',()=>{
 assert.equal(typeof P.summarizePriority,'function');
 const p=P.summarizePriority({...options,assessedCallIds:['c0','c1','c2','c3','c4']});
 assert.equal(p.assessed_calls,5);assert.equal(p.unassessed_calls,3);assert.equal(p.coverage_complete,false);assert.notEqual(p.frequency,'3 of 8 calls');
 assert.match(p.frequency,/3 evidenced calls/);assert.match(p.frequency,/5 of 8 assessed/);
});
test('an example cannot contribute unless the call was assessed and belongs to this scope',()=>{
 assert.equal(typeof P.summarizePriority,'function');
 const p=P.summarizePriority({...options,assessedCallIds:['c0'],examples:[example('c0'),example('c1'),example('foreign')]});
 assert.equal(p.matching_calls,1);assert.equal(p.examples.length,1);
});
test('missing clip or quote cannot support a manager example; names have honest fallbacks',()=>{
 assert.equal(typeof P.summarizePriority,'function');
 const p=P.summarizePriority({...options,calls:[{...calls[0],prospect_name:null,closer_name:null}],examples:[example('c0'),{...example('c0'),quote:null},{...example('c0'),clip_url:null}]});
 assert.equal(p.matching_calls,1);assert.equal(p.examples[0].prospect_name,'Unknown prospect');assert.equal(p.examples[0].closer_name,'Unknown closer');
});
test('the specific issue retains its Close section without treating that section as proof of a match',()=>{
 const p=P.summarizePriority({...options,topic:{...options.topic,section:'close'},examples:[]});
 assert.equal(p.topic.section,'close');assert.equal(p.matching_calls,0);
});
test('a claimed match without a usable clip is unassessed, not a negative observation',()=>{
 const p=P.summarizePriority({...options,examples:[example('c0'),{...example('c1'),clip_url:'javascript:alert(1)'}]});
 assert.equal(p.matching_calls,1);assert.equal(p.assessed_calls,7);assert.equal(p.coverage_complete,false);
});
test('scope exclusions apply before both numerator and denominator',()=>{
 const excluded=[{...calls[3],not_a_sales_call:true},{...calls[4],duplicate_of:'c0'},{...calls[5],fathom_call_id:'seed-example'},{...calls[6],user_id:'other-rep'},{...calls[7],call_date:'2026-09-04T12:00:00Z'}];
 const p=P.summarizePriority({...options,calls:[...calls.slice(0,3),...excluded],memberIds:['rep']});
 assert.equal(p.total_calls,3);assert.equal(p.matching_calls,3);assert.equal(p.frequency,'3 of 3 calls');
});
