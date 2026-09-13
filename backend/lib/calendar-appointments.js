'use strict';

const crypto = require('node:crypto');
const { dateInZone } = require('./google-calendar');
const PAGE_SIZE = 500;
const IN_CHUNK = 200;

const STATE_FIELDS = Object.freeze([
  'provider_event_id',
  'provider_recurring_event_id',
  'provider_original_start',
  'scheduled_start',
  'scheduled_end',
  'scheduled_time_zone',
  'scheduled_calendar_date',
  'zoom_meeting_id',
  'unverified_title',
  'external_attendee_email',
  'source_updated_at',
]);

function validTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch (_) { return false; }
}

function isoDateTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('unreadable_event');
  return new Date(value).toISOString();
}

function exactExternalAttendeeEmail(event) {
  if (!Array.isArray(event.attendees)) return null;
  const emails = [...new Set(event.attendees
    .filter(attendee => attendee && attendee.self !== true && typeof attendee.email === 'string' && attendee.email.trim())
    .map(attendee => attendee.email.trim()))];
  return emails.length === 1 ? emails[0] : null;
}

function appointmentOccurrenceKey(event) {
  if (!event || typeof event.id !== 'string' || !event.id.trim()) throw new Error('unreadable_event');
  const recurringId = typeof event.recurringEventId === 'string' ? event.recurringEventId.trim() : '';
  const original = typeof event.originalStartTime?.dateTime === 'string'
    ? isoDateTime(event.originalStartTime.dateTime)
    : (typeof event.originalStartTime?.date === 'string' ? event.originalStartTime.date.trim() : '');
  const identity = recurringId && original ? ['recurring', recurringId, original] : ['event', event.id.trim()];
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function unverifiedTitle(value) {
  if (typeof value !== 'string' || !value) return null;
  const candidate = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!candidate) return null;
  const hasLink = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.[^\s]+|\b[a-z0-9.-]+\.[a-z]{2,}\/\S+/i.test(candidate);
  const hasCredential = /\b(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|authorization|password|passwd|pwd)\s*[:=]\s*\S+|\bbearer\s+\S+/i.test(candidate);
  if (hasLink || hasCredential) return null;
  return candidate.slice(0, 500);
}

function appointmentState(event, context) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id.trim()) throw new Error('unreadable_event');
  if (!context || typeof context.userId !== 'string' || !context.userId || typeof context.calendarId !== 'string' || !context.calendarId) {
    throw new Error('unreadable_event');
  }
  const timeZone = validTimeZone(event.start?.timeZone) ? event.start.timeZone : context.calendarTimeZone;
  if (!validTimeZone(timeZone)) throw new Error('unreadable_event');
  const scheduledStart = isoDateTime(event.start?.dateTime);
  const scheduledEnd = isoDateTime(event.end?.dateTime);
  if (Date.parse(scheduledEnd) <= Date.parse(scheduledStart)) throw new Error('unreadable_event');
  const sourceUpdatedAt = event.updated == null ? null : isoDateTime(event.updated);
  const recurringEventId = typeof event.recurringEventId === 'string' && event.recurringEventId.trim()
    ? event.recurringEventId.trim() : null;
  const originalStart = recurringEventId && typeof event.originalStartTime?.dateTime === 'string'
    ? isoDateTime(event.originalStartTime.dateTime) : null;
  return {
    user_id: context.userId,
    provider_calendar_id: context.calendarId,
    provider_event_id: event.id.trim(),
    provider_occurrence_key: appointmentOccurrenceKey(event),
    provider_recurring_event_id: recurringEventId,
    provider_original_start: originalStart,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    scheduled_time_zone: timeZone,
    scheduled_calendar_date: dateInZone(scheduledStart, timeZone),
    zoom_meeting_id: typeof context.zoomMeetingId === 'string' && context.zoomMeetingId ? context.zoomMeetingId : null,
    unverified_title: unverifiedTitle(event.summary),
    external_attendee_email: exactExternalAttendeeEmail(event),
    source_updated_at: sourceUpdatedAt,
  };
}

function changedAppointmentState(before, after) {
  return STATE_FIELDS.some(field => (before?.[field] ?? null) !== (after?.[field] ?? null));
}

