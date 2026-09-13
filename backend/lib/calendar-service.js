'use strict';
const crypto = require('node:crypto');
const { SCOPES, seal, unseal, inspectionEvents, scheduledGhlEvents, validateInspectionRange, authorizeUrl,
  dateInZone, isScheduledSlrGhlAppointment, zoomMeetingIdFromEvent } = require('./google-calendar');
const { sharingEligibility, sharedCountStatus } = require('./calendar-sharing');
const { recordObservedAppointments, reconcileStoredAppointments } = require('./calendar-appointments');
const CONNECTIONS = 'google_calendar_connections';
const STATES = 'google_calendar_oauth_states';
const COLUMNS = 'user_id,generation,access_token_encrypted,refresh_token_encrypted,expires_at,connected_at,calendar_id,calendar_name,time_zone,title_contains,last_sync_at,last_sync_error,snapshot,share_scheduled_count,share_manager_id';
const PROFILE_COLUMNS = 'user_id,role,managed_by,active,team_name';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const refreshes = new Map();
const authorizationWrites = new Map();
const SYNC_CONCURRENCY = 4;
const SYNC_PAST_DAYS = 90;
const SYNC_FUTURE_DAYS = 90;
const STORAGE_PAGE = 500;
const ID_CHUNK = 200;

// Scout currently serves one Railway process (same boundary as call-connections).
// Serialize connect/disconnect so a late OAuth exchange cannot undo disconnect.
function authorizeInOrder(userId, work) {
  const previous = authorizationWrites.get(userId) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  authorizationWrites.set(userId, current);
  return current.finally(() => { if (authorizationWrites.get(userId) === current) authorizationWrites.delete(userId); });
}

function readConfig(env = process.env) {
  const config = { clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI, key: env.GOOGLE_CALENDAR_TOKEN_KEY };
  if (Object.values(config).some(value => !value) || Buffer.from(config.key, 'base64').length !== 32) throw new Error('calendar_not_configured');
  const url = new URL(config.redirectUri);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) throw new Error('calendar_not_configured');
  if (url.pathname !== '/calendar/callback') throw new Error('calendar_not_configured');
  return config;
}

async function checked(query) {
  const result = await query;
  if (result.error) throw new Error('calendar_storage_error');
  return result.data;
}

async function pagedChecked(build) {
  let rows = [];
  for (let from = 0; ; from += STORAGE_PAGE) {
    const page = await checked(build().range(from, from + STORAGE_PAGE - 1));
    rows = [...rows, ...page];
    if (page.length < STORAGE_PAGE) return rows;
  }
}

function shiftCalendarDate(date, days) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}

function appointmentSyncRange(now, timeZone) {
  const today = dateInZone(now.toISOString(), timeZone);
  return { from: shiftCalendarDate(today, -SYNC_PAST_DAYS), to: shiftCalendarDate(today, SYNC_FUTURE_DAYS) };
}

// Google receives a small UTC query cushion so calendar-time-zone boundary
// events are not missed. Retention stays strictly within the declared primary
// calendar-date window. Untimed rows still reach the recorder: it can retain a
// known deleted or all-day occurrence without inventing a new appointment.
function withinAppointmentCaptureRange(event, range, timeZone) {
  if (!Number.isFinite(Date.parse(event?.start?.dateTime))) return true;
  const eventDate = dateInZone(event.start.dateTime, timeZone);
  return eventDate >= range.from && eventDate <= range.to;
}

async function mapBounded(items, read) {
  let output = [];
  for (let index = 0; index < items.length; index += SYNC_CONCURRENCY) {
    output = [...output, ...await Promise.all(items.slice(index, index + SYNC_CONCURRENCY).map(read))];
  }
  return output;
}

