'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {renderComputed} = require('./helpers/electron-render');
const web = path.join(__dirname, '../web');
function fixture() {
  const file = path.join(web, 'team-calendar.html');
  assert.ok(fs.existsSync(file), 'manager schedule page exists');
  return fs.readFileSync(file,'utf8').replace(/<link[^>]+href="\/css\/[^>]+>/g,'')
    .replace('<script src="/js/scout-auth.js"></script>', `<script>
    window.__requests=[];window.__hold=false;window.__release=null;
    window.ScoutAuth={getSession:()=>({}),authHeader:()=>({Authorization:'Bearer test'})};
    window.fetch=async function(url){window.__requests.push(url);
      if(url==='/team/context')return {ok:true,json:async()=>({role:'owner',teams:[{key:'team-a',label:'Team A'},{key:'team-b',label:'Team B'}]})};
      if(window.__hold){await new Promise(r=>{window.__release=r})}
      const team=new URL(url,'https://test').searchParams.get('team');
      return {ok:true,json:async()=>({from:'2026-09-13',to:'2026-09-19',team_label:team||'Team A',members:[
        {user_id:'a',name:'Ava <img src=x>',status:'ready',count:29},
        {user_id:'b',name:'Bea',status:'ready',count:0},
        {user_id:'c',name:'Cam',status:'not_sharing'},
        {user_id:'d',name:'Drew',status:'not_connected'},
        {user_id:'e',name:'Eli',status:'unavailable'},
        {user_id:'f',name:'Fran',status:'unsupported'}]})};
    };</script>`)
    .replace('<script src="/js/scout-team-calendar.js" defer></script>', '<script>'+fs.readFileSync(path.join(web,'js/scout-team-calendar.js'),'utf8')+'</script>')
    .replace('</head>','<style>'+fs.readFileSync(path.join(web,'css/style.css'),'utf8')+fs.readFileSync(path.join(web,'css/calendar.css'),'utf8')+'</style></head>');
}
for(const width of [1400,390]) test('team schedule renders counts, honest states and date/team changes at '+width,()=>{
  const result=renderComputed(fixture(),`(async()=>{
    await new Promise(r=>setTimeout(r,60));
    const results=document.getElementById('teamCalendarResults');
    const initial=results.textContent;const injected=!!results.querySelector('img');
    document.getElementById('teamCalendarFrom').value='2026-09-07';
    document.getElementById('teamCalendarTo').value='2026-09-12';
    document.getElementById('teamCalendarTeam').value='team-b';
    document.getElementById('teamCalendarRange').requestSubmit();
    await new Promise(r=>setTimeout(r,60));
    return {initial,injected,requests:window.__requests,overflow:document.documentElement.scrollWidth>innerWidth,text:results.textContent};
  })()`,{width});
  assert.match(result.initial,/Ava <img src=x>/);
  assert.match(result.initial,/29/);
  assert.match(result.initial,/Bea\s*0/);
  assert.match(result.initial,/Not shared/);
  assert.match(result.initial,/Not connected/);
  assert.match(result.initial,/Temporarily unavailable/);
  assert.match(result.initial,/Not available for this team/);
  assert.equal(result.injected,false);
  assert.equal(result.overflow,false);
  assert.ok(result.requests.some(url=>url.includes('from=2026-09-07')&&url.includes('to=2026-09-12')&&url.includes('team=team-b')));
  assert.match(result.text,/team-b/);
});

test('changing the visible dates clears old counts until refreshed',()=>{
  const result=renderComputed(fixture(),`(async()=>{
    await new Promise(r=>setTimeout(r,60));
    const date=document.getElementById('teamCalendarFrom');date.value='2026-09-14';date.dispatchEvent(new Event('change'));
    return document.getElementById('teamCalendarResults').textContent;
  })()`,{width:390});
  assert.doesNotMatch(result,/29/);
  assert.match(result,/Refresh/);
});