function candidateKey(state) {
  if (!state || typeof state.user_id !== 'string' || !state.zoom_meeting_id || !state.scheduled_calendar_date || !validTimeZone(state.scheduled_time_zone)) return null;
  return [state.user_id, state.zoom_meeting_id, state.scheduled_calendar_date, state.scheduled_time_zone].join('\u0000');
}

function reconciliationMatches(appointments, revisions, calls) {
  const appointmentsById = new Map((appointments || []).filter(row => row?.id).map(row => [row.id, row]));
  const statesByAppointment = new Map([...appointmentsById].map(([id, row]) => [id, [row]]));
  for (const revision of revisions || []) {
    if (!statesByAppointment.has(revision?.appointment_id)) continue;
    statesByAppointment.set(revision.appointment_id, [...statesByAppointment.get(revision.appointment_id), {
      ...revision,
      user_id: appointmentsById.get(revision.appointment_id).user_id,
    }]);
  }

  const appointmentCandidates = new Map([...appointmentsById.keys()].map(id => [id, new Set()]));
  const callCandidates = new Map((calls || []).filter(row => row?.id).map(row => [row.id, new Set()]));
  for (const [appointmentId, states] of statesByAppointment) {
    for (const state of states) {
      const key = candidateKey(state);
      if (!key) continue;
      for (const call of calls || []) {
        if (!call?.id || call.user_id !== state.user_id || call.meeting_id !== state.zoom_meeting_id) continue;
        if (!Number.isFinite(Date.parse(call.call_date))) continue;
        if (dateInZone(call.call_date, state.scheduled_time_zone) !== state.scheduled_calendar_date) continue;
        appointmentCandidates.get(appointmentId).add(call.id);
        callCandidates.get(call.id).add(appointmentId);
      }
    }
  }

  const matches = new Map();
  for (const [appointmentId, candidateCallIds] of appointmentCandidates) {
    if (candidateCallIds.size !== 1) continue;
    const [callId] = candidateCallIds;
    if (callCandidates.get(callId)?.size === 1) matches.set(appointmentId, callId);
  }
  return matches;
}

async function checked(query) {
  const result = await query;
  if (result.error) throw new Error('calendar_storage_error');
  return result.data || [];
}

async function paged(build) {
  let rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await checked(build().range(from, from + PAGE_SIZE - 1));
    rows = [...rows, ...page];
    if (page.length < PAGE_SIZE) return rows;
  }
}

function recordArguments(state, generation, sourceObservation, observedAt) {
  const sourceState = Object.fromEntries(STATE_FIELDS.map(field => [field, state[field] ?? null]));
  return {
    p_user_id: state.user_id,
    p_generation: generation,
    p_provider_calendar_id: state.provider_calendar_id,
    p_provider_event_id: state.provider_event_id,
    p_provider_occurrence_key: state.provider_occurrence_key,
    p_provider_recurring_event_id: state.provider_recurring_event_id,
    p_provider_original_start: state.provider_original_start,
    p_scheduled_start: state.scheduled_start,
    p_scheduled_end: state.scheduled_end,
    p_scheduled_time_zone: state.scheduled_time_zone,
    p_scheduled_calendar_date: state.scheduled_calendar_date,
    p_zoom_meeting_id: state.zoom_meeting_id,
    p_unverified_title: state.unverified_title,
    p_external_attendee_email: state.external_attendee_email,
    p_source_updated_at: state.source_updated_at,
    p_source_observation: sourceObservation,
    p_observed_at: isoDateTime(observedAt),
    p_state_hash: crypto.createHash('sha256').update(JSON.stringify({ ...sourceState, source_observation: sourceObservation })).digest('hex'),
  };
}

