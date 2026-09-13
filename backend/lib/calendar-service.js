'use strict';
const crypto = require('node:crypto');
const { SCOPES, seal, unseal, inspectionEvents, validateInspectionRange, authorizeUrl } = require('./google-calendar');
const CONNECTIONS = 'google_calendar_connections';
const STATES = 'google_calendar_oauth_states';
const COLUMNS = 'user_id,generation,access_token_encrypted,refresh_token_encrypted,expires_at,connected_at,calendar_id,calendar_name,time_zone,title_contains,last_sync_at,last_sync_error,snapshot';
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
    async status(userId) { return { connected: Boolean(await get(userId)) }; },
    async inspect(userId, range) {
      validateInspectionRange(range.from, range.to);
      const conn = await get(userId);
      if (!conn) throw new Error('not_connected');
      const token = await access(conn);
      const calendars = await google.calendars(token);
      const primary = calendars.find(calendar => calendar.primary === true);
      if (!primary?.time_zone) throw new Error('calendar_not_available');
      new Intl.DateTimeFormat('en', { timeZone: primary.time_zone });
      const events = inspectionEvents(await google.events(token, primary.id, range), range, primary.time_zone);
      // A disconnect that lands while Google is responding must prevent the old
      // request from serving event details after its connection is gone.
      const current = await get(userId);
      if (!current || current.generation !== conn.generation) throw new Error('connection_changed');
      return { ...range, calendar: { name: primary.name, time_zone: primary.time_zone }, event_count: events.length, events };
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

module.exports = { readConfig, createCalendarService };
