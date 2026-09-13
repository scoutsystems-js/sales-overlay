'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComputed } = require('./helpers/electron-render');
const web = path.join(__dirname, '../web');

function html(connected = true) {
  const source = fs.readFileSync(path.join(web, 'calendar.html'), 'utf8');
  return source.replace(/<link[^>]+href="\/css\/[^>]+>/g, '')
    .replace('<script src="/js/scout-auth.js"></script>', `<script>window.__inspectionCalls=0;window.ScoutAuth={getSession:()=>({access_token:'test'}),authHeader:()=>({Authorization:'Bearer test'})};
    window.fetch=async function(url){let data=url.includes('/inspection')?(window.__inspectionCalls++,{event_count:3,from:'2026-09-10',to:'2026-09-16',calendar:{name:'Primary',time_zone:'America/New_York'},events:[{title:'<img src=x onerror=alert(1)>',description:'Created from GHL',status:'confirmed',event_type:'default',start:'2026-09-10T14:00:00.000Z',end:'2026-09-10T15:00:00.000Z',all_day:false,organizer:{email:'owner@example.com',self:true},creator:{email:'owner@example.com',self:true},attendees:[{email:'prospect@example.com',response_status:'accepted'}],source:{title:'HighLevel appointment',host:'app.gohighlevel.com'},conference:{type:'hangoutsMeet',name:'Google Meet'},extended_property_keys:{private:['ghlAppointmentId'],shared:['source']},recurring:false},{title:'Dentist',status:'confirmed',event_type:'default',start:'2026-09-11',end:'2026-09-12',all_day:true,attendees:[],recurring:false},{title:'Internal team meeting',status:'confirmed',event_type:'default',start:'2026-09-12T14:00:00.000Z',end:'2026-09-12T15:00:00.000Z',all_day:false,attendees:[],recurring:false}]}):url.includes('/status')?{configured:true,connected:${connected},connect_origin:location.origin}:{ok:true,revoked:true};return {ok:true,json:async()=>data}};</script>`)
    .replace('<script src="/js/scout-calendar.js" defer></script>', '<script>' + fs.readFileSync(path.join(web, 'js/scout-calendar.js'), 'utf8') + '</script>')
    .replace('</head>', '<style>' + fs.readFileSync(path.join(web, 'css/style.css'), 'utf8') + fs.readFileSync(path.join(web, 'css/calendar.css'), 'utf8') + '</style></head>');
}

for (const width of [1400, 390]) test('private primary-calendar inspection renders safely at ' + width + 'px', () => {
  const result = renderComputed(html(), `(async()=>{
    await new Promise(resolve=>setTimeout(resolve,100));
    const text=document.getElementById('calendarResults').textContent;
    const disclosure=document.querySelector('#calendarResults details');
    disclosure.querySelector('summary').click();
    return {text,overflow:document.documentElement.scrollWidth>innerWidth,open:disclosure.open,
      injected:!!document.querySelector('#calendarResults img'),inspectionCalls:window.__inspectionCalls};
  })()`, { width });
  assert.match(result.text, /3 calendar events/);
  assert.match(result.text, /not a sales-call count/i);
  assert.match(result.text, /Dentist/);
  assert.match(result.text, /Internal team meeting/);
  assert.match(result.text, /Created from GHL/);
  assert.match(result.text, /owner@example.com/);
  assert.match(result.text, /app\.gohighlevel\.com/);
  assert.equal(result.open, true);
  assert.equal(result.injected, false);
  assert.equal(result.overflow, false);
  assert.equal(result.inspectionCalls, 1, 'connected owners inspect automatically on arrival');
});

test('clear private data-use copy appears before Connect and no classifier setup is offered', () => {
  const source = fs.readFileSync(path.join(web, 'calendar.html'), 'utf8');
  const result = renderComputed(html(false), `(async()=>{
    await new Promise(resolve=>setTimeout(resolve,80));
    return {text:document.body.textContent,connection:document.getElementById('calendarConnection').textContent,
      hasFilter:!!document.getElementById('calendarTitleFilter'),hasScope:!!document.getElementById('calendarScope'),inspectionCalls:window.__inspectionCalls};
  })()`, { width: 390 });
  assert.ok(source.indexOf('id="calendarDataUse"') < source.indexOf('id="calendarConnection"'));
  assert.match(result.text, /visible only to you/i);
  assert.match(result.text, /will not save event titles, descriptions, attendee details/i);
  assert.match(result.connection, /Connect Google Calendar/);
  assert.equal(result.hasFilter, false);
  assert.equal(result.hasScope, false);
  assert.equal(result.inspectionCalls, 0);
  assert.doesNotMatch(source, /Scheduled Calls|Team calls|sales appointment title/i);
});

test('My Team no longer publishes a scheduled-calendar entry', () => {
  const dashboard = fs.readFileSync(path.join(web, 'dashboard.html'), 'utf8');
  const start = dashboard.indexOf('function renderTeamMembersView()');
  const end = dashboard.indexOf('function teamMembersScope()', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(dashboard.slice(start, end), /calendar\.html|Scheduled Calls/);
});

test('Account Connect click starts Google directly after showing private read-only use', () => {
  const accountScript = fs.readFileSync(path.join(web, 'js/scout-calendar-account.js'), 'utf8');
  const page = `<!doctype html><html><body><div id="host"></div><script>
    window.__calls=[];window.__navigated=null;
    window.ScoutAuth={authHeader:()=>({Authorization:'Bearer test'})};
    window.fetch=async function(url,options){window.__calls.push({url:url,method:options&&options.method});
      return {ok:true,json:async()=>url.includes('/connect')?{url:'https://accounts.google.com/o/oauth2/v2/auth?state=safe'}:{connected:false}}};
    ${accountScript}
    window.ScoutCalendarAccount.mount(document.getElementById('host'),function(url){window.__navigated=url});
  </script></body></html>`;
  const result = renderComputed(page, `(async()=>{
    await new Promise(resolve=>setTimeout(resolve,30));
    const host=document.getElementById('host');const button=host.querySelector('button');button.click();
    await new Promise(resolve=>setTimeout(resolve,30));
    return {text:host.textContent,privacy:host.querySelector('a[href="/privacy.html"]')!=null,calls:window.__calls,navigated:window.__navigated};
  })()`, { width: 390 });
  assert.match(result.text, /read-only/i);
  assert.match(result.text, /private to you/i);
  assert.equal(result.privacy, true);
  assert.deepEqual(result.calls, [
    { url: '/calendar/status' },
    { url: '/calendar/connect', method: 'POST' },
  ]);
  assert.match(result.navigated, /^https:\/\/accounts\.google\.com\//);
});

test('Account Connect refuses a non-Google redirect returned by the server', () => {
  const accountScript = fs.readFileSync(path.join(web, 'js/scout-calendar-account.js'), 'utf8');
  const page = `<!doctype html><html><body><div id="host"></div><script>
    window.__navigated=null;window.ScoutAuth={authHeader:()=>({Authorization:'Bearer test'})};
    window.fetch=async function(url){return {ok:true,json:async()=>url.includes('/connect')?{url:'https://evil.example/phish'}:{connected:false}}};
    ${accountScript}
    window.ScoutCalendarAccount.mount(document.getElementById('host'),function(url){window.__navigated=url});
  </script></body></html>`;
  const result = renderComputed(page, `(async()=>{
    await new Promise(resolve=>setTimeout(resolve,30));document.querySelector('button').click();
    await new Promise(resolve=>setTimeout(resolve,30));return {text:document.getElementById('host').textContent,navigated:window.__navigated};
  })()`, { width: 390 });
  assert.equal(result.navigated, null);
  assert.match(result.text, /Could not start Google sign-in/);
});

test('a delayed inspection cannot redraw event details after Disconnect', () => {
  const source = fs.readFileSync(path.join(web, 'calendar.html'), 'utf8');
  const script = fs.readFileSync(path.join(web, 'js/scout-calendar.js'), 'utf8');
  const page = source.replace(/<link[^>]+href="\/css\/[^>]+>/g, '')
    .replace('<script src="/js/scout-auth.js"></script>', `<script>
      window.__connected=true;window.__release=null;window.ScoutAuth={getSession:()=>({access_token:'test'}),authHeader:()=>({Authorization:'Bearer test'})};
      window.scoutConfirm=async()=>true;
      window.fetch=async function(url,options){
        if(url.includes('/status'))return {ok:true,json:async()=>({configured:true,connected:window.__connected,connect_origin:location.origin})};
        if(options&&options.method==='DELETE'){window.__connected=false;return {ok:true,json:async()=>({ok:true,revoked:true})}};
        if(url.includes('/inspection')){await new Promise(resolve=>{window.__release=resolve});return {ok:true,json:async()=>({event_count:1,from:'2026-09-10',to:'2026-09-16',calendar:{name:'Primary',time_zone:'America/New_York'},events:[{title:'Private old event',status:'confirmed',event_type:'default',start:'2026-09-10T14:00:00.000Z',end:'2026-09-10T15:00:00.000Z',all_day:false,attendees:[],recurring:false}]})}};
        return {ok:true,json:async()=>({})};
      };</script>`)
    .replace('<script src="/js/scout-modal.js"></script>', '')
    .replace('<script src="/js/scout-calendar.js" defer></script>', '<script>'+script+'</script>')
    .replace('</head>', '<style>'+fs.readFileSync(path.join(web, 'css/style.css'),'utf8')+fs.readFileSync(path.join(web, 'css/calendar.css'),'utf8')+'</style></head>');
  const result = renderComputed(page, `(async()=>{
    for(let i=0;i<20&&!window.__release;i++)await new Promise(resolve=>setTimeout(resolve,10));
    document.getElementById('googleDisconnect').click();
    await new Promise(resolve=>setTimeout(resolve,40));
    window.__release();await new Promise(resolve=>setTimeout(resolve,40));
    return document.getElementById('calendarResults').textContent;
  })()`, { width: 390 });
  assert.match(result, /Connect Google Calendar to inspect events/);
  assert.doesNotMatch(result, /Private old event/);
});