function createCalendarService(admin, google, config) {
  const get = userId => checked(admin.from(CONNECTIONS).select(COLUMNS).eq('user_id', userId).maybeSingle());
  const getProfile = userId => checked(admin.from('user_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle());
  const update = async (conn, values) => {
    const result = await checked(admin.from(CONNECTIONS).update(values).eq('user_id', conn.user_id)
      .eq('generation', conn.generation).select('user_id').maybeSingle());
    if (!result) throw new Error('connection_changed');
  };
  async function access(conn) {
    if (Date.parse(conn.expires_at) > Date.now() + 60000) return unseal(conn.access_token_encrypted, conn.user_id, config.key);
    const key = conn.user_id + ':' + conn.generation;
    if (!refreshes.has(key)) refreshes.set(key, (async () => {
      const data = await google.refresh(config, unseal(conn.refresh_token_encrypted, conn.user_id, config.key));
      await update(conn, { access_token_encrypted: seal(data.access_token, conn.user_id, config.key),
        ...(data.refresh_token ? { refresh_token_encrypted: seal(data.refresh_token, conn.user_id, config.key) } : {}),
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString() });
      return data.access_token;
    })().finally(() => refreshes.delete(key)));
    return refreshes.get(key);
  }
  async function readScheduled(conn, range) {
    const token = await access(conn);
    const calendars = await google.calendars(token);
    const primary = calendars.find(calendar => calendar.primary === true);
    if (!primary?.time_zone) throw new Error('calendar_not_available');
    new Intl.DateTimeFormat('en', { timeZone: primary.time_zone });
    const appointments = inspectionEvents(scheduledGhlEvents(await google.events(token, primary.id, range)), range, primary.time_zone);
    return { primary, appointments };
  }
  async function syncConnection(conn, now) {
    const token = await access(conn);
    const calendars = await google.calendars(token);
    const primary = calendars.find(calendar => calendar.primary === true);
    if (!primary?.time_zone) throw new Error('calendar_not_available');
    new Intl.DateTimeFormat('en', { timeZone: primary.time_zone });
    const range = appointmentSyncRange(now, primary.time_zone);
    const events = (await google.appointmentEvents(token, primary.id, range))
      .filter(event => withinAppointmentCaptureRange(event, range, primary.time_zone));
    const recorded = await recordObservedAppointments(admin, {
      userId: conn.user_id,
      generation: conn.generation,
      calendarId: primary.id,
      calendarTimeZone: primary.time_zone,
      events,
      observedAt: now.toISOString(),
      isAppointment: isScheduledSlrGhlAppointment,
      zoomMeetingIdFromEvent,
    });
    const current = await get(conn.user_id);
    if (!current || current.generation !== conn.generation) throw new Error('connection_changed');
    await update(conn, { last_sync_at: now.toISOString(), last_sync_error: null });
    return { recorded };
  }
  return {
    async begin(userId) {
      const state = crypto.randomBytes(32).toString('base64url');
      await authorizeInOrder(userId, () => checked(admin.from(STATES).upsert({ user_id: userId, state_hash: hash(state),
        expires_at: new Date(Date.now() + 600000).toISOString() }, { onConflict: 'user_id' })));
      return { state, url: authorizeUrl(config, state) };
    },
    async complete(state, code) {
      if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state)) throw new Error('invalid_state');
      const candidate = await checked(admin.from(STATES).select('user_id').eq('state_hash', hash(state)).maybeSingle());
      if (!candidate) throw new Error('invalid_state');
      return authorizeInOrder(candidate.user_id, async () => {
        // DELETE RETURNING makes claiming the nonce atomic, including across processes.
        const pending = await checked(admin.from(STATES).delete().eq('state_hash', hash(state))
          .gt('expires_at', new Date().toISOString()).select('user_id').maybeSingle());
        if (!pending) throw new Error('invalid_state');
        const profile = await checked(admin.from('user_profiles').select('user_id,active,role,managed_by').eq('user_id', pending.user_id).maybeSingle());
        if (!profile || profile.active === false) throw new Error('account_unavailable');
        const data = await google.exchange(config, code);
        const granted = new Set((data.scope || '').split(' '));
        if (!SCOPES.every(scope => granted.has(scope))) throw new Error('google_scope_missing');
        if (!data.refresh_token) throw new Error('google_reconnect');
        const sharing = sharingEligibility(profile);
        await checked(admin.from(CONNECTIONS).upsert({ user_id: pending.user_id, generation: crypto.randomUUID(),
          access_token_encrypted: seal(data.access_token, pending.user_id, config.key),
          refresh_token_encrypted: seal(data.refresh_token, pending.user_id, config.key),
          expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), connected_at: new Date().toISOString(),
          calendar_id: null, calendar_name: null, time_zone: null, title_contains: null,
          snapshot: null, last_sync_at: null, last_sync_error: null,
          share_scheduled_count: sharing.eligible, share_manager_id: sharing.managerId }, { onConflict: 'user_id' }));
      });
    },
    async status(userId) {
      return { connected: Boolean(await get(userId)) };
    },
    async inspect(userId, range) {
      validateInspectionRange(range.from, range.to);
      const conn = await get(userId);
      if (!conn) throw new Error('not_connected');
      const { primary, appointments } = await readScheduled(conn, range);
      // A disconnect that lands while Google is responding must prevent the old
      // request from serving event details after its connection is gone.
      const current = await get(userId);
      if (!current || current.generation !== conn.generation) throw new Error('connection_changed');
      return { ...range, calendar: { name: primary.name, time_zone: primary.time_zone },
        scheduled_ghl_appointment_count: appointments.length, appointments };
    },
    async sharedCount(viewer, userId, range) {
      validateInspectionRange(range.from, range.to);
      try {
        const [conn, profile] = await Promise.all([get(userId), getProfile(userId)]);
        const initialStatus = sharedCountStatus(profile, conn, viewer.role, viewer.id);
        if (initialStatus !== 'ready') return { status: initialStatus };
        const { appointments } = await readScheduled(conn, range);
        const [current, currentProfile] = await Promise.all([get(userId), getProfile(userId)]);
        if (!current || current.generation !== conn.generation) return { status: 'unavailable' };
        const currentStatus = sharedCountStatus(currentProfile, current, viewer.role, viewer.id);
        if (currentStatus !== 'ready') return { status: currentStatus };
        return { status: 'ready', count: appointments.length, generation: conn.generation };
      } catch (_) {
        return { status: 'unavailable' };
      }
    },
    async revalidateSharedCount(viewer, userId, generation) {
      try {
        const [conn, profile] = await Promise.all([get(userId), getProfile(userId)]);
        if (!conn || conn.generation !== generation) return { status: 'unavailable' };
        return { status: sharedCountStatus(profile, conn, viewer.role, viewer.id) };
      } catch (_) {
        return { status: 'unavailable' };
      }
    },
    async syncAll(now = new Date()) {
      const connections = await pagedChecked(() => admin.from(CONNECTIONS).select(COLUMNS)
        .order('user_id', { ascending: true }));
      let profileRows = [];
      for (let index = 0; index < connections.length; index += ID_CHUNK) {
        profileRows = [...profileRows, ...await checked(admin.from('user_profiles').select('user_id,active')
          .in('user_id', connections.slice(index, index + ID_CHUNK).map(conn => conn.user_id)))];
      }
      const activeById = new Map(profileRows.map(profile => [profile.user_id, profile.active !== false]));
      const summary = { total: connections.length, ok: 0, appointments_recorded: 0, matched: 0,
        reconciliation_total: 0, owners_reconciled: 0, disconnected_owners_reconciled: 0, reconciliation_errors: 0,
        skipped_inactive: 0, errors: 0 };
      const results = await mapBounded(connections, async conn => {
        if (activeById.get(conn.user_id) === false) return { skipped: true };
        try { return await syncConnection(conn, now); }
        catch (error) {
          try { await update(conn, { last_sync_error: error.message || 'calendar_unavailable' }); } catch (_) {}
          return { error: true };
        }
      });
      for (const result of results) {
        if (result.skipped) summary.skipped_inactive += 1;
        else if (result.error) summary.errors += 1;
        else {
          summary.ok += 1;
          summary.appointments_recorded += result.recorded;
        }
      }

      // Reconciliation reads only Scout's stored ledger and recording rows. Run
      // it for every retained owner even when Google was unavailable or the
      // owner disconnected, so a late recording can match historical evidence.
      const ownerRows = await pagedChecked(() => admin.from('calendar_appointments').select('id,user_id')
        .order('user_id', { ascending: true }).order('id', { ascending: true }));
      const ownerIds = [...new Set(ownerRows.map(row => row.user_id).filter(Boolean))];
      summary.reconciliation_total = ownerIds.length;
      const connectedIds = new Set(connections.map(conn => conn.user_id));
      const reconciliationResults = await mapBounded(ownerIds, async userId => {
        try { return { userId, ...await reconcileStoredAppointments(admin, userId, now.toISOString()) }; }
        catch (_) { return { userId, error: true }; }
      });
      for (const result of reconciliationResults) {
        if (result.error) summary.reconciliation_errors += 1;
        else {
          summary.owners_reconciled += 1;
          summary.matched += result.matched;
          if (!connectedIds.has(result.userId)) summary.disconnected_owners_reconciled += 1;
        }
      }
      return summary;
    },
    async disconnect(userId) {
      return authorizeInOrder(userId, async () => {
        const conn = await get(userId);
        await checked(admin.from(STATES).delete().eq('user_id', userId));
        await checked(admin.from(CONNECTIONS).delete().eq('user_id', userId));
        if (!conn) return { revoked: true };
        try { return { revoked: await google.revoke(unseal(conn.refresh_token_encrypted, userId, config.key)) }; }
        catch (_) { return { revoked: false }; }
      });
    },
  };
}

module.exports = { readConfig, createCalendarService, appointmentSyncRange };
