'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../lib/google-calendar');

const range = { from: '2026-09-07', to: '2026-09-11' };
const event = (id, extra = {}) => ({ id, summary: 'Jordan Prospect', status: 'confirmed',
  start: { dateTime: '2026-09-10T10:00:00-04:00' }, end: { dateTime: '2026-09-10T11:00:00-04:00' }, ...extra });

test('private inspection keeps mixed event kinds and useful source clues without calling them sales', () => {
  const rows = [
    event('prospect', { description: 'Contact source: GHL', organizer: { email: 'calendar@example.com', self: true },
      attendees: [{ email: 'prospect@example.com', responseStatus: 'accepted' }],
      source: { title: 'HighLevel appointment', url: 'https://app.gohighlevel.com/v2/location/top-secret?token=private_token_value' },
      conferenceData: { conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet' },
        entryPoints: [{ uri: 'https://meet.google.com/top-secret-room' }] },
      extendedProperties: { private: { ghlAppointmentId: 'private_token_value' }, shared: { source: 'ghl' } } }),
    event('personal', { summary: 'Dentist' }),
    event('focus', { summary: 'Focus time', eventType: 'focusTime' }),
    event('day', { summary: 'Away', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } }),
    event('cancelled', { status: 'cancelled' }),
  ];
  const result = calendar.inspectionEvents(rows, range, 'America/New_York');
  assert.deepEqual(new Set(result.map(item => item.title)), new Set(['Jordan Prospect', 'Dentist', 'Focus time', 'Away']));
  const prospect = result.find(item => item.title === 'Jordan Prospect');
  assert.equal(prospect.description, 'Contact source: GHL');
  assert.equal(prospect.organizer.email, 'calendar@example.com');
  assert.equal(prospect.attendees[0].email, 'prospect@example.com');
  assert.deepEqual(prospect.source, { title: 'HighLevel appointment', host: 'app.gohighlevel.com' });
  assert.deepEqual(prospect.conference, { type: 'hangoutsMeet', name: 'Google Meet' });
  assert.deepEqual(prospect.extended_property_keys, { private: ['ghlAppointmentId'], shared: ['source'] });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /top-secret|private_token_value|entryPoints|htmlLink|source\.url/);
});

test('inspection uses the primary calendar zone and deduplicates provider event ids', () => {
  const rows = [event('before', { start: { dateTime: '2026-09-07T02:00:00Z' } }),
    event('last', { start: { dateTime: '2026-09-12T02:00:00Z' } }),
    event('after', { start: { dateTime: '2026-09-12T05:00:00Z' } }),
    event('last', { start: { dateTime: '2026-09-12T02:00:00Z' } })];
  assert.deepEqual(calendar.inspectionEvents(rows, range, 'America/New_York').map(item => item.title), ['Jordan Prospect']);
});

test('private inspection is limited to fourteen inclusive calendar days', () => {
  assert.throws(() => calendar.validateInspectionRange('2026-02-30', '2026-03-01'));
  assert.throws(() => calendar.validateInspectionRange('2026-09-11', '2026-09-07'));
  assert.throws(() => calendar.validateInspectionRange('2026-09-01', '2026-09-15'));
  assert.deepEqual(calendar.validateInspectionRange('2026-09-01', '2026-09-14'), { from: '2026-09-01', to: '2026-09-14' });
});

test('token encryption authenticates both ciphertext and owning user', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const encoded = calendar.seal('refresh-secret', 'user-a', key);
  assert.equal(calendar.unseal(encoded, 'user-a', key), 'refresh-secret');
  assert.doesNotMatch(encoded, /refresh-secret/);
  assert.throws(() => calendar.unseal(encoded, 'user-b', key));
  assert.throws(() => calendar.seal('secret', 'user', 'bad-key'));
});

test('requests only read-only calendar scopes and offline authorization', () => {
  const url = new URL(calendar.authorizeUrl({ clientId: 'client', redirectUri: 'https://example.com/calendar/callback' }, 'random-state'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('state'), 'random-state');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('scope'), calendar.SCOPES.join(' '));
  assert.ok(calendar.SCOPES.every(scope => scope.endsWith('.readonly')));
});

test('calendar list preserves the primary marker and event reads are complete within the inspection cap', async () => {
  const calls = [];
  const client = calendar.createGoogleClient(async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (url.includes('calendarList')) return { ok: true, json: async () => ({ items: [
      { id: 'primary@example.com', summary: 'Main', timeZone: 'America/New_York', accessRole: 'owner', primary: true },
    ] }) };
    return { ok: true, json: async () => calls.filter(call => call.url.pathname.includes('/events')).length === 1
      ? { items: [], nextPageToken: 'next' } : { items: [event('one')] } };
  });
  const calendars = await client.calendars('token');
  assert.deepEqual(calendars, [{ id: 'primary@example.com', name: 'Main', time_zone: 'America/New_York', primary: true }]);
  const rows = await client.events('token', calendars[0].id, range);
  const eventCalls = calls.filter(call => call.url.pathname.includes('/events'));
  assert.equal(rows.length, 1);
  assert.equal(eventCalls.length, 2);
  assert.equal(eventCalls[1].url.searchParams.get('pageToken'), 'next');
  assert.equal(eventCalls[0].url.searchParams.get('singleEvents'), 'true');
  assert.equal(eventCalls[0].url.searchParams.get('showDeleted'), 'false');
  assert.match(eventCalls[0].url.searchParams.get('fields'), /description/);
  assert.equal(eventCalls[0].options.headers.Authorization, 'Bearer token');
});

test('more than two event pages and upstream errors refuse partial or provider-secret output', async () => {
  const endless = calendar.createGoogleClient(async () => ({ ok: true, json: async () => ({ items: [event('one')], nextPageToken: 'more' }) }));
  await assert.rejects(endless.events('secret', 'primary', range), /too_large/);
  const failed = calendar.createGoogleClient(async () => ({ ok: false, status: 403, json: async () => ({ error: 'provider-secret' }) }));
  await assert.rejects(failed.events('secret', 'primary', range), { message: 'google_access_denied' });
});
