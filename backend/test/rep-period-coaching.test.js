'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../lib/rep-period-coaching');
const calls=[{id:'a',call_date:'2026-09-01T12:00:00Z',analysis_status:'done',analysis:{discovery_score:20,pitch_score:70,close_score_earned:80}},{id:'b',call_date:'2026-09-02T12:00:00Z',analysis_status:'done',analysis:{discovery_score:100,pitch_score:70,close_score_earned:10}}];
test('period focus changes with the selected calls, without rounding or treating missing sections as zero',()=>{
 assert.equal(P.summarize(calls,[],{from:'2026-09-01',to:'2026-09-01T23:59:59Z'}).section,'discovery');
 assert.equal(P.summarize(calls,[],{from:'2026-09-01',to:'2026-09-02T23:59:59Z'}).section,'close');
 assert.equal(P.summarize([],[],{from:'2026-09-01',to:'2026-09-02'}).status,'no_calls');
});
test('counts distinct evidenced calls, names coverage, and never treats an unreviewed call as a negative',()=>{
 const example={call_id:'a',section:'discovery',move:'qualifying financially',observation:'Financial resources remained unresolved in the exchange.',recommendation:'Establish the available resources.',evidence:[{quote:'A real excerpt'}]};
 const result=P.summarize(calls,[example,example,{...example,call_id:'outside'}],{from:'2026-09-01',to:'2026-09-01T23:59:59Z'});
 assert.equal(result.patterns[0].calls,1);assert.equal(result.calls,1);assert.equal(result.patterns[0].examples.length,1);
});
test('uses earned close scores and exposes exact ties rather than a fabricated separation',()=>{const result=P.summarize([{id:'a',call_date:'2026-09-01',analysis_status:'done',analysis:{discovery_score:40,close_score:100,close_score_earned:40}}],[],{from:'2026-09-01',to:'2026-09-02'});assert.deepEqual(result.tied_sections,['discovery','close']);assert.equal(result.sections.find(s=>s.section==='close').score,40);});
