'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calendarStore } = require('./helpers/calendar-store');
const { createCalendarService } = require('../lib/calendar-service');
const { SCOPES } = require('../lib/google-calendar');
const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/calendar/callback', key: Buffer.alloc(32, 7).toString('base64') };
const range = { from: '2026-09-07', to: '2026-09-11' };
function setup() {
  const db = calendarStore({ user_profiles: [{ user_id: 'rep', active: true }] });
  const google = {
    exchange: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: SCOPES.join(' ') }),
    refresh: async () => ({ access_token: 'new-access', expires_in: 3600 }),
    revoke: async () => true,
    calendars: async () => [{ id: 'sales', name: 'Sales', time_zone: 'America/New_York' }],
    events: async () => [{ id: 'one', status: 'confirmed', summary: 'Sales call', start: { dateTime: '2026-09-10T14:00:00Z' }, end: { dateTime: '2026-09-10T15:00:00Z' } }],
  };
  return { db, google, service: createCalendarService(db, google, config) };
}
async function connect(service) {
  const { state } = await service.begin('rep');
  await service.complete(state, 'code');
}

test('OAuth state is expiring and single-use; tokens encrypted and never returned by status', async () => {
  const { service, db } = setup();
  const { state } = await service.begin('rep');
  assert.notEqual(db.tables.google_calendar_oauth_states[0].state_hash, state);
  await service.complete(state, 'code');
  await assert.rejects(service.complete(state, 'code'), /invalid_state/);
  const status = await service.status('rep');
  assert.equal(status.connected, true);
  assert.equal(status.calendar, null);
  assert.doesNotMatch(JSON.stringify(status), /access_token|refresh_token|refresh-secret/);
  assert.doesNotMatch(JSON.stringify(db.tables.google_calendar_connections), /"access"|"refresh"/);
  const pending = await service.begin('rep');
  db.tables.google_calendar_oauth_states[0].expires_at = '2020-01-01T00:00:00.000Z';
  await assert.rejects(service.complete(pending.state, 'code'), /invalid_state/);
});

test('partial Google consent and deactivated users cannot finish connecting', async () => {
  const { service, google, db } = setup();
  google.exchange = async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: SCOPES[0] });
  await assert.rejects(connect(service), /google_scope_missing/);
  assert.equal(db.tables.google_calendar_connections?.length || 0, 0);
  db.tables.user_profiles[0].active = false;
  await assert.rejects(connect(service), /account_unavailable/);
});

test('counts nothing until a readable calendar and an explicit sales title filter are selected', async () => {
  const { service } = setup();
  assert.equal((await service.schedule('rep', range)).count, null);
  await connect(service);
  assert.equal((await service.schedule('rep', range)).state, 'setup_required');
  await assert.rejects(service.select('rep', 'sales', '', true), /title_filter_required/);
  await assert.rejects(service.select('rep', 'sales', 'Sales call', false), /selection_not_confirmed/);
  await assert.rejects(service.select('rep', 'someone-elses', 'Sales call', true), /calendar_not_available/);
  await service.select('rep', 'sales', 'Sales call', true);
  assert.equal((await service.schedule('rep', range)).count, 1);
  assert.equal((await service.schedule('other-rep', range)).count, null);
});

test('fresh complete snapshots remove cancelled bookings and moved events without duplicate counts', async () => {
  const { service, google, db } = setup();
  await connect(service); await service.select('rep', 'sales', 'Sales call', true);
  const first = await service.schedule('rep', range);
  assert.equal(first.count, 1);
  const original = await google.events();
  google.events = async () => [{ ...original[0], start: { dateTime: '2026-09-11T18:00:00Z' }, end: { dateTime: '2026-09-11T19:00:00Z' } }];
  const moved = await service.schedule('rep', range);
  assert.equal(moved.count, 1);
  assert.equal(moved.appointments[0].start, '2026-09-11T18:00:00.000Z');
  google.events = async () => [];
  assert.equal((await service.schedule('rep', range)).count, 0);
  assert.equal(db.tables.google_calendar_connections[0].snapshot.appointments.length, 0);
  google.events = async () => { throw new Error('google_unavailable'); };
  const failed = await service.schedule('rep', range);
  assert.equal(failed.count, null);
  assert.equal(failed.state, 'sync_failed');
  assert.ok(failed.last_sync_at);
  assert.equal(failed.appointments.length, 0);
});

