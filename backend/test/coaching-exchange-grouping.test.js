'use strict';
/* BLOCK 014 (SCOUT-SHARED-CONTEXT.md; Justin's option B, H757) — THE CALL EXCHANGE, GROUPED WITH HONEST GAPS.
   A Call Example's "Read the call exchange" lists every cited turn as its own quote; on real data the lists run 8 to
   69 quotes (median 16) and a same-speaker run of five to fifteen fragments reads worst (Block 012). RENDER-TIME ONLY:
   a consecutive same-speaker run of MORE THAN THREE quotes becomes one paragraph headed by the speaker and the range
   first→last timestamp; adjacent quotes more than 60 s apart end any group and draw a visible gap marker, so a range
   never hides a hole in the call; a speaker change always starts a new quote or group; runs of three or fewer keep
   the individual layout; every word stays verbatim, in order, with its attribution. Nothing stored changes.
   Rendered in Electron with the page's real functions and stylesheet, because the property is what a manager sees. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fnBody,stripComments}=require('./helpers/strip-comments'),{renderComputed}=require('./helpers/electron-render');
const source=fs.readFileSync(path.join(__dirname,'../web/dashboard.html'),'utf8'),live=stripComments(source);
const rep={user_id:'a',name:'Ava'};
function ex(evidence){return {call_id:'call',call_date:'2026-09-01T12:00:00Z',section:'discovery',move:'uncovering goals',observation:'The observation.',recommendation:'The recommendation.',prospect_name:'Steve',outcome:'follow_up',source:'fathom',clip_url:'https://fathom.video/calls/real?t=4',evidence};}
const C=(q,t)=>({speaker:'CLOSER',quote:q,timestamp_seconds:t}),P=(q,t)=>({speaker:'PROSPECT',quote:q,timestamp_seconds:t});
const FUNCS=['coachingRepName','coachingPeriodExampleHtml','coachingExchangeHtml','coachingExchangeSegments','coachingExchangeGapLabel','formatTimestampDisplay'];
function page(example,funcsOverride){const funcs=(funcsOverride||FUNCS).map(n=>fnBody(live,n)).join('\n');return '<html><head>'+source.slice(source.indexOf('<style>'),source.indexOf('</style>')+8)+'</head><body data-view="team-coaching"><main class="page" id="content"><section class="coaching-rep-detail"></section></main><script>function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}function outcomeLabel(){return "Open";}function displayNameFromEmail(s){return s;}function openCallReview(){}'+funcs+';document.querySelector(".coaching-rep-detail").innerHTML=coachingPeriodExampleHtml('+JSON.stringify(example)+','+JSON.stringify(rep)+',{withNext:false});</script></body></html>';}
/* what a manager sees inside the exchange, in order: each block's kind, its heading, its body */
const PROBE=`(()=>{const d=document.querySelector('.coaching-exact-exchange');const wasOpen=d.open;d.open=true;
 const blocks=[...d.children].filter(el=>el.tagName!=='SUMMARY').map(el=>({tag:el.tagName,cls:el.className,head:(el.querySelector('span')||{}).innerText||null,body:el.tagName==='BLOCKQUOTE'?el.innerText.replace((el.querySelector('span')||{}).innerText||'','').trim():el.innerText.trim()}));
 return {wasOpen,blocks,text:d.innerText,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,scripts:document.querySelectorAll('#content script').length};})()`;

