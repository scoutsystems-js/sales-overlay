'use strict';
const crypto = require('node:crypto');

const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]);
const DAY_MS = 86400000;
const MAX_PAGES = 20;
const MAX_INSPECTION_PAGES = 2;
const SLR_GHL_PRIVATE_KEYS = Object.freeze(['calendarId', 'eventId', 'linkedCalendarId', 'userCalendarId', 'userId']);
const SALESKICK_PROPERTY_KEYS = new Set(['skCreatedAt', 'skManagedBookingId', 'skSubmissionId', 'skVersion']);
const SLR_BOOKING_HOST = 'links.soberlivingriches.com';
const SALESKICK_HOST = 'app.saleskick.com';
const readableCalendar = calendar => ['owner', 'writer', 'reader'].includes(calendar.accessRole) && !calendar.deleted;

function urlHosts(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/https?:\/\/[^\s<>"']+/gi)].flatMap(match => {
    try { return [new URL(match[0]).hostname.toLowerCase()]; }
    catch (_) { return []; }
  });
}

function propertyNames(event) {
  const properties = event.extendedProperties || {};
  return ['private', 'shared'].flatMap(scope => properties[scope] && typeof properties[scope] === 'object'
    ? Object.keys(properties[scope]) : []);
}

function hasSalesKickSource(event) {
  const names = new Set(propertyNames(event));
  if ([...SALESKICK_PROPERTY_KEYS].some(key => names.has(key))) return true;
  const hosts = [event.description, event.location, event.source?.url].flatMap(urlHosts);
  return hosts.includes(SALESKICK_HOST);
}

// This is intentionally a measured Sober Living Riches booking signature, not
// a generic GHL detector. A title or one incidental property must never turn a
// personal calendar event into a scheduled appointment.
function isScheduledSlrGhlAppointment(event) {
  if (!event || typeof event !== 'object' || hasSalesKickSource(event)) return false;
  if (event.status === 'cancelled' || typeof event.start?.date === 'string') return false;
  if (event.eventType && event.eventType !== 'default') return false;
  if (Array.isArray(event.attendees) && event.attendees.some(attendee => attendee?.self === true && attendee.responseStatus === 'declined')) return false;
  const privateProperties = event.extendedProperties?.private;
  if (!privateProperties || typeof privateProperties !== 'object') return false;
  const hasGhlSignature = SLR_GHL_PRIVATE_KEYS.every(key => typeof privateProperties[key] === 'string' && privateProperties[key].trim());
  return hasGhlSignature && urlHosts(event.description).includes(SLR_BOOKING_HOST);
}

function scheduledGhlEvents(events) {
  return Array.isArray(events) ? events.filter(isScheduledSlrGhlAppointment) : [];
}

function validateInspectionRange(from, to) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  // Fourteen inclusive days is enough to inspect examples without creating a
  // calendar-history export path.
  if (!valid(from) || !valid(to) || to < from || Date.parse(to) - Date.parse(from) >= 14 * DAY_MS) {
    throw new Error('invalid_range');
  }
  return { from, to };
}

