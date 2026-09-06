'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fnBody,stripComments}=require('./helpers/strip-comments');
const page=stripComments(fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8'));
function harness(view='team-coaching') {
 const functions=['applyHashToState','onRouteChange','resetTeamData'].map(n=>fnBody(page,n)).join('\n');
 return new Function(functions+`
 const state={me:{},view:${JSON.stringify(view)},teamRanges:{coaching:{from:'2026-09-04',to:'2026-09-04'}},teamRangeInit:{},teamCoachable:{from:'2026-09-04',reps:['old']},teamCoachableLoading:true};
 const window={location:{hash:'#team-coaching?from=2026-08-08&to=2026-09-06'},scrollTo(){}};
 const TEAM_LANE_SCOPE={teamCoachable:'range'};let teamEpoch=7;let rendered;
 function loadRepFilter(){} function isTeamView(v){return v.startsWith('team');}
 function teamRangePage(){return 'coaching';} function teamRange(){return state.teamRanges.coaching;}
 function parseRangeFromHash(h){let q=new URLSearchParams(h.split('?')[1]);return q.has('from')?{from:q.get('from'),to:q.get('to')}:null;}
 function render(){rendered={range:teamRange(),data:state.teamCoachable,loading:state.teamCoachableLoading,epoch:teamEpoch};}
 function loadCallReview(){}
 return {run(){onRouteChange();return rendered;},setHash(h){window.location.hash=h;}};
 `)();
}
test('changing the team coaching URL range clears old results and invalidates pending responses before rendering',()=>{
 const result=harness().run();assert.equal(result.data,null);assert.equal(result.loading,false);assert.equal(result.epoch,8);assert.equal(result.range.from,'2026-08-08');
});
test('returning from a call review refreshes period data, while an unchanged coaching hash preserves it',()=>{
 assert.equal(harness('call-review').run().data,null);
 const h=harness();h.setHash('#team-coaching?from=2026-09-04&to=2026-09-04');assert.deepEqual(h.run().data.reps,['old']);
});
