'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appointmentState,
  changedAppointmentState,
  reconciliationMatches,
  recordObservedAppointments,
  reconcileStoredAppointments,
  appointmentOccurrenceKey,
} = require('../lib/calendar-appointments');
const { calendarStore } = require('./helpers/calendar-store');

const CONTEXT = {
  userId: 'closer-a',
  calendarId: 'primary@example.com',
  calendarTimeZone: 'America/New_York',
  zoomMeetingId: '81234567890',
};

function sourceEvent(overrides = {}) {
  return {
    id: 'event-occurrence-1',
    status: 'confirmed',
    summary: 'Unverified Prospect Label',
    description: 'https://links.soberlivingriches.com/booking/private https://us06web.zoom.us/j/81234567890?pwd=secret',
    location: 'https://us06web.zoom.us/j/81234567890?pwd=secret',
    updated: '2026-09-13T13:00:00Z',
    recurringEventId: 'recurring-series-1',
    originalStartTime: { dateTime: '2026-09-14T00:30:00Z', timeZone: 'America/New_York' },
    start: { dateTime: '2026-09-14T00:30:00Z', timeZone: 'America/New_York' },
    end: { dateTime: '2026-09-14T01:30:00Z', timeZone: 'America/New_York' },
    organizer: { email: 'closer@example.com', self: true },
    attendees: [
      { email: 'closer@example.com', self: true },
      { email: 'Prospect.Exact@Example.com', responseStatus: 'accepted' },
    ],
    conferenceData: {
      entryPoints: [{ entryPointType: 'video', uri: 'https://us06web.zoom.us/j/81234567890?pwd=secret' }],
      conferenceSolution: { key: { type: 'zoom' }, name: 'Zoom' },
    },
    extendedProperties: { private: { secret: 'must-never-persist' } },
    ...overrides,
  };
}

test('appointment state has one stable occurrence identity and only approved minimal fields', () => {
  const state = appointmentState(sourceEvent(), CONTEXT);
  assert.deepEqual(state, {
    user_id: 'closer-a',
    provider_calendar_id: 'primary@example.com',
    provider_event_id: 'event-occurrence-1',
    provider_occurrence_key: appointmentOccurrenceKey(sourceEvent()),
    provider_recurring_event_id: 'recurring-series-1',
    provider_original_start: '2026-09-14T00:30:00.000Z',
    scheduled_start: '2026-09-14T00:30:00.000Z',
    scheduled_end: '2026-09-14T01:30:00.000Z',
    scheduled_time_zone: 'America/New_York',
    scheduled_calendar_date: '2026-09-13',
    zoom_meeting_id: '81234567890',
    unverified_title: 'Unverified Prospect Label',
    external_attendee_email: 'Prospect.Exact@Example.com',
    source_updated_at: '2026-09-13T13:00:00.000Z',
  });
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /description|location|conferenceData|extendedProperties|pwd=|must-never-persist|booking\/private/);
});

test('recurring occurrence identity survives a changed Google event id', () => {
  const first = appointmentState(sourceEvent(), CONTEXT);
  const changedId = appointmentState(sourceEvent({
    id: 'replacement-event-id',
    originalStartTime: { dateTime: '2026-09-13T20:30:00-04:00', timeZone: 'America/New_York' },
  }), CONTEXT);
  assert.equal(changedId.provider_occurrence_key, first.provider_occurrence_key);
  assert.notEqual(changedId.provider_event_id, first.provider_event_id);
  assert.equal(changedAppointmentState(first, changedId), true);
});