test('1 — four consecutive same-speaker quotes become ONE paragraph headed by the speaker and the first→last range; the exchange stays collapsed',()=>{
 const r=renderComputed(page(ex([C('one',361),C('two',372),C('three',390),C('four',403)])),PROBE);
 assert.equal(r.wasOpen,false,'collapsed by default');
 assert.equal(r.blocks.length,1,JSON.stringify(r.blocks));
 assert.equal(r.blocks[0].tag,'BLOCKQUOTE');assert.match(r.blocks[0].cls,/coaching-exchange-group/);
 assert.equal(r.blocks[0].head,'Ava · 6:01–6:43');
 assert.equal(r.blocks[0].body,'one two three four');
 assert.equal(r.scripts,0);
});
test('2 — three consecutive quotes keep the individual layout, each with its own timestamp',()=>{
 const r=renderComputed(page(ex([C('one',361),C('two',372),C('three',390)])),PROBE);
 assert.equal(r.blocks.length,3,JSON.stringify(r.blocks));
 assert.deepEqual(r.blocks.map(b=>b.head),['Ava · 6:01','Ava · 6:12','Ava · 6:30']);
 assert.deepEqual(r.blocks.map(b=>b.body),['one','two','three']);
 assert.ok(r.blocks.every(b=>!/coaching-exchange-group/.test(b.cls)),'no group for a run of three');
});
test('3 — a same-speaker gap over 60 s ends the run, draws a visible gap marker, and no range crosses it; exactly 60 s does not',()=>{
 const r=renderComputed(page(ex([C('a',10),C('b',20),C('c',30),C('d',40),C('e',1501),C('f',1510),C('g',1520),C('h',1530)])),PROBE);
 assert.equal(r.blocks.length,3,JSON.stringify(r.blocks));
 assert.equal(r.blocks[0].head,'Ava · 0:10–0:40');assert.equal(r.blocks[0].body,'a b c d');
 assert.match(r.blocks[1].cls,/coaching-exchange-gap/);assert.match(r.blocks[1].body,/24 min later/);
 assert.equal(r.blocks[2].head,'Ava · 25:01–25:30');assert.equal(r.blocks[2].body,'e f g h');
 const two=renderComputed(page(ex([C('a',10),C('b',20),C('c',80),C('d',90),C('e',151),C('f',160)])),PROBE);
 assert.equal(two.blocks.length,4,'a 60 s step (20→80) keeps the run; a 61 s step (90→151) breaks it — a run of 4, then the gap, then two individual quotes: '+JSON.stringify(two.blocks));
 assert.equal(two.blocks[0].head,'Ava · 0:10–1:30');assert.equal(two.blocks[0].body,'a b c d');
 assert.match(two.blocks[1].cls,/coaching-exchange-gap/);assert.match(two.blocks[1].body,/1 min 1 s later/);
 assert.equal(two.blocks[2].head,'Ava · 2:31');assert.equal(two.blocks[2].body,'e');
 assert.equal(two.blocks[3].head,'Ava · 2:40');assert.equal(two.blocks[3].body,'f');
});
test('3b — a gap between two SHORT runs still draws the marker and never merges them',()=>{
 const r=renderComputed(page(ex([C('a',10),C('b',20),C('c',500),C('d',505)])),PROBE);
 assert.deepEqual(r.blocks.map(b=>b.cls.includes('coaching-exchange-gap')?'GAP':b.head),['Ava · 0:10','Ava · 0:20','GAP','Ava · 8:20','Ava · 8:25']);
 assert.match(r.blocks[2].body,/8 min later/);
});
test('4 — a speaker change always starts a new quote or group; nothing is merged across speakers',()=>{
 const r=renderComputed(page(ex([P('p1',361),P('p2',370),P('p3',380),P('p4',403),C('c1',415),C('c2',420),P('q1',442),P('q2',450),P('q3',455),P('q4',456),P('q5',460),P('q6',462)])),PROBE);
 assert.deepEqual(r.blocks.map(b=>[b.head,b.body]),[['Steve · 6:01–6:43','p1 p2 p3 p4'],['Ava · 6:55','c1'],['Ava · 7:00','c2'],['Steve · 7:22–7:42','q1 q2 q3 q4 q5 q6']]);
});
test('5 — every quote stays verbatim and in order, escaped, whichever layout it lands in',()=>{
 const quotes=[C('So <what> are you "gonna" do?',10),C('Right & fair.',20),C('Third.',30),C('Fourth.',40),P('I need to think.',45),C('Take your time.',200)];
 const r=renderComputed(page(ex(quotes)),PROBE);
 let at=-1;for(const q of quotes){const i=r.text.indexOf(q.quote,at+1);assert.ok(i>at,'missing or out of order: '+q.quote);at=i;}
 assert.equal((r.text.match(/Fourth\./g)||[]).length,1,'no duplication');
 for(const width of [1400,390]){const w=renderComputed(page(ex(Array.from({length:69},(_,i)=>(i%9<5?C:P)('quote number '+i+' with a sentence of ordinary length so the paragraph wraps like a real one.',100+i*7)))),PROBE,{width});assert.equal(w.overflow,false,'width '+width);}
});
test('6 — the Call Example path USES the grouping helper and KEEPS its result (a stub sentinel must reach the page)',()=>{
 const shell=fnBody(live,'coachingPeriodExampleHtml')+'\nfunction coachingRepName(r){return r.name;}function coachingExchangeHtml(){return "<i id=\\"SENTINEL\\">GROUPED</i>";}function escapeHtml(s){return String(s);}function outcomeLabel(o){return o;}';
 const html=new Function(shell+'\nreturn coachingPeriodExampleHtml('+JSON.stringify(ex([C('one',1),C('two',2)]))+','+JSON.stringify(rep)+',{withNext:false});')();
 assert.match(html,/<i id="SENTINEL">GROUPED<\/i>/,'coachingPeriodExampleHtml must render the exchange through coachingExchangeHtml');
 assert.doesNotMatch(html,/<blockquote>/,'the old per-quote map must be gone from the path');
});