test('disconnect revokes the Google grant; a provider failure still removes local tokens', async () => {
  const { service, google, db } = setup();
  await connect(service);
  let revoked;
  google.revoke = async token => { revoked = token; return true; };
  assert.equal((await service.disconnect('rep')).revoked, true);
  assert.equal(revoked, 'refresh');
  await connect(service);
  google.revoke = async () => { throw new Error('offline'); };
  assert.equal((await service.disconnect('rep')).revoked, false);
  assert.equal(db.tables.google_calendar_connections.length, 0);
});

test('calendar timezone changes are reflected on the next read', async () => {
  const { service, google } = setup();
  await connect(service); await service.select('rep', 'sales', 'Sales call', true);
  google.events = async () => [{ id: 'late', summary: 'Sales call', start: { dateTime: '2026-09-12T02:00:00Z' }, end: { dateTime: '2026-09-12T03:00:00Z' } }];
  assert.equal((await service.schedule('rep', range)).count, 1);
  google.calendars = async () => [{ id: 'sales', name: 'Sales', time_zone: 'Europe/London' }];
  assert.equal((await service.schedule('rep', range)).count, 0);
});

test('refresh preserves a Google refresh token when the response does not rotate it', async () => {
  const { service, google, db } = setup();
  await connect(service); await service.select('rep', 'sales', 'Sales call', true);
  const conn = db.tables.google_calendar_connections[0];
  const saved = conn.refresh_token_encrypted;
  conn.expires_at = '2020-01-01T00:00:00.000Z';
  let received;
  google.refresh = async (_config, token) => { received = token; return { access_token: 'new', expires_in: 3600 }; };
  assert.equal((await service.schedule('rep', range)).count, 1);
  assert.equal(received, 'refresh');
  assert.equal(conn.refresh_token_encrypted, saved);
});

test('disconnect clears tokens and prevents a concurrent in-flight sync from restoring or serving data', async () => {
  const { service, db, google } = setup();
  await connect(service); await service.select('rep', 'sales', 'Sales call', true);
  google.events = async () => { await service.disconnect('rep'); return []; };
  const result = await service.schedule('rep', range);
  assert.equal(result.count, null);
  assert.equal(db.tables.google_calendar_connections.length, 0);
  assert.equal((await service.status('rep')).connected, false);
});

test('mixed-calendar preview and saved counts apply exactly the same filter', async () => {
  const { service, google } = setup();
  await connect(service);
  const original = await google.events();
  google.events = async () => [...original, { ...original[0], id: 'personal', summary: 'Dentist' },
    { ...original[0], id: 'internal', summary: 'Internal team meeting' }];
  const preview = await service.preview('rep', 'sales', 'Sales call', range);
  assert.equal(preview.count, 1);
  assert.equal((await service.status('rep')).calendar, null, 'preview does not enable counting');
  await service.select('rep', 'sales', 'Sales call', true);
  const saved = await service.schedule('rep', range);
  assert.deepEqual(saved.appointments, preview.appointments);
  assert.equal(saved.count, 1);
});

test('disconnect also wins over an authorization exchange already in flight', async () => {
  const { service, google, db } = setup();
  let release, started;
  const exchanging = new Promise(resolve => { started = resolve; });
  const original = google.exchange;
  google.exchange = async (...args) => { started(); await new Promise(resolve => { release = resolve; }); return original(...args); };
  const connecting = connect(service);
  await exchanging;
  const disconnecting = service.disconnect('rep');
  release();
  await Promise.all([connecting, disconnecting]);
  assert.equal(db.tables.google_calendar_connections.length, 0);
});
