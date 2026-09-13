'use strict';
// Small range-aware Supabase wire for executed calendar route/service tests.
function calendarStore(seed = {}) {
  const tables = structuredClone(seed);
  const calls = [];
  return { tables, calls, async rpc(name, values) {
    calls.push({ table: name, action: 'rpc', values: structuredClone(values) });
    if (name !== 'record_calendar_appointment') return { data: null, error: { message: 'unknown_rpc' } };
    const connection = (tables.google_calendar_connections || []).find(row => row.user_id === values.p_user_id && row.generation === values.p_generation);
    if (!connection) return { data: null, error: { message: 'connection_changed' } };
    const appointments = tables.calendar_appointments ||= [];
    let appointment = appointments.find(row => row.user_id === values.p_user_id
      && row.provider_calendar_id === values.p_provider_calendar_id && row.provider_occurrence_key === values.p_provider_occurrence_key);
    const state = {
      provider_recurring_event_id: values.p_provider_recurring_event_id,
      provider_original_start: values.p_provider_original_start,
      scheduled_start: values.p_scheduled_start, scheduled_end: values.p_scheduled_end,
      scheduled_time_zone: values.p_scheduled_time_zone, scheduled_calendar_date: values.p_scheduled_calendar_date,
      zoom_meeting_id: values.p_zoom_meeting_id, unverified_title: values.p_unverified_title,
      external_attendee_email: values.p_external_attendee_email, source_updated_at: values.p_source_updated_at,
      source_observation: values.p_source_observation,
    };
    if (!appointment) {
      appointment = { id: 'calendar-appointment-' + (appointments.length + 1), user_id: values.p_user_id,
        provider_calendar_id: values.p_provider_calendar_id, provider_event_id: values.p_provider_event_id,
        provider_occurrence_key: values.p_provider_occurrence_key,
        ...state, first_seen_at: values.p_observed_at, last_seen_at: values.p_observed_at,
        matched_call_id: null, matched_at: null };
      appointments.push(appointment);
    } else {
      const current = Date.parse(appointment.source_updated_at);
      const incoming = Date.parse(values.p_source_updated_at);
      if (!Number.isFinite(current) || !Number.isFinite(incoming) || incoming >= current) {
        Object.assign(appointment, state, { provider_event_id: values.p_provider_event_id });
      }
      if (values.p_observed_at > appointment.last_seen_at) appointment.last_seen_at = values.p_observed_at;
    }
    const history = tables.calendar_appointment_history ||= [];
    if (!history.some(row => row.appointment_id === appointment.id && row.state_hash === values.p_state_hash)) {
      history.push({ appointment_id: appointment.id, state_hash: values.p_state_hash, observed_at: values.p_observed_at, ...state });
    }
    return { data: appointment.id, error: null };
  }, from(table) {
    const filters = [];
    const orderings = [];
    let action = 'select', values, start = 0, end = Infinity, returning = false;
    const q = {
      select() { returning = true; return q; }, eq(k, v) { filters.push(x => x[k] === v); return q; },
      gt(k, v) { filters.push(x => x[k] > v); return q; }, in(k, vs) { filters.push(x => vs.includes(x[k])); return q; },
      range(a, b) { start = a; end = b; return q; },
      order(field, options = {}) { orderings.push({ field, options }); return q; },
      upsert(v) { action = 'upsert'; values = v; return q; }, update(v) { action = 'update'; values = v; return q; },
      delete() { action = 'delete'; return q; }, maybeSingle() { return execute(true); }, then(ok, no) { return execute(false).then(ok, no); },
    };
    async function execute(single) {
      calls.push({ table, action, values, orderings: structuredClone(orderings) });
      const rows = tables[table] ||= [];
      const found = rows.filter(x => filters.every(f => f(x)));
      let result = [...found];
      if (action === 'upsert') {
        const old = rows.find(x => x.user_id === values.user_id);
        if (old) Object.assign(old, structuredClone(values)); else rows.push(structuredClone(values));
        result = [values];
      } else if (action === 'update') found.forEach(x => Object.assign(x, structuredClone(values)));
      else if (action === 'delete') tables[table] = rows.filter(x => !found.includes(x));
      if (action === 'select' && orderings.length) result.sort((left, right) => {
        for (const { field, options } of orderings) {
          const direction = options.ascending === false ? -1 : 1;
          if ((left[field] ?? '') < (right[field] ?? '')) return -direction;
          if ((left[field] ?? '') > (right[field] ?? '')) return direction;
        }
        return 0;
      });
      result = result.slice(start, end + 1);
      return { data: (returning || action === 'select') ? structuredClone(single ? result[0] || null : result) : null, error: null };
    }
    return q;
  } };
}
module.exports = { calendarStore };
