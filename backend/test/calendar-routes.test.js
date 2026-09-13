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
    { user_id: 'manager', role: 'manager', first_name: 'Manager', active: true },
    { user_id: 'rep', managed_by: 'manager', role: 'user', first_name: 'Closer', active: true },
    { user_id: 'outsider', managed_by: 'someone-else', role: 'user', active: true },
  ] });
  const reads = [];
  const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://www.scoutsystems.io/calendar/callback', key: Buffer.alloc(32, 7).toString('base64') };
  const google = {
    exchange: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: SCOPES.join(' ') }),
    calendars: async () => [{ id: 'primary@example.com', name: 'Primary', time_zone: 'America/New_York', primary: true }],
    events: async () => ['Jordan Prospect', 'Internal team meeting', 'Dentist'].map((summary, index) => ({ id: String(index), summary,
      description: index === 0 ? 'Created from GHL' : '', organizer: { email: 'owner@example.com', self: true },
      start: { dateTime: '2026-09-10T14:00:00Z' }, end: { dateTime: '2026-09-10T15:00:00Z' } })),
  };
  const service = full ? createCalendarService(db, google, config) : {
    status: async id => ({ connected: false, user_id: id }),
    begin: async () => ({ state: 'a'.repeat(43), url: 'https://accounts.google.com/example' }),
    complete: async () => { reads.push('completed'); },
    disconnect: async id => { reads.push(['disconnect', id]); },
    inspect: async (id, range) => { reads.push({ id, range }); return { ...range, calendar: { name: 'Primary', time_zone: 'America/New_York' }, event_count: 0, events: [] }; },
  };
  const app = express();
  app.use(express.json());
  app.use('/calendar', createCalendarRouter({ admin: () => db, service: () => service, config: () => config,
    authenticate: (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).json({ error: 'unauthenticated' });
      const role = req.headers.authorization === 'manager' ? 'manager' : 'user';
      req.user = { id: role === 'manager' ? 'manager' : 'rep', role };
      req.userProfileRole = role;
      next();
    } }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = 'http://127.0.0.1:' + listener.address().port + '/calendar';
  return { url, reads, db };
}

test('inspection requires auth and always reads only the connected Scout user', async t => {
  const { url, reads } = await server(t);
  assert.equal((await fetch(url + '/inspection?from=2026-09-07&to=2026-09-11')).status, 401);
  const response = await fetch(url + '/inspection?from=2026-09-07&to=2026-09-11&user_id=outsider', { headers: { Authorization: 'rep' } });
  assert.equal(response.status, 200);
  assert.deepEqual(reads, [{ id: 'rep', range: { from: '2026-09-07', to: '2026-09-11' } }]);
});

test('real HTTP workflow connects and privately inspects mixed primary-calendar metadata without saving it', async t => {
  const { url, db } = await server(t, true);
  const headers = { Authorization: 'rep', 'Content-Type': 'application/json' };
  const connecting = await fetch(url + '/connect', { method: 'POST', headers, body: '{}' });
  const state = new URL((await connecting.json()).url).searchParams.get('state');
  const callback = await fetch(url + '/callback?code=sample&state=' + state, { redirect: 'manual', headers: { Cookie: 'scout_calendar_state=' + state } });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/calendar.html?connected=1');
  const result = await (await fetch(url + '/inspection?from=2026-09-07&to=2026-09-11&user_id=outsider', { headers })).json();
  assert.equal(result.event_count, 3);
  assert.deepEqual(new Set(result.events.map(event => event.title)), new Set(['Jordan Prospect', 'Internal team meeting', 'Dentist']));
  const prospect = result.events.find(event => event.title === 'Jordan Prospect');
  assert.equal(prospect.description, 'Created from GHL');
  assert.equal(prospect.organizer.email, 'owner@example.com');
  assert.doesNotMatch(JSON.stringify(result), /sales_call|is_sales|access_token|refresh_token/);
  const connection = db.tables.google_calendar_connections[0];
  assert.equal(connection.snapshot, null);
  assert.equal(connection.calendar_id, null);
  assert.equal(connection.title_contains, null);
});

test('the former team, schedule, preview and selection publishing routes are absent', async t => {
  const { url, reads } = await server(t);
  for (const request of [
    [url + '/team?from=2026-09-07&to=2026-09-11', { headers: { Authorization: 'manager' } }],
    [url + '/schedule?from=2026-09-07&to=2026-09-11', { headers: { Authorization: 'rep' } }],
    [url + '/calendars', { headers: { Authorization: 'rep' } }],
    [url + '/preview', { method: 'POST', headers: { Authorization: 'rep', 'Content-Type': 'application/json' }, body: '{}' }],
    [url + '/selection', { method: 'POST', headers: { Authorization: 'rep', 'Content-Type': 'application/json' }, body: '{}' }],
  ]) assert.equal((await fetch(...request)).status, 404);
  assert.deepEqual(reads, []);
});

test('callback refuses missing or different browser binding before exchanging code', async t => {
  const { url, reads } = await server(t);
  const path = '/callback?code=x&state=' + 'a'.repeat(43);
  assert.equal((await fetch(url + path, { redirect: 'manual' })).status, 400);
  assert.equal((await fetch(url + path, { redirect: 'manual', headers: { Cookie: 'scout_calendar_state=' + 'b'.repeat(43) } })).status, 400);
  assert.equal(reads.length, 0);
  const connected = await fetch(url + path, { redirect: 'manual', headers: { Cookie: 'scout_calendar_state=' + 'a'.repeat(43) } });
  assert.equal(connected.status, 302);
  assert.deepEqual(reads, ['completed']);
});

test('connect uses the configured www host and secure browser-bound state; inspection ranges are bounded', async t => {
  const { url, reads } = await server(t);
  const status = await (await fetch(url + '/status', { headers: { Authorization: 'rep' } })).json();
  assert.equal(status.connect_origin, 'https://www.scoutsystems.io');
  assert.equal(status.can_view_team, undefined);
  const response = await fetch(url + '/connect', { method: 'POST', headers: { Authorization: 'rep', Origin: 'https://www.scoutsystems.io' } });
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal((await fetch(url + '/inspection?from=2026-09-01&to=2026-09-15', { headers: { Authorization: 'rep' } })).status, 400);
  assert.equal(reads.length, 0);
});

test('OAuth cannot start on a different host from its registered callback', async t => {
  const { url } = await server(t);
  const response = await fetch(url + '/connect', { method: 'POST', headers: { Authorization: 'rep', Origin: 'https://other.example.com' } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'calendar_origin_mismatch');
});
