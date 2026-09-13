'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCalendarRouter } = require('../routes/calendar');
const { calendarStore } = require('./helpers/calendar-store');
const { createCalendarService } = require('../lib/calendar-service');
const { SCOPES } = require('../lib/google-calendar');
async function server(t, full = false) {
  const db = calendarStore({ user_profiles: [
    { user_id: 'manager', role: 'manager', first_name: 'Manager' },
    { user_id: 'rep', managed_by: 'manager', role: 'user', first_name: 'Closer', active: true },
    { user_id: 'outsider', managed_by: 'someone-else', role: 'user' },
    { user_id: 'inactive', managed_by: 'manager', active: false },
  ] });
  const reads = [];
  const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/calendar/callback', key: Buffer.alloc(32, 7).toString('base64') };
  const google = {
    exchange: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: SCOPES.join(' ') }),
    calendars: async () => [{ id: 'mixed', name: 'Work', time_zone: 'America/New_York' }],
    events: async () => ['GHL Strategy Call', 'Internal team meeting', 'Dentist'].map((summary, i) => ({ id: String(i), summary,
      start: { dateTime: '2026-09-10T14:00:00Z' }, end: { dateTime: '2026-09-10T15:00:00Z' } })),
  };
  const service = full ? createCalendarService(db, google, config) : { status: async id => ({ connected: false, user_id: id }),
    begin: async () => ({ state: 'a'.repeat(43), url: 'https://accounts.google.com/example' }),
    complete: async () => { reads.push('completed'); }, select: async (...args) => { reads.push(args); },
    disconnect: async id => { reads.push(['disconnect', id]); },
    schedule: async id => { reads.push(id); return { count: 1, state: 'ready', appointments: [] }; },
  };
  const app = express(); app.use(express.json());
  app.use('/calendar', createCalendarRouter({ admin: () => db, service: () => service,
    config: () => config,
    authenticate: (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).json({ error: 'unauthenticated' });
      const role = req.headers.authorization === 'manager' ? 'manager' : 'user';
      req.user = { id: role === 'manager' ? 'manager' : 'rep', role }; req.userProfileRole = role; next();
    } }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = 'http://127.0.0.1:' + listener.address().port + '/calendar';
  return { url, reads, db };
}
test('HTTP routes require auth; self scope cannot be changed by user_id', async t => {
  const { url, reads } = await server(t);
  assert.equal((await fetch(url + '/status')).status, 401);
  const res = await fetch(url + '/schedule?from=2026-09-07&to=2026-09-11&user_id=outsider', { headers: { Authorization: 'rep' } });
  assert.equal(res.status, 200); assert.deepEqual(reads, ['rep']);
});

test('real HTTP workflow connects, previews a mixed calendar, saves the filter and serves its count', async t => {
  const { url, db } = await server(t, true);
  const headers = { Authorization: 'rep', 'Content-Type': 'application/json' };
  const connecting = await fetch(url + '/connect', { method: 'POST', headers });
  const state = new URL((await connecting.json()).url).searchParams.get('state');
  const callback = await fetch(url + '/callback?code=sample&state=' + state, { redirect: 'manual', headers: { Cookie: 'scout_calendar_state=' + state } });
  assert.equal(callback.status, 302);
  assert.equal((await (await fetch(url + '/status', { headers })).json()).connected, true);
  const selection = { calendar_id: 'mixed', title_contains: 'Strategy Call', from: '2026-09-07', to: '2026-09-11' };
  const preview = await fetch(url + '/preview', { method: 'POST', headers, body: JSON.stringify(selection) });
  assert.equal((await preview.json()).count, 1);
  const saved = await fetch(url + '/selection', { method: 'POST', headers, body: JSON.stringify({ ...selection, confirmed: true }) });
  assert.equal(saved.status, 200);
  const result = await (await fetch(url + '/schedule?from=2026-09-07&to=2026-09-11', { headers })).json();
  assert.equal(result.count, 1);
  assert.equal(result.appointments[0].title, 'GHL Strategy Call');
  assert.doesNotMatch(JSON.stringify(result), /Dentist|Internal team/);
  assert.ok(db.calls.filter(call => call.action !== 'select').every(call => call.table.startsWith('google_calendar_')));
});
test('manager route executes canonical team resolution, includes manager and excludes outsiders/inactive', async t => {
  const { url, reads } = await server(t);
  const path = '/team?from=2026-09-07&to=2026-09-11&team=someone-else';
  assert.equal((await fetch(url + path, { headers: { Authorization: 'rep' } })).status, 403);
  assert.equal(reads.length, 0);
  const res = await fetch(url + path, { headers: { Authorization: 'manager' } });
  assert.equal(res.status, 200);
  assert.deepEqual(reads.sort(), ['manager', 'rep']);
  assert.equal((await res.json()).reps.length, 2);
});
test('callback refuses missing/different browser binding before exchanging any code', async t => {
  const { url, reads } = await server(t);
  const path = '/callback?code=x&state=' + 'a'.repeat(43);
  assert.equal((await fetch(url + path, { redirect: 'manual' })).status, 400);
  assert.equal((await fetch(url + path, { redirect: 'manual', headers: { Cookie: 'scout_calendar_state=' + 'b'.repeat(43) } })).status, 400);
  assert.equal(reads.length, 0);
  const connected = await fetch(url + path, { redirect: 'manual', headers: { Cookie: 'scout_calendar_state=' + 'a'.repeat(43) } });
  assert.equal(connected.status, 302);
  assert.equal(connected.headers.get('location'), '/calendar.html?connected=1');
  assert.deepEqual(reads, ['completed']);
});
test('connect sets HttpOnly, Secure, SameSite browser state; bad ranges never trigger Google reads', async t => {
  const { url, reads } = await server(t);
  const res = await fetch(url + '/connect', { method: 'POST', headers: { Authorization: 'rep' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /Secure/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal((await fetch(url + '/schedule?from=bogus&to=2026-09-11', { headers: { Authorization: 'rep' } })).status, 400);
  assert.equal(reads.length, 0);
});

test('OAuth cannot start on a different host from its registered callback', async t => {
  const { url } = await server(t);
  const response = await fetch(url + '/connect', { method: 'POST', headers: { Authorization: 'rep', Origin: 'https://other.example.com' } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'calendar_origin_mismatch');
});