async function recordObservedAppointments(admin, options) {
  const events = Array.isArray(options.events) ? options.events : [];
  const ids = [...new Set(events.map(event => typeof event?.id === 'string' ? event.id.trim() : '').filter(Boolean))];
  const existing = ids.length ? await paged(() => admin.from('calendar_appointments')
    .select('id,user_id,provider_calendar_id,provider_event_id,provider_occurrence_key,provider_recurring_event_id,provider_original_start,scheduled_start,scheduled_end,scheduled_time_zone,scheduled_calendar_date,zoom_meeting_id,unverified_title,external_attendee_email,source_updated_at')
    .eq('user_id', options.userId).eq('provider_calendar_id', options.calendarId).order('id', { ascending: true })) : [];
  const knownByIdentity = new Map();
  for (const row of existing) {
    knownByIdentity.set('event:' + row.provider_event_id, row);
    if (row.provider_occurrence_key) knownByIdentity.set('occurrence:' + row.provider_occurrence_key, row);
  }
  let recorded = 0;
  for (const event of events) {
    const qualifies = options.isAppointment(event) === true;
    let occurrenceKey;
    try { occurrenceKey = appointmentOccurrenceKey(event); } catch (_) { if (!qualifies) continue; else throw _; }
    const known = knownByIdentity.get('occurrence:' + occurrenceKey) || knownByIdentity.get('event:' + event.id);
    if (!qualifies && !known) continue;
    let state;
    try {
      state = appointmentState(event, {
        userId: options.userId,
        calendarId: options.calendarId,
        calendarTimeZone: options.calendarTimeZone,
        zoomMeetingId: options.zoomMeetingIdFromEvent(event),
      });
    } catch (error) {
      if (!known || qualifies) throw error;
      state = {
        ...Object.fromEntries(['user_id', 'provider_calendar_id', 'provider_event_id', 'provider_occurrence_key', ...STATE_FIELDS]
          .map(field => [field, known[field] ?? null])),
        provider_event_id: event.id.trim(),
        provider_occurrence_key: occurrenceKey,
        provider_recurring_event_id: typeof event.recurringEventId === 'string' && event.recurringEventId.trim()
          ? event.recurringEventId.trim() : known.provider_recurring_event_id,
        provider_original_start: event.originalStartTime?.dateTime
          ? isoDateTime(event.originalStartTime.dateTime) : known.provider_original_start,
        source_updated_at: event.updated ? isoDateTime(event.updated) : known.source_updated_at,
      };
    }
    const result = await admin.rpc('record_calendar_appointment', recordArguments(
      state, options.generation, qualifies ? 'qualifying' : 'not_qualifying', options.observedAt,
    ));
    if (result.error) throw new Error(result.error.message === 'connection_changed' ? 'connection_changed' : 'calendar_storage_error');
    recorded += 1;
  }
  return recorded;
}

async function rowsInChunks(admin, table, columns, field, values) {
  let rows = [];
  for (let index = 0; index < values.length; index += IN_CHUNK) {
    const chunk = values.slice(index, index + IN_CHUNK);
    const part = await paged(() => admin.from(table).select(columns).in(field, chunk)
      .order('appointment_id', { ascending: true }).order('state_hash', { ascending: true }));
    rows = [...rows, ...part];
  }
  return rows;
}

async function reconcileStoredAppointments(admin, userId, matchedAt = new Date().toISOString()) {
  const appointments = await paged(() => admin.from('calendar_appointments')
    .select('id,user_id,scheduled_calendar_date,scheduled_time_zone,zoom_meeting_id,matched_call_id').eq('user_id', userId)
    .order('id', { ascending: true }));
  if (!appointments.length) return { appointments: 0, matched: 0 };
  const histories = await rowsInChunks(admin, 'calendar_appointment_history',
    'appointment_id,scheduled_calendar_date,scheduled_time_zone,zoom_meeting_id', 'appointment_id', appointments.map(row => row.id));
  const calls = await paged(() => admin.from('fathom_calls').select('id,user_id,meeting_id,call_date').eq('user_id', userId)
    .order('id', { ascending: true }));
  const matches = reconciliationMatches(appointments, histories, calls);
  for (const appointment of appointments) {
    const nextCallId = matches.get(appointment.id) || null;
    if ((appointment.matched_call_id || null) === nextCallId) continue;
    const result = await admin.from('calendar_appointments')
      .update({ matched_call_id: nextCallId, matched_at: nextCallId ? isoDateTime(matchedAt) : null })
      .eq('id', appointment.id).eq('user_id', userId);
    if (result.error) throw new Error('calendar_storage_error');
  }
  return { appointments: appointments.length, matched: matches.size };
}

module.exports = {
  STATE_FIELDS,
  appointmentOccurrenceKey,
  appointmentState,
  changedAppointmentState,
  reconciliationMatches,
  recordObservedAppointments,
  reconcileStoredAppointments,
};
