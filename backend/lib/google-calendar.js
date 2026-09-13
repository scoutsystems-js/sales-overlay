'use strict';
const crypto = require('node:crypto');

const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]);
const DAY_MS = 86400000;
const MAX_PAGES = 20;
const readableCalendar = c => ['owner', 'writer', 'reader'].includes(c.accessRole) && !c.deleted;

function validateRange(from, to) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || to < from || Date.parse(to) - Date.parse(from) >= 93 * DAY_MS) {
    throw new Error('invalid_range');
  }
  return { from, to };
}

function dateInZone(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// Counts scheduled appointments, not first-booked prospects, attendance, or wins.
// The caller applies the closer's saved title filter before publishing counts.
function appointments(events, range, timeZone) {
  const byId = new Map();
  for (const event of events) {
    if (event.status === 'cancelled' || (event.eventType && event.eventType !== 'default')) continue;
    if (event.attendees?.some(a => a.self && a.responseStatus === 'declined')) continue;
    if (event.start?.date) continue;
    if (!event.id || !Number.isFinite(Date.parse(event.start?.dateTime)) || !Number.isFinite(Date.parse(event.end?.dateTime))) {
      throw new Error('unreadable_event');
    }
    const date = dateInZone(event.start.dateTime, timeZone);
    if (date < range.from || date > range.to) continue;
    // No descriptions, invitees, emails or arbitrary URLs leave this layer.
    byId.set(event.id, { id: event.id, title: event.summary || 'Sales call',
      start: new Date(event.start.dateTime).toISOString(), end: new Date(event.end.dateTime).toISOString() });
  }
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

function titleFilter(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('title_filter_required');
  return value.trim();
}
function matchingAppointments(events, range, timeZone, filter) {
  const phrase = titleFilter(filter).toLowerCase();
  return appointments(events.filter(event => typeof event.summary === 'string' && event.summary.toLowerCase().includes(phrase)), range, timeZone);
}

function encryptionKey(encoded) {
  const key = Buffer.from(encoded || '', 'base64');
  if (key.length !== 32) throw new Error('calendar_not_configured');
  return key;
}
function seal(value, userId, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64url')).join('.');
}
function unseal(value, userId, key) {
  const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(key), iv);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function authorizeUrl(config, state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', state }).toString();
  return url.href;
}

function createGoogleClient(fetchImpl = fetch) {
  async function request(url, options = {}) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch (_) { throw new Error('google_unavailable'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 400) throw new Error('google_reconnect');
      if (response.status === 403 || response.status === 404) throw new Error('google_access_denied');
      throw new Error('google_unavailable');
    }
    return response.json();
  }
  async function token(config, values) {
    const data = await request('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...values }).toString() });
    if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('google_reconnect');
    return data;
  }
  async function pages(path, accessToken, params) {
    const items = [];
    let pageToken;
    const started = Date.now();
    for (let page = 0; page < MAX_PAGES; page++) {
      if (Date.now() - started > 45000) throw new Error('google_unavailable');
      const url = new URL('https://www.googleapis.com/calendar/v3/' + path);
      url.search = new URLSearchParams({ maxResults: '250', ...params, ...(pageToken ? { pageToken } : {}) }).toString();
      const data = await request(url.href, { headers: { Authorization: 'Bearer ' + accessToken } });
      if (!Array.isArray(data.items)) throw new Error('google_unavailable');
      items.push(...data.items);
      pageToken = data.nextPageToken;
      if (!pageToken) return items;
    }
    throw new Error('calendar_too_large');
  }
  return {
    exchange: (config, code) => token(config, { code, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }),
    refresh: (config, refreshToken) => token(config, { refresh_token: refreshToken, grant_type: 'refresh_token' }),
    revoke: async refreshToken => {
      const response = await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }).toString() });
      return response.ok;
    },
    calendars: async accessToken => (await pages('users/me/calendarList', accessToken, {}))
      .filter(readableCalendar).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, time_zone: c.timeZone })),
    // Widen the wire window to include every UTC offset, then select START dates
    // in the calendar zone. Google's timeMin filters END times, not starts.
    events: (accessToken, calendarId, range) => pages('calendars/' + encodeURIComponent(calendarId) + '/events', accessToken, {
      singleEvents: 'true', showDeleted: 'false',
      timeMin: new Date(Date.parse(range.from) - DAY_MS).toISOString(),
      timeMax: new Date(Date.parse(range.to) + 2 * DAY_MS).toISOString(),
    }),
  };
}

module.exports = { SCOPES, validateRange, dateInZone, appointments, titleFilter, matchingAppointments, seal, unseal, authorizeUrl, createGoogleClient };
