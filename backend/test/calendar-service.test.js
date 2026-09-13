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
    calendars: async () => [{ id: 'primary@example.com', name: 'Primary', time_zone: 'America/New_York', primary: true },
      { id: 'shared@example.com', name: 'Shared', time_zone: 'America/New_York', primary: false }],
    events: async () => [{ id: 'one', status: 'confirmed', summary: 'Jordan Prospect', description: 'Booked by GHL',
      start: { dateTime: '2026-09-10T14:00:00Z' }, end: { dateTime: '2026-09-10T15:00:00Z' } }],
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
  assert.deepEqual(status, { connected: true });
  assert.doesNotMatch(JSON.stringify(status), /access_token|refresh_token|refresh-secret|title_contains|snapshot/);
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

test('connected owner inspects the primary calendar without setup or event persistence', async () => {
  const { service, google, db } = setup();
  await assert.rejects(service.inspect('rep', range), /not_connected/);
  await connect(service);
  db.calls.length = 0;
  const result = await service.inspect('rep', range);
  assert.equal(result.calendar.name, 'Primary');
  assert.equal(result.event_count, 1);
  assert.equal(result.events[0].description, 'Booked by GHL');
  assert.ok(db.calls.every(call => call.action === 'select'), 'inspection only reads connection state');
  assert.equal(db.tables.google_calendar_connections[0].snapshot, null);
  assert.equal(db.tables.google_calendar_connections[0].calendar_id, null);
  assert.equal(db.tables.google_calendar_connections[0].title_contains, null);
  google.calendars = async () => [{ id: 'shared', name: 'Shared', time_zone: 'America/New_York', primary: false }];
  await assert.rejects(service.inspect('rep', range), /calendar_not_available/);
});

test('refresh preserves a Google refresh token when the response does not rotate it', async () => {
  const { service, google, db } = setup();
  await connect(service);
  const conn = db.tables.google_calendar_connections[0];
  const saved = conn.refresh_token_encrypted;
  conn.expires_at = '2020-01-01T00:00:00.000Z';
  let received;
  google.refresh = async (_config, token) => { received = token; return { access_token: 'new', expires_in: 3600 }; };
  assert.equal((await service.inspect('rep', range)).event_count, 1);
  assert.equal(received, 'refresh');
  assert.equal(conn.refresh_token_encrypted, saved);
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

test('disconnect wins over an in-flight inspection and no event data is served afterward', async () => {
  const { service, db, google } = setup();
  await connect(service);
  google.events = async () => { await service.disconnect('rep'); return []; };
  await assert.rejects(service.inspect('rep', range), /connection_changed/);
  assert.equal(db.tables.google_calendar_connections.length, 0);
  assert.deepEqual(await service.status('rep'), { connected: false });
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