test('unverified titles fail closed when they contain links or credential-like values', () => {
  const titles = [
    'Join https://us06web.zoom.us/j/81234567890?pwd=secret',
    'Open zoommtg://zoom.us/join?action=join&confno=81234567890',
    'Visit www.zoom.us/j/81234567890',
    'client_secret=calendar-secret',
    'password=hunter2',
    'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  ];
  for (const summary of titles) assert.equal(appointmentState(sourceEvent({ summary }), CONTEXT).unverified_title, null, summary);
  assert.equal(appointmentState(sourceEvent({ summary: 'Unverified Prospect Label' }), CONTEXT).unverified_title, 'Unverified Prospect Label');
});

test('multiple or absent external attendee emails remain unknown', () => {
  const multiple = appointmentState(sourceEvent({ attendees: [
    { email: 'closer@example.com', self: true },
    { email: 'one@example.com' },
    { email: 'two@example.com' },
  ] }), CONTEXT);
  const absent = appointmentState(sourceEvent({ attendees: [{ email: 'closer@example.com', self: true }] }), CONTEXT);
  assert.equal(multiple.external_attendee_email, null);
  assert.equal(absent.external_attendee_email, null);
});

test('source updates retain the occurrence identity while creating a minimal revision', () => {
  const before = appointmentState(sourceEvent(), CONTEXT);
  const after = appointmentState(sourceEvent({
    summary: 'Changed unverified label',
    updated: '2026-09-13T15:00:00Z',
    start: { dateTime: '2026-09-15T00:30:00Z', timeZone: 'America/New_York' },
    end: { dateTime: '2026-09-15T01:30:00Z', timeZone: 'America/New_York' },
  }), CONTEXT);
  assert.equal(after.provider_event_id, before.provider_event_id);
  assert.equal(after.provider_calendar_id, before.provider_calendar_id);
  assert.equal(changedAppointmentState(before, after), true);
  assert.equal(changedAppointmentState(after, { ...after }), false);
});

function appointment(overrides = {}) {
  return {
    id: 'appointment-a', user_id: 'closer-a', scheduled_calendar_date: '2026-09-13',
    scheduled_time_zone: 'America/New_York', zoom_meeting_id: '81234567890', ...overrides,
  };
}
function call(overrides = {}) {
  return { id: 'call-a', user_id: 'closer-a', meeting_id: '81234567890', call_date: '2026-09-14T00:45:00Z', ...overrides };
}

test('one exact closer, Zoom meeting and appointment-zone calendar-day match reconciles', () => {
  assert.deepEqual(reconciliationMatches([appointment()], [], [call()]), new Map([['appointment-a', 'call-a']]));
});

test('no match and every ambiguous match stay unknown', () => {
  assert.deepEqual([...reconciliationMatches([appointment()], [], []).entries()], []);
  assert.deepEqual([...reconciliationMatches([appointment()], [], [call(), call({ id: 'call-b' })]).entries()], []);
  assert.deepEqual([...reconciliationMatches([
    appointment(), appointment({ id: 'appointment-b', provider_event_id: 'event-b' }),
  ], [], [call()]).entries()], []);
});

test('wrong closer and the same meeting id on another calendar day do not match', () => {
  assert.deepEqual([...reconciliationMatches([appointment()], [], [call({ user_id: 'closer-b' })]).entries()], []);
  assert.deepEqual([...reconciliationMatches([appointment()], [], [call({ call_date: '2026-09-15T00:45:00Z' })]).entries()], []);
});

test('title is never a reconciliation key or identity source', () => {
  const titledAppointment = appointment({ zoom_meeting_id: null, unverified_title: 'Jordan Prospect' });
  const titledCall = call({ meeting_id: null, title: 'Jordan Prospect', prospect_id: 'prospect-existing' });
  assert.deepEqual([...reconciliationMatches([titledAppointment], [], [titledCall]).entries()], []);
  assert.equal(titledCall.prospect_id, 'prospect-existing');
});

test('conflicting exact keys across source revisions remain ambiguous', () => {
  const revisions = [
    { appointment_id: 'appointment-a', scheduled_calendar_date: '2026-09-13', scheduled_time_zone: 'America/New_York', zoom_meeting_id: '81234567890' },
    { appointment_id: 'appointment-a', scheduled_calendar_date: '2026-09-14', scheduled_time_zone: 'America/New_York', zoom_meeting_id: '89876543210' },
  ];
  const calls = [call(), call({ id: 'call-b', meeting_id: '89876543210', call_date: '2026-09-14T16:00:00Z' })];
  assert.deepEqual([...reconciliationMatches([appointment()], revisions, calls).entries()], []);
});

test('recording observed appointments sends only minimal states through the transactional storage boundary', async () => {
  const calls = [];
  const admin = {
    from() {
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, range() { return this; },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
    },
    rpc: async (name, values) => { calls.push({ name, values }); return { data: 'appointment-a', error: null }; },
  };
  await recordObservedAppointments(admin, {
    userId: 'closer-a', generation: 'connection-generation', calendarId: 'primary@example.com',
    calendarTimeZone: 'America/New_York', events: [sourceEvent()], observedAt: '2026-09-13T14:00:00Z',
    isAppointment: () => true, zoomMeetingIdFromEvent: () => '81234567890',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'record_calendar_appointment');
  assert.equal(calls[0].values.p_generation, 'connection-generation');
  assert.equal(calls[0].values.p_source_observation, 'qualifying');
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /description|location|conferenceData|extendedProperties|pwd=|must-never-persist|booking\/private/);
});

test('a known event that stops qualifying records source history without inventing an outcome', async () => {
  const calls = [];
  const admin = {
    from() {
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, range() { return this; },
        then(resolve) { return Promise.resolve({ data: [{ ...appointmentState(sourceEvent(), CONTEXT), id: 'appointment-a' }], error: null }).then(resolve); },
      };
    },
    async rpc(name, values) { calls.push({ name, values }); return { data: 'appointment-a', error: null }; },
  };
  await recordObservedAppointments(admin, {
    userId: 'closer-a', generation: 'connection-generation', calendarId: 'primary@example.com',
    calendarTimeZone: 'America/New_York', events: [sourceEvent()], observedAt: '2026-09-13T14:00:00Z',
    isAppointment: () => false, zoomMeetingIdFromEvent: () => null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values.p_source_observation, 'not_qualifying');
  assert.equal(calls[0].values.p_matched_call_id, undefined);
  assert.equal(calls[0].values.p_outcome, undefined);
  assert.equal(calls[0].values.p_call_kind, undefined);
});

test('a known deleted source row appends a non-qualifying observation without needing deleted times', async () => {
  const calls = [];
  const known = { ...appointmentState(sourceEvent(), CONTEXT), id: 'appointment-a' };
  const admin = {
    from() {
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, range() { return this; },
        then(resolve) { return Promise.resolve({ data: [known], error: null }).then(resolve); },
      };
    },
    async rpc(name, values) { calls.push({ name, values }); return { data: 'appointment-a', error: null }; },
  };
  await recordObservedAppointments(admin, {
    userId: 'closer-a', generation: 'connection-generation', calendarId: 'primary@example.com',
    calendarTimeZone: 'America/New_York', events: [{
      id: 'replacement-event-id', status: 'cancelled', updated: '2026-09-13T18:00:00Z',
      recurringEventId: 'recurring-series-1', originalStartTime: sourceEvent().originalStartTime,
    }], observedAt: '2026-09-13T18:01:00Z', isAppointment: () => false, zoomMeetingIdFromEvent: () => null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values.p_source_observation, 'not_qualifying');
  assert.equal(calls[0].values.p_provider_event_id, 'replacement-event-id');
  assert.equal(calls[0].values.p_scheduled_start, known.scheduled_start);
});

test('a known timed booking converted to all-day retains its prior schedule as non-qualifying history', async () => {
  const calls = [];
  const known = { ...appointmentState(sourceEvent(), CONTEXT), id: 'appointment-a' };
  const admin = {
    from() {
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, range() { return this; },
        then(resolve) { return Promise.resolve({ data: [known], error: null }).then(resolve); },
      };
    },
    async rpc(name, values) { calls.push({ name, values }); return { data: 'appointment-a', error: null }; },
  };
  await recordObservedAppointments(admin, {
    userId: 'closer-a', generation: 'connection-generation', calendarId: 'primary@example.com',
    calendarTimeZone: 'America/New_York', events: [sourceEvent({
      start: { date: '2026-09-14' }, end: { date: '2026-09-15' }, updated: '2026-09-13T19:00:00Z',
    })], observedAt: '2026-09-13T19:01:00Z', isAppointment: () => false, zoomMeetingIdFromEvent: () => null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values.p_source_observation, 'not_qualifying');
  assert.equal(calls[0].values.p_scheduled_start, known.scheduled_start);
  assert.equal(calls[0].values.p_scheduled_calendar_date, known.scheduled_calendar_date);
});

test('stored history is reconciled on later sync and only appointment links change', async () => {
  const db = calendarStore({
    calendar_appointments: [appointment({ matched_call_id: null }), appointment({ id: 'appointment-b', provider_event_id: 'event-b', zoom_meeting_id: null, matched_call_id: 'stale-call' })],
    calendar_appointment_history: [],
    fathom_calls: [call({ outcome: 'closed', call_kind: 'follow_up', prospect_id: 'prospect-existing' })],
  });
  const beforeCall = structuredClone(db.tables.fathom_calls[0]);
  await reconcileStoredAppointments(db, 'closer-a');
  assert.equal(db.tables.calendar_appointments.find(row => row.id === 'appointment-a').matched_call_id, 'call-a');
  assert.equal(db.tables.calendar_appointments.find(row => row.id === 'appointment-b').matched_call_id, null);
  assert.deepEqual(db.tables.fathom_calls[0], beforeCall);
  assert.ok(db.calls.filter(entry => entry.action === 'update').every(entry => entry.table === 'calendar_appointments'));
  for (const table of ['calendar_appointments', 'calendar_appointment_history', 'fathom_calls']) {
    const reads = db.calls.filter(entry => entry.table === table && entry.action === 'select');
    assert.ok(reads.length > 0);
    assert.ok(reads.every(entry => entry.orderings.length > 0), table + ' pagination must have stable ordering');
  }
});
