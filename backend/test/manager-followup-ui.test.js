'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fnBody,stripComments}=require('./helpers/strip-comments'),{renderComputed}=require('./helpers/electron-render');
const source=fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8'),live=stripComments(source);
const example={call_id:'c1',owner_user_id:'rep',prospect_name:'Pat <script>',closer_name:'Closer',outcome:'follow_up',source:'fathom',clip_url:'https://fathom.video/calls/example?t=100',evidence:[{speaker:'CLOSER',quote:'Call me over the weekend.',timestamp_seconds:100},{speaker:'PROSPECT',quote:'Yes, I will call you.',timestamp_seconds:105}]};
const priority={topic:{title:'Drill booking the follow-up'},matching_calls:1,assessed_calls:3,total_calls:8,unassessed_calls:5,frequency:'1 evidenced calls · 3 of 8 assessed',coverage_complete:false,from:'2026-09-01',to:'2026-09-05',examples:[example]};
test('manager card shows scope, named evidence, outcome and owner-aware links at desktop/mobile widths',()=>{
 assert.match(live,/function managerFollowupHtml\(/);
 const fn=fnBody(live,'managerFollowupHtml');
 for(const width of [1400,390]){
 const html='<html><head>'+source.slice(source.indexOf('<style>'),source.indexOf('</style>')+8)+'</head><body data-view="team-coaching"><main id="host" class="page team-coaching-workspace"></main><script>function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function outcomeLabel(){return "Open";}function formatTimestampDisplay(){return "01:40";}function openCallReview(c,u){window.opened=[c,u];}'+fn+';document.querySelector("#host").innerHTML=managerFollowupHtml('+JSON.stringify(priority)+');</script></body></html>';
 const r=renderComputed(html,`(()=>{document.querySelector('[data-priority-call]').click();return {text:document.body.innerText,opened:window.opened,link:document.querySelector('a').href,overflow:document.documentElement.scrollWidth>innerWidth,scripts:document.querySelectorAll('#host script').length};})()`,{width});
 assert.equal(r.overflow,false);assert.equal(r.scripts,0);assert.deepEqual(r.opened,['c1','rep']);assert.match(r.text,/Drill booking/);assert.match(r.text,/3 of 8 assessed/);assert.match(r.text,/Open/);assert.match(r.text,/Pat <script>/);assert.doesNotMatch(r.text,/Manager action|doctrine|knowledge base/);assert.equal(r.link,example.clip_url);
 }
});
