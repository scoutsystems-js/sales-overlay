'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../lib/google-calendar');

const range = { from: '2026-09-07', to: '2026-09-11' };
const event = (id, extra = {}) => ({ id, summary: 'Jordan Prospect', status: 'confirmed',
  start: { dateTime: '2026-09-10T10:00:00-04:00' }, end: { dateTime: '2026-09-10T11:00:00-04:00' }, ...extra });

function slrBookingProperties(extra = {}) {
  return { private: {
    calendarId: 'calendar', eventId: 'event', linkedCalendarId: 'linked-calendar', userCalendarId: 'user-calendar', userId: 'user', ...extra,
  } };
}

test('scheduled GHL appointments use the measured Sober Living Riches signature and exclude SalesKick first', () => {
  const rows = [
    event('ghl', { description: 'Manage it at https://links.soberlivingriches.com/booking/123', extendedProperties: slrBookingProperties() }),
    event('title-code', { summary: 'FU AF Prospect', description: 'https://links.soberlivingriches.com/booking/124', extendedProperties: slrBookingProperties() }),
    event('missing-key', { description: 'https://links.soberlivingriches.com/booking/456', extendedProperties: slrBookingProperties({ userId: '' }) }),
    event('missing-host', { description: 'Reschedule or cancel your appointment', extendedProperties: slrBookingProperties() }),
    event('personal', { description: 'https://links.soberlivingriches.com/booking/789' }),
    event('saleskick-key', { description: 'https://links.soberlivingriches.com/booking/101', extendedProperties: slrBookingProperties({ skManagedBookingId: 'sk-1' }) }),
    event('saleskick-host', { description: 'https://app.saleskick.com/booking/202', extendedProperties: slrBookingProperties() }),
    event('hybrid', { description: 'https://links.soberlivingriches.com/booking/303 then https://app.saleskick.com/booking/404', extendedProperties: slrBookingProperties() }),
    event('cancelled', { status: 'cancelled', description: 'https://links.soberlivingriches.com/booking/505', extendedProperties: slrBookingProperties() }),
    event('all-day', { description: 'https://links.soberlivingriches.com/booking/606', extendedProperties: slrBookingProperties(), start: { date: '2026-09-10' }, end: { date: '2026-09-11' } }),
    event('focus-time', { description: 'https://links.soberlivingriches.com/booking/707', extendedProperties: slrBookingProperties(), eventType: 'focusTime' }),
    event('self-declined', { description: 'https://links.soberlivingriches.com/booking/808', extendedProperties: slrBookingProperties(),
      attendees: [{ email: 'owner@example.com', self: true, responseStatus: 'declined' }] }),
  ];
  assert.deepEqual(calendar.scheduledGhlEvents(rows).map(item => item.id), ['ghl', 'title-code']);
});

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

test('calendar Zoom identity uses only the measured exact location URL shape', () => {
  assert.equal(calendar.zoomMeetingIdFromEvent({ location: 'https://us06web.zoom.us/j/81234567890?pwd=private' }), '81234567890');
  assert.equal(calendar.zoomMeetingIdFromEvent({ location: 'Join Zoom Meeting https://acme.zoom.us/j/9876543210' }), '9876543210');
  assert.equal(calendar.zoomMeetingIdFromEvent({
    description: 'https://us06web.zoom.us/j/81234567890',
    conferenceData: { entryPoints: [{ uri: 'https://us06web.zoom.us/j/81234567890' }] },
    summary: '81234567890',
  }), null, 'unmeasured fields never become reconciliation identity');
  assert.equal(calendar.zoomMeetingIdFromEvent({ location: 'https://meet.google.com/abc-defg-hij' }), null);
  assert.equal(calendar.zoomMeetingIdFromEvent({ location: 'https://zoom.us/j/1234' }), null);
});

test('background appointment reads cover the durable sync window without the private inspection page cap', async () => {
  let eventPages = 0;
  const client = calendar.createGoogleClient(async url => {
    eventPages += 1;
    const page = Number(new URL(url).searchParams.get('pageToken') || 0);
    return { ok: true, json: async () => ({
      items: [event('event-' + page)],
      ...(page < 2 ? { nextPageToken: String(page + 1) } : {}),
    }) };
  });
  const rows = await client.appointmentEvents('token', 'primary', { from: '2026-08-30', to: '2026-12-12' });
  assert.equal(eventPages, 3);
  assert.equal(rows.length, 3);
});

test('background reads include explicit deleted rows while private inspection does not', async () => {
  const seen = [];
  const client = calendar.createGoogleClient(async url => {
    seen.push(new URL(url).searchParams.get('showDeleted'));
    return { ok: true, json: async () => ({ items: [] }) };
  });
  await client.events('token', 'primary', range);
  await client.appointmentEvents('token', 'primary', range);
  assert.deepEqual(seen, ['false', 'true']);
});