function dateInZone(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function safeText(value, maxLength) {
  if (typeof value !== 'string' || !value) return null;
  return value.slice(0, maxLength)
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try { return '[link hidden: ' + new URL(raw).hostname + ']'; }
      catch (_) { return '[link hidden]'; }
    })
    .replace(/\b(access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[hidden]');
}

function safePerson(person, attendee = false) {
  if (!person || typeof person !== 'object') return null;
  const result = {
    ...(safeText(person.displayName, 300) ? { display_name: safeText(person.displayName, 300) } : {}),
    ...(safeText(person.email, 320) ? { email: safeText(person.email, 320) } : {}),
    ...(person.self === true ? { self: true } : {}),
  };
  if (attendee) {
    if (safeText(person.responseStatus, 40)) result.response_status = safeText(person.responseStatus, 40);
    if (person.organizer === true) result.organizer = true;
  }
  return Object.keys(result).length ? result : null;
}

function safeSource(source) {
  if (!source || typeof source !== 'object') return null;
  let host = null;
  try { host = new URL(source.url).hostname; } catch (_) {}
  const title = safeText(source.title, 500);
  return title || host ? { ...(title ? { title } : {}), ...(host ? { host } : {}) } : null;
}

function safeConference(conferenceData) {
  const solution = conferenceData?.conferenceSolution;
  const type = safeText(solution?.key?.type, 100);
  const name = safeText(solution?.name, 300);
  return type || name ? { ...(type ? { type } : {}), ...(name ? { name } : {}) } : null;
}

function propertyKeys(extendedProperties) {
  const keys = value => value && typeof value === 'object' ? Object.keys(value).sort().slice(0, 50) : [];
  const result = { private: keys(extendedProperties?.private), shared: keys(extendedProperties?.shared) };
  return result.private.length || result.shared.length ? result : null;
}

function eventStartDate(event, timeZone) {
  if (typeof event.start?.date === 'string') return event.start.date;
  if (!Number.isFinite(Date.parse(event.start?.dateTime))) throw new Error('unreadable_event');
  return dateInZone(event.start.dateTime, timeZone);
}

// This is an owner-only inspection shape, not a sales-event classifier. It
// keeps useful origin clues while dropping provider links, token-like values,
// event ids and arbitrary nested Google payloads before they reach the page.
function inspectionEvents(events, range, timeZone) {
  const byId = new Map();
  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (!event.id) throw new Error('unreadable_event');
    const allDay = typeof event.start?.date === 'string';
    const date = eventStartDate(event, timeZone);
    if (date < range.from || date > range.to) continue;
    const end = allDay ? event.end?.date : event.end?.dateTime;
    if (typeof end !== 'string' || (!allDay && !Number.isFinite(Date.parse(end)))) throw new Error('unreadable_event');
    const attendees = Array.isArray(event.attendees)
      ? event.attendees.slice(0, 50).map(person => safePerson(person, true)).filter(Boolean) : [];
    const source = safeSource(event.source);
    const conference = safeConference(event.conferenceData);
    const extendedPropertyKeys = propertyKeys(event.extendedProperties);
    const normalized = {
      title: safeText(event.summary, 500) || '(No title)',
      status: safeText(event.status, 40) || 'unknown',
      event_type: safeText(event.eventType, 100) || 'default',
      start: allDay ? event.start.date : new Date(event.start.dateTime).toISOString(),
      end: allDay ? end : new Date(end).toISOString(),
      all_day: allDay,
      recurring: Boolean(event.recurringEventId),
      ...(safeText(event.description, 12000) ? { description: safeText(event.description, 12000) } : {}),
      ...(safeText(event.location, 1000) ? { location: safeText(event.location, 1000) } : {}),
      ...(safeText(event.visibility, 40) ? { visibility: safeText(event.visibility, 40) } : {}),
      ...(safeText(event.transparency, 40) ? { transparency: safeText(event.transparency, 40) } : {}),
      ...(Number.isFinite(Date.parse(event.created)) ? { created: new Date(event.created).toISOString() } : {}),
      ...(Number.isFinite(Date.parse(event.updated)) ? { updated: new Date(event.updated).toISOString() } : {}),
      ...(safePerson(event.organizer) ? { organizer: safePerson(event.organizer) } : {}),
      ...(safePerson(event.creator) ? { creator: safePerson(event.creator) } : {}),
      attendees,
      attendee_count: Array.isArray(event.attendees) ? event.attendees.length : 0,
      ...(source ? { source } : {}),
      ...(conference ? { conference } : {}),
      ...(extendedPropertyKeys ? { extended_property_keys: extendedPropertyKeys } : {}),
    };
    byId.set(event.id, normalized);
  }
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
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
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}
function unseal(value, userId, key) {
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
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
  async function pages(path, accessToken, params, maxPages = MAX_PAGES) {
    const items = [];
    let pageToken;
    const started = Date.now();
    for (let page = 0; page < maxPages; page++) {
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
    calendars: async accessToken => (await pages('users/me/calendarList', accessToken, {
      fields: 'nextPageToken,items(id,summary,summaryOverride,timeZone,accessRole,deleted,primary)',
    })).filter(readableCalendar).map(calendar => ({ id: calendar.id, name: calendar.summaryOverride || calendar.summary || calendar.id,
      time_zone: calendar.timeZone, primary: calendar.primary === true })),
    events: (accessToken, calendarId, range) => pages('calendars/' + encodeURIComponent(calendarId) + '/events', accessToken, {
      singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime',
      timeMin: new Date(Date.parse(range.from) - DAY_MS).toISOString(),
      timeMax: new Date(Date.parse(range.to) + 2 * DAY_MS).toISOString(),
      fields: 'nextPageToken,items(id,status,summary,description,location,eventType,start,end,created,updated,visibility,transparency,recurringEventId,organizer,creator,attendees,source,conferenceData(conferenceSolution),extendedProperties)',
    }, MAX_INSPECTION_PAGES),
  };
}

module.exports = { SCOPES, validateInspectionRange, dateInZone, inspectionEvents, scheduledGhlEvents, seal, unseal, authorizeUrl, createGoogleClient };
