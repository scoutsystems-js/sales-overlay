'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../lib/google-calendar');

const range = { from: '2026-09-07', to: '2026-09-11' };
const event = (id, extra = {}) => ({ id, summary: 'Sales consultation', status: 'confirmed',
  start: { dateTime: '2026-09-10T10:00:00-04:00' }, end: { dateTime: '2026-09-10T11:00:00-04:00' }, ...extra });

test('one real appointment counts; cancelled, declined, all-day and focus blocks do not', () => {
  const rows = [event('one'), event('cancel', { status: 'cancelled' }),
    event('declined', { attendees: [{ self: true, responseStatus: 'declined' }] }),
    event('day', { start: { date: '2026-09-10' }, end: { date: '2026-09-11' } }),
    event('focus', { eventType: 'focusTime' })];
  const result = calendar.appointments(rows, range, 'America/New_York');
  assert.deepEqual(result.map(x => x.id), ['one']);
  assert.equal(result[0].title, 'Sales consultation');
});

test('uses start date in the selected calendar zone, not UTC or the event end', () => {
  const rows = [event('before', { start: { dateTime: '2026-09-07T02:00:00Z' } }),
    event('last', { start: { dateTime: '2026-09-12T02:00:00Z' } }),
    event('after', { start: { dateTime: '2026-09-12T05:00:00Z' } })];
  assert.deepEqual(calendar.appointments(rows, range, 'America/New_York').map(x => x.id), ['last']);
});

test('deduplicates occurrence IDs, not series IDs; never repeats a moved instance', () => {
  const rows = [event('series_1', { recurringEventId: 'series' }),
    event('series_2', { recurringEventId: 'series' }), event('series_1', { recurringEventId: 'series' })];
  assert.equal(calendar.appointments(rows, range, 'America/New_York').length, 2);
});

test('does not retain descriptions, attendee emails or arbitrary provider URLs', () => {
  const rows = [event('one', { description: 'private detail', attendees: [{ email: 'private@example.com' }], htmlLink: 'javascript:alert(1)' })];
  const result = JSON.stringify(calendar.appointments(rows, range, 'America/New_York'));
  assert.doesNotMatch(result, /private|javascript/);
});

test('rejects invalid dates and unbounded date ranges', () => {
  assert.throws(() => calendar.validateRange('2026-02-30', '2026-03-01'));
  assert.throws(() => calendar.validateRange('2026-09-11', '2026-09-07'));
  assert.throws(() => calendar.validateRange('2025-01-01', '2026-01-01'));
  assert.deepEqual(calendar.validateRange(range.from, range.to), range);
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
  assert.ok(calendar.SCOPES.every(x => x.endsWith('.readonly')));
});

test('reads every page including empty intermediate pages; expands recurring events', async () => {
  const calls = [];
  const client = calendar.createGoogleClient(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, json: async () => calls.length === 1
      ? { items: [], nextPageToken: 'next' } : { items: [event('one')] } };
  });
  const rows = await client.events('token', 'sales@example.com', range);
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'next');
  assert.equal(calls[0].url.searchParams.get('singleEvents'), 'true');
  assert.equal(calls[0].url.searchParams.get('showDeleted'), 'false');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
});

test('truncation and upstream errors refuse a partial count and redact provider responses', async () => {
  const endless = calendar.createGoogleClient(async () => ({ ok: true, json: async () => ({ items: [event('one')], nextPageToken: 'more' }) }));
  await assert.rejects(endless.events('secret', 'sales', range), /too_large/);
  const failed = calendar.createGoogleClient(async () => ({ ok: false, status: 403, json: async () => ({ error: 'secret' }) }));
  await assert.rejects(failed.events('secret', 'sales', range), { message: 'google_access_denied' });
});

test('mixed calendars count only the configured sales title, case-insensitively and literally', () => {
  const rows = [event('sale', { summary: 'GHL Strategy Call with Sam' }),
    event('personal', { summary: 'Dentist' }), event('internal', { summary: 'Team sync' }),
    event('sale2', { summary: 'strategy call — Jordan' })];
  assert.deepEqual(calendar.matchingAppointments(rows, range, 'America/New_York', 'Strategy Call').map(x => x.id), ['sale', 'sale2']);
  assert.equal(calendar.matchingAppointments(rows, range, 'America/New_York', '.*').length, 0);
  assert.throws(() => calendar.matchingAppointments(rows, range, 'America/New_York', '  '), /title_filter_required/);
});
