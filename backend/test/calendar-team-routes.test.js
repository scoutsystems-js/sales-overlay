'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createCalendarRouter } = require('../routes/calendar');
const { createCalendarService, SUPPORTED_CALENDAR_TEAM_ID } = require('../lib/calendar-service');
const { seal } = require('../lib/google-calendar');
const { calendarStore } = require('./helpers/calendar-store');

const MANAGER = '40616e16-a92b-45c4-99b8-b3d12e508bf6';
const REP = '00000000-0000-4000-8000-000000000001';
const PRIVATE_OWNER = '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1';
const OTHER_MANAGER = '00000000-0000-4000-8000-000000000002';
const OTHER_REP = '00000000-0000-4000-8000-000000000003';
const INACTIVE = '00000000-0000-4000-8000-000000000004';
const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://www.scoutsystems.io/calendar/callback', key: Buffer.alloc(32, 7).toString('base64') };
const range = '?from=2026-09-07&to=2026-09-11';

function connection(userId, sharing = {}) {
  return {
    user_id: userId,
    generation: '10000000-0000-4000-8000-' + userId.slice(-12),
    access_token_encrypted: seal('access-' + userId, userId, config.key),
    refresh_token_encrypted: seal('refresh-' + userId, userId, config.key),
    expires_at: '2099-01-01T00:00:00.000Z', connected_at: '2026-09-01T00:00:00.000Z',
    calendar_id: null, calendar_name: null, time_zone: null, title_contains: null,
    last_sync_at: null, last_sync_error: null, snapshot: null,
    share_scheduled_count: false, share_manager_id: null,
    ...sharing,
  };
}

function seed() {
  return {
    user_profiles: [
      { user_id: MANAGER, role: 'manager', managed_by: null, first_name: 'Josh', last_name: 'Pinner', team_name: 'Sober Living Riches', active: true },
      { user_id: REP, role: 'user', managed_by: MANAGER, first_name: 'Closer', last_name: 'One', active: true },
      { user_id: OTHER_MANAGER, role: 'manager', managed_by: null, first_name: 'Other', last_name: 'Manager', team_name: 'Other Team', active: true },
      { user_id: OTHER_REP, role: 'user', managed_by: OTHER_MANAGER, first_name: 'Outside', last_name: 'Rep', active: true },
      { user_id: INACTIVE, role: 'user', managed_by: MANAGER, first_name: 'Gone', last_name: 'Rep', active: false },
      { user_id: PRIVATE_OWNER, role: 'owner', managed_by: null, first_name: 'Scout', last_name: 'Admin', team_name: 'Scout Systems', active: true },
    ],
    google_calendar_connections: [
      connection(REP, { share_scheduled_count: true, share_manager_id: MANAGER }),
      connection(OTHER_REP, { share_scheduled_count: true, share_manager_id: OTHER_MANAGER }),
      connection(PRIVATE_OWNER),
    ],
  };
}

function ghlEvent(id) {
  return { id, status: 'confirmed', summary: 'Private prospect title', description: 'https://links.soberlivingriches.com/booking/123',
    extendedProperties: { private: { calendarId: 'calendar', eventId: 'event', linkedCalendarId: 'linked', userCalendarId: 'user-calendar', userId: 'user' } },
    start: { dateTime: '2026-09-10T14:00:00Z' }, end: { dateTime: '2026-09-10T15:00:00Z' } };
}

function google(overrides = {}) {
  return {
    exchange: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly' }),
    refresh: async () => ({ access_token: 'new-access', expires_in: 3600 }), revoke: async () => true,
    calendars: async () => [{ id: 'primary', name: 'Private primary name', time_zone: 'America/New_York', primary: true }],
    events: async token => [ghlEvent(token)],
    ...overrides,
  };
}

