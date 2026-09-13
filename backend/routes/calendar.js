'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CHUNK } = require('../lib/chunk');
const { nameMapFor } = require('../lib/team-name-map');
const { createGoogleClient, validateRange } = require('../lib/google-calendar');
const { readConfig, createCalendarService } = require('../lib/calendar-service');
const COOKIE = 'scout_calendar_state';
const MESSAGES = {
  calendar_not_configured: 'Google Calendar setup is not enabled yet.',
  calendar_origin_mismatch: 'Open calendar setup on Scout’s configured sign-in address.',
  invalid_range: 'Choose a valid date range of up to 93 days.',
  invalid_state: 'This connection link expired. Start again in Scout.',
  title_filter_required: 'Enter the text used in your sales appointment titles (up to 120 characters).',
  selection_not_confirmed: 'Preview the matches and confirm these are your sales appointments.',
  calendar_not_available: 'Choose a calendar you can read.',
  google_reconnect: 'Reconnect Google Calendar to continue.',
  google_scope_missing: 'Allow both read-only calendar permissions, then try again.',
  not_connected: 'Connect Google Calendar first.',
  google_access_denied: 'Google did not allow access to this calendar. Check its permissions.',
  connection_changed: 'Calendar settings changed. Refresh this page.',
};
function defaultAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('calendar_not_configured');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function browserStateMatches(req) {
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  const state = req.query.state;
  if (!cookie || typeof state !== 'string' || !/^[\w-]{43}$/.test(state)) return false;
  const saved = cookie.slice(COOKIE.length + 1);
  return saved.length === state.length && crypto.timingSafeEqual(Buffer.from(saved), Buffer.from(state));
}
function createCalendarRouter(options = {}) {
  const router = express.Router();
  const admin = options.admin || defaultAdmin;
  const config = options.config || readConfig;
  const authenticate = options.authenticate || requireAuth;
  const service = options.service || (() => createCalendarService(admin(), createGoogleClient(), config()));
  const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: config().redirectUri.startsWith('https:'), path: '/calendar', maxAge: 600000 });
  const run = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) {
      const code = error.message;
      const status = ['invalid_range', 'title_filter_required', 'selection_not_confirmed', 'calendar_not_available', 'invalid_state', 'calendar_origin_mismatch'].includes(code) ? 400
        : code === 'calendar_not_configured' ? 503 : error.status || 502;
      res.status(status).json({ error: MESSAGES[code] || 'Calendar could not be loaded. Try again.', code: MESSAGES[code] ? code : 'calendar_unavailable' });
    }
  };
  router.post('/connect', authenticate, run(async (req, res) => {
    const origin = req.get('origin');
    if (origin && origin !== new URL(config().redirectUri).origin) throw new Error('calendar_origin_mismatch');
    const result = await service().begin(req.user.id);
    res.cookie(COOKIE, result.state, cookieOptions());
    res.json({ url: result.url });
  }));
  router.get('/callback', run(async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    if (!browserStateMatches(req)) return res.status(400).send(MESSAGES.invalid_state);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    if (req.query.error) return res.redirect('/calendar.html?connection=denied');
    if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return res.status(400).send('Missing authorization code');
    try {
      await service().complete(req.query.state, req.query.code);
      res.redirect('/calendar.html?connected=1');
    } catch (_) { res.redirect('/calendar.html?connection=failed'); }
  }));
  router.get('/status', authenticate, run(async (req, res) => {
    let configured = true;
    try { config(); } catch (_) { configured = false; }
    const role = req.userProfileRole || req.user.role;
    if (!configured) return res.json({ configured: false, connected: false, can_view_team: ['manager', 'owner'].includes(role) });
    res.json({ configured: true, connect_origin: new URL(config().redirectUri).origin,
      ...await service().status(req.user.id), can_view_team: ['manager', 'owner'].includes(role) });
  }));
  router.get('/calendars', authenticate, run(async (req, res) => res.json({ calendars: await service().calendars(req.user.id) })));
  router.post('/preview', authenticate, run(async (req, res) => {
    const range = validateRange(req.body?.from, req.body?.to);
    res.json(await service().preview(req.user.id, req.body?.calendar_id, req.body?.title_contains, range));
  }));
  router.post('/selection', authenticate, run(async (req, res) => {
    await service().select(req.user.id, req.body?.calendar_id, req.body?.title_contains, req.body?.confirmed);
    res.json({ ok: true });
  }));
  router.delete('/connection', authenticate, run(async (req, res) => {
    const result = await service().disconnect(req.user.id);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true, ...result });
  }));
  router.get('/schedule', authenticate, run(async (req, res) => {
    const range = validateRange(req.query.from, req.query.to);
    res.json({ ...range, ...await service().schedule(req.user.id, range) });
  }));
  router.get('/team', authenticate, requireRole(['manager', 'owner']), run(async (req, res) => {
    const range = validateRange(req.query.from, req.query.to);
    const db = admin();
    const team = await require('./team')._resolveTeam(db, req);
    if (team.memberIds.length > 500) throw new Error('team_too_large');
    const active = [], names = {};
    for (let i = 0; i < team.memberIds.length; i += CHUNK) {
      const ids = team.memberIds.slice(i, i + CHUNK);
      const [profiles, map] = await Promise.all([
        db.from('user_profiles').select('user_id,active').in('user_id', ids).range(0, CHUNK - 1), nameMapFor(db, ids, {}),
      ]);
      if (profiles.error) throw new Error('calendar_storage_error');
      active.push(...(profiles.data || []).filter(p => p.active !== false).map(p => p.user_id));
      Object.assign(names, map);
    }
    const calendarService = service();
    const reps = [];
    // Bounded three-at-a-time Google reads, independent of recording sync/drains.
    const pending = [...active];
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const id = pending.shift();
        try { reps.push({ user_id: id, name: names[id], ...await calendarService.schedule(id, range) }); }
        catch (_) { reps.push({ user_id: id, name: names[id], state: 'sync_failed', count: null, appointments: [] }); }
      }
    }));
    res.json({ ...range, team: { label: team.label }, reps: reps.sort((a, b) => a.name.localeCompare(b.name)) });
  }));
  return router;
}
module.exports = createCalendarRouter();
module.exports.createCalendarRouter = createCalendarRouter;
