'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderComputed } = require('./helpers/electron-render');
const web = path.join(__dirname, '../web');
function html() {
  const source = fs.readFileSync(path.join(web, 'calendar.html'), 'utf8');
  return source.replace(/<link[^>]+href="\/css\/[^>]+>/g, '')
    .replace('<script src="/js/scout-auth.js"></script>', `<script>window.ScoutAuth={getSession:()=>({access_token:'test'}),authHeader:()=>({Authorization:'Bearer test'})};
    window.fetch=async function(url){let data=url.includes('/preview')?{count:1,appointments:[{id:'one',title:'Sales call',start:'2026-09-10T14:00:00Z'}],calendar:{name:'Sales',time_zone:'America/New_York'}}:url.includes('/status')?{configured:true,connected:true,calendar:{name:'Sales'},can_view_team:true}:
      url.includes('/team')?{team:{label:'Test team'},reps:[{name:'One Call Rep',state:'ready',count:1,calendar:{name:'Sales',time_zone:'America/New_York'},last_sync_at:new Date().toISOString(),appointments:[{id:'one',title:'<img src=x onerror=alert(1)>',start:'2026-09-10T14:00:00Z',end:'2026-09-10T15:00:00Z'}]},{name:'Disconnected Rep',state:'not_connected',count:null,appointments:[]}]}:
      url.includes('/calendars')?{calendars:[{id:'sales',name:'Sales',time_zone:'America/New_York'}]}:{state:'ready',count:1,calendar:{name:'Sales',time_zone:'America/New_York'},appointments:[]};return {ok:true,json:async()=>data}};</script>`)
    .replace('<script src="/js/scout-calendar.js" defer></script>', '<script>' + fs.readFileSync(path.join(web, 'js/scout-calendar.js'), 'utf8') + '</script>')
    .replace('</head>', '<style>' + fs.readFileSync(path.join(web, 'css/style.css'), 'utf8') + fs.readFileSync(path.join(web, 'css/calendar.css'), 'utf8') + '</style></head>');
}
for (const width of [1400, 390]) test('calendar page renders and operates at ' + width + 'px', () => {
  const result = renderComputed(html(), `(async()=>{
    await new Promise(r=>setTimeout(r,80));
    document.getElementById('calendarScope').value='team';
    document.getElementById('calendarRange').dispatchEvent(new Event('submit',{cancelable:true}));
    await new Promise(r=>setTimeout(r,80));
    const text=document.getElementById('calendarResults').textContent;
    const disclosure=document.querySelector('#calendarResults details');
    disclosure.querySelector('summary').click();
    return {text,overflow:document.documentElement.scrollWidth>innerWidth,open:disclosure.open,injected:!!document.querySelector('#calendarResults img')};
  })()`, { width });
  assert.match(result.text, /One Call Rep/);
  assert.match(result.text, /1 scheduled call/);
  assert.match(result.text, /Disconnected Rep/);
  assert.match(result.text, /Calendar not connected/);
  assert.equal(result.open, true);
  assert.equal(result.injected, false);
  assert.equal(result.overflow, false);
});

test('mixed calendar setup requires a preview and invalidates it when the filter changes', () => {
  const result = renderComputed(html(), `(async()=>{
    await new Promise(r=>setTimeout(r,80));
    document.getElementById('calendarSetup').open=true;
    document.getElementById('googleChoose').click();
    await new Promise(r=>setTimeout(r,80));
    document.querySelector('input[name="calendar"]').checked=true;
    const filter=document.getElementById('calendarTitleFilter'); filter.value='Sales call';
    document.getElementById('calendarPreviewButton').click();
    await new Promise(r=>setTimeout(r,80));
    const before=document.getElementById('calendarPreview').textContent;
    const enabled=!document.getElementById('calendarSave').disabled;
    filter.value='Team meeting'; filter.dispatchEvent(new Event('input',{bubbles:true}));
    return {before,enabled,disabled:document.getElementById('calendarSave').disabled,hidden:document.getElementById('calendarConfirmation').hidden};
  })()`, { width: 390 });
  assert.match(result.before, /1 scheduled call/);
  assert.equal(result.enabled, true);
  assert.equal(result.disabled, true);
  assert.equal(result.hidden, true);
});
