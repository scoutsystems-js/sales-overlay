'use strict';
const crypto = require('node:crypto');
const { SCOPES, seal, unseal, matchingAppointments, titleFilter, validateRange, authorizeUrl } = require('./google-calendar');
const CONNECTIONS = 'google_calendar_connections';
const STATES = 'google_calendar_oauth_states';
const COLUMNS = 'user_id,generation,access_token_encrypted,refresh_token_encrypted,expires_at,connected_at,calendar_id,calendar_name,time_zone,title_contains,last_sync_at,last_sync_error';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const refreshes = new Map();
const authorizationWrites = new Map();

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
function publicStatus(conn) {
  if (!conn) return { connected: false, calendar: null, last_sync_at: null };
  return { connected: true, calendar: conn.calendar_id ? { id: conn.calendar_id, name: conn.calendar_name, time_zone: conn.time_zone } : null,
    title_contains: conn.title_contains || null, last_sync_at: conn.last_sync_at || null, needs_reconnect: conn.last_sync_error === 'google_reconnect' };
}
async function checked(query) {
  const result = await query;
  if (result.error) throw new Error('calendar_storage_error');
  return result.data;
}

function createCalendarService(admin, google, config) {
  const get = userId => checked(admin.from(CONNECTIONS).select(COLUMNS).eq('user_id', userId).maybeSingle());
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
  async function readableSelection(userId, calendarId) {
    const conn = await get(userId);
    if (!conn) throw new Error('not_connected');
    const token = await access(conn);
    const list = await google.calendars(token);
    const selected = list.find(c => c.id === calendarId);
    if (!selected?.time_zone) throw new Error('calendar_not_available');
    new Intl.DateTimeFormat('en', { timeZone: selected.time_zone });
    return { conn, selected, token };
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
      const profile = await checked(admin.from('user_profiles').select('active').eq('user_id', pending.user_id).maybeSingle());
      if (!profile || profile.active === false) throw new Error('account_unavailable');
      const data = await google.exchange(config, code);
      const granted = new Set((data.scope || '').split(' '));
      if (!SCOPES.every(scope => granted.has(scope))) throw new Error('google_scope_missing');
      if (!data.refresh_token) throw new Error('google_reconnect');
      await checked(admin.from(CONNECTIONS).upsert({ user_id: pending.user_id, generation: crypto.randomUUID(),
        access_token_encrypted: seal(data.access_token, pending.user_id, config.key),
        refresh_token_encrypted: seal(data.refresh_token, pending.user_id, config.key),
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), connected_at: new Date().toISOString(),
        calendar_id: null, calendar_name: null, time_zone: null, title_contains: null,
        snapshot: null, last_sync_at: null, last_sync_error: null }, { onConflict: 'user_id' }));
      });
    },
    async status(userId) { return publicStatus(await get(userId)); },
    async calendars(userId) {
      const conn = await get(userId);
      if (!conn) throw new Error('not_connected');
      return google.calendars(await access(conn));
    },
    async preview(userId, calendarId, filter, range) {
      const phrase = titleFilter(filter);
      validateRange(range.from, range.to);
      const { selected, token } = await readableSelection(userId, calendarId);
      const rows = matchingAppointments(await google.events(token, calendarId, range), range, selected.time_zone, phrase);
      return { count: rows.length, appointments: rows, calendar: selected, title_contains: phrase, ...range };
    },
    async select(userId, calendarId, filter, confirmed) {
      const phrase = titleFilter(filter);
      if (confirmed !== true) throw new Error('selection_not_confirmed');
      const { conn, selected } = await readableSelection(userId, calendarId);
      await update(conn, { generation: crypto.randomUUID(), calendar_id: selected.id, calendar_name: selected.name,
        time_zone: selected.time_zone, title_contains: phrase, snapshot: null, last_sync_at: null, last_sync_error: null });
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
    async schedule(userId, range) {
      validateRange(range.from, range.to);
      const conn = await get(userId);
      const unavailable = { ...publicStatus(conn), count: null, appointments: [] };
      if (!conn) return { ...unavailable, state: 'not_connected' };
      if (!conn.calendar_id || !conn.title_contains) return { ...unavailable, state: 'setup_required' };
      try {
        const token = await access(conn);
        const list = await google.calendars(token);
        const selected = list.find(calendar => calendar.id === conn.calendar_id);
        if (!selected?.time_zone) throw new Error('google_access_denied');
        const events = await google.events(token, conn.calendar_id, range);
        const rows = matchingAppointments(events, range, selected.time_zone, conn.title_contains);
        const syncedAt = new Date().toISOString();
        // Full-window snapshot is ONE atomic write. No partial-page counts,
        // stale cancellation rows, or per-request schema/recording mutations.
        const metadata = { calendar_name: selected.name, time_zone: selected.time_zone };
        await update(conn, { ...metadata, snapshot: { ...range, appointments: rows }, last_sync_at: syncedAt, last_sync_error: null });
        return { ...publicStatus({ ...conn, ...metadata }), state: 'ready', last_sync_at: syncedAt, count: rows.length, appointments: rows };
      } catch (error) {
        if (error.message === 'connection_changed') return { ...unavailable, state: 'connection_changed' };
        const reason = ['google_reconnect', 'google_access_denied', 'calendar_too_large', 'unreadable_event'].includes(error.message)
          ? error.message : 'google_unavailable';
        await update(conn, { last_sync_error: reason });
        return { ...unavailable, state: 'sync_failed', reason };
      }
    },
  };
}

module.exports = { readConfig, createCalendarService };