async function server(t, options = {}) {
  const db = calendarStore(options.seed || seed());
  const service = createCalendarService(db, options.google || google(), config);
  const app = express();
  app.use(express.json());
  app.use('/calendar', createCalendarRouter({
    admin: () => db, service: () => service, config: () => config,
    resolveTeam: options.resolveTeam,
    authenticate(req, res, next) {
      const id = req.headers.authorization;
      if (!id) return res.status(401).json({ error: 'unauthenticated' });
      const profile = db.tables.user_profiles.find(row => row.user_id === id);
      req.user = { id, role: profile?.role || 'user' };
      req.userProfileRole = profile?.role || 'user';
      next();
    },
  }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  return { db, service, url: 'http://127.0.0.1:' + listener.address().port + '/calendar' };
}

test('team counts execute the manager/owner gate and derive the active team server-side', async t => {
  const { url, db } = await server(t);
  assert.equal((await fetch(url + '/team' + range)).status, 401);
  db.calls.length = 0;
  assert.equal((await fetch(url + '/team' + range, { headers: { Authorization: REP } })).status, 403);
  assert.equal(db.calls.length, 0, 'a denied rep never reaches team or connection reads');

  const response = await fetch(url + '/team' + range + '&user_id=' + OTHER_REP, { headers: { Authorization: MANAGER } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.team_label, 'Sober Living Riches');
  assert.deepEqual(new Set(body.members.map(row => row.user_id)), new Set([MANAGER, REP]));
  assert.equal(body.members.find(row => row.user_id === MANAGER).status, 'not_connected');
  assert.equal(body.members.find(row => row.user_id === REP).status, 'ready');
  assert.equal(body.members.find(row => row.user_id === REP).count, 1);
  assert.equal(body.members.find(row => row.user_id === MANAGER).count, undefined);
});

test('manager response contains counts and states but no calendar or event details', async t => {
  const { url } = await server(t);
  const body = await (await fetch(url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /Private prospect|Private primary|links\.soberlivingriches|description|appointments|events|access-|refresh-/);
  assert.deepEqual(Object.keys(body.members.find(row => row.status === 'ready')).sort(), ['count', 'name', 'status', 'user_id']);
});

test('all-team owner view evaluates each current manager and never calls unsupported calendars a zero', async t => {
  const { url } = await server(t, { resolveTeam: async () => ({ keyId: PRIVATE_OWNER, memberIds: [REP, OTHER_REP, PRIVATE_OWNER], label: 'All users', mode: 'all' }) });
  const body = await (await fetch(url + '/team' + range + '&team=all', { headers: { Authorization: PRIVATE_OWNER } })).json();
  assert.deepEqual(body.members.map(row => [row.user_id, row.status, row.count]), [
    [REP, 'ready', 1], [OTHER_REP, 'unsupported', undefined], [PRIVATE_OWNER, 'unsupported', undefined],
  ]);
});

test('sharing is opt-in for the authenticated owner, bound to the current supported manager, and reassignment disables it', async t => {
  const initial = seed();
  initial.google_calendar_connections.find(row => row.user_id === REP).share_scheduled_count = false;
  initial.google_calendar_connections.find(row => row.user_id === REP).share_manager_id = null;
  const { url, db } = await server(t, { seed: initial });
  const headers = { Authorization: REP, 'Content-Type': 'application/json' };
  const before = await (await fetch(url + '/status', { headers })).json();
  assert.equal(before.sharing_enabled, false);
  assert.equal(before.sharing_eligible, true);
  assert.equal(before.sharing_team_name, 'Sober Living Riches');

  assert.equal((await fetch(url + '/sharing', { method: 'POST', headers, body: JSON.stringify({ enabled: true, user_id: OTHER_REP }) })).status, 200);
  const conn = db.tables.google_calendar_connections.find(row => row.user_id === REP);
  assert.equal(conn.share_scheduled_count, true);
  assert.equal(conn.share_manager_id, MANAGER);

  assert.equal((await fetch(url + '/sharing', { method: 'POST', headers, body: JSON.stringify({ enabled: false }) })).status, 200);
  assert.equal(conn.share_scheduled_count, false);
  assert.equal(conn.share_manager_id, null);
  const teamWhileOff = await (await fetch(url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  assert.equal(teamWhileOff.members.find(row => row.user_id === REP).status, 'not_sharing');

  await fetch(url + '/sharing', { method: 'POST', headers, body: JSON.stringify({ enabled: true }) });

  db.tables.user_profiles.find(row => row.user_id === REP).managed_by = OTHER_MANAGER;
  const moved = await (await fetch(url + '/status', { headers })).json();
  assert.equal(moved.sharing_enabled, false);
  assert.equal(moved.sharing_eligible, false);
});

test('sharing rejects missing consent and unsupported teams without changing the connection', async t => {
  const { url, db } = await server(t);
  const headers = { Authorization: OTHER_REP, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url + '/sharing', { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(url + '/sharing', { method: 'POST', headers, body: JSON.stringify({ enabled: true }) })).status, 409);
  const conn = db.tables.google_calendar_connections.find(row => row.user_id === OTHER_REP);
  assert.equal(conn.share_manager_id, OTHER_MANAGER);
});

test('disconnect/reconnect resets consent instead of transferring old sharing', async () => {
  const db = calendarStore(seed());
  const service = createCalendarService(db, google(), config);
  await service.disconnect(REP);
  const { state } = await service.begin(REP);
  await service.complete(state, 'code');
  const conn = db.tables.google_calendar_connections.find(row => row.user_id === REP);
  assert.equal(conn.share_scheduled_count, false);
  assert.equal(conn.share_manager_id, null);
});

test('a reassignment during Google read removes the rep after rechecking the team scope', async t => {
  let db;
  const provider = google({ events: async () => {
    db.tables.user_profiles.find(row => row.user_id === REP).managed_by = OTHER_MANAGER;
    return [ghlEvent('late-private-result')];
  } });
  const started = await server(t, { google: provider });
  db = started.db;
  const body = await (await fetch(started.url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  assert.equal(body.members.find(row => row.user_id === REP), undefined);
  assert.doesNotMatch(JSON.stringify(body), /late-private-result|Private prospect/);
});

test('a deactivated rep is removed after an in-flight Google read', async t => {
  let db;
  const provider = google({ events: async () => {
    db.tables.user_profiles.find(row => row.user_id === REP).active = false;
    return [ghlEvent('late-private-result')];
  } });
  const started = await server(t, { google: provider });
  db = started.db;
  const body = await (await fetch(started.url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  assert.equal(body.members.find(row => row.user_id === REP), undefined);
});

test('a viewer deactivated or demoted during Google read receives no team payload', async t => {
  let db;
  const provider = google({ events: async () => {
    const manager = db.tables.user_profiles.find(row => row.user_id === MANAGER);
    manager.role = 'user';
    manager.active = false;
    return [ghlEvent('late-private-result')];
  } });
  const started = await server(t, { google: provider });
  db = started.db;
  const response = await fetch(started.url + '/team' + range, { headers: { Authorization: MANAGER } });
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /count|late-private-result|Private prospect/);
});

test('disconnect during a manager read returns unavailable and no stale count', async t => {
  let service;
  const provider = google({ events: async () => {
    await service.disconnect(REP);
    return [ghlEvent('late-private-result')];
  } });
  const started = await server(t, { google: provider });
  service = started.service;
  const body = await (await fetch(started.url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  const rep = body.members.find(row => row.user_id === REP);
  assert.equal(rep.status, 'unavailable');
  assert.equal(rep.count, undefined);
});

test('provider failures are unavailable rather than a false zero', async t => {
  const { url } = await server(t, { google: google({ events: async () => { throw new Error('provider down'); } }) });
  const body = await (await fetch(url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  const rep = body.members.find(row => row.user_id === REP);
  assert.equal(rep.status, 'unavailable');
  assert.equal(rep.count, undefined);
});

test('final consent check discards an early count revoked while a later Google read is pending', async t => {
  const lateRep = '00000000-0000-4000-8000-000000000020';
  const calendarSeed = seed();
  calendarSeed.user_profiles.push({ user_id: lateRep, role: 'user', managed_by: MANAGER, first_name: 'Late', last_name: 'Rep', active: true });
  calendarSeed.google_calendar_connections.push(connection(lateRep, { share_scheduled_count: true, share_manager_id: MANAGER }));
  let db;
  const provider = google({ events: async token => {
    if (token === 'access-' + REP) {
      setTimeout(() => {
        const conn = db.tables.google_calendar_connections.find(row => row.user_id === REP);
        conn.share_scheduled_count = false;
        conn.share_manager_id = null;
      }, 5);
      return [ghlEvent('early-private-result')];
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    return [ghlEvent('late-private-result')];
  } });
  const started = await server(t, { seed: calendarSeed, google: provider,
    resolveTeam: async () => ({ keyId: MANAGER, memberIds: [REP, lateRep], label: 'Sober Living Riches', mode: 'own' }) });
  db = started.db;
  const body = await (await fetch(started.url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  const early = body.members.find(row => row.user_id === REP);
  assert.equal(early.status, 'not_sharing');
  assert.equal(early.count, undefined);
});

test('team calendar reads run concurrently with a hard ceiling of four', async t => {
  const profiles = seed().user_profiles;
  const connections = [];
  const ids = [];
  for (let index = 10; index < 16; index++) {
    const id = '00000000-0000-4000-8000-0000000000' + index;
    ids.push(id);
    profiles.push({ user_id: id, role: 'user', managed_by: MANAGER, first_name: 'Rep', last_name: String(index), active: true });
    connections.push(connection(id, { share_scheduled_count: true, share_manager_id: MANAGER }));
  }
  let active = 0;
  let maximum = 0;
  const provider = google({ events: async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    return [ghlEvent('one')];
  } });
  const { url } = await server(t, { seed: { user_profiles: profiles, google_calendar_connections: connections }, google: provider,
    resolveTeam: async () => ({ keyId: MANAGER, memberIds: ids, label: 'Sober Living Riches', mode: 'own' }) });
  const body = await (await fetch(url + '/team' + range, { headers: { Authorization: MANAGER } })).json();
  assert.equal(body.members.length, 6);
  assert.equal(maximum, 4);
});

test('migration defaults existing connections off and requires a bound manager when enabled', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260913171444_calendar_count_sharing.sql'), 'utf8');
  assert.match(sql, /share_scheduled_count boolean not null default false/i);
  assert.match(sql, /share_scheduled_count = false and share_manager_id is null/i);
  assert.match(sql, /share_scheduled_count = true and share_manager_id is not null/i);
});

test('the supported team identifier is explicit and stable', () => {
  assert.equal(SUPPORTED_CALENDAR_TEAM_ID, MANAGER);
});
