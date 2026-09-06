'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/coaching');
test('generated call-ending wording is corrected before review without changing deal outcomes or source input',()=>{
 const entry={moment:1,coaching:'The call closed open with a family discussion outstanding. The deal has not closed.',quote:'The call closed open.'};
 const [actual]=C.enforceHardRules([entry],{});
 assert.equal(actual.coaching,'The call ended open with a family discussion outstanding. The deal has not closed.');
 assert.equal(actual.quote,entry.quote);assert.equal(entry.coaching,'The call closed open with a family discussion outstanding. The deal has not closed.');
 assert.equal(C.enforceHardRules([{moment:1,coaching:'This call closed with a follow-up booked.'}],{})[0].coaching,'This call ended with a follow-up booked.');
 assert.equal(C.enforceHardRules([{moment:1,coaching:'The deal closed. Preserve that effective approach.'}],{})[0].coaching,'The deal closed. Preserve that effective approach.');
});
test('writer distinguishes a call ending from a won deal explicitly',()=>assert.match(C.buildCoachingPrompt([],{}),/call ended.*closed.*won deal/i));
