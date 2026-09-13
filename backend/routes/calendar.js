'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');
const { createGoogleClient, validateInspectionRange } = require('../lib/google-calendar');
const { readConfig, createCalendarService } = require('../lib/calendar-service');
const COOKIE = 'scout_calendar_state';
const MESSAGES = {
  calendar_not_configured: 'Google Calendar setup is not enabled yet.',
  calendar_origin_mismatch: 'Open calendar setup on Scout’s configured sign-in address.',
  invalid_range: 'Choose no more than 14 days to inspect.',
  invalid_state: 'This connection link expired. Start again in Scout.',
  calendar_not_available: 'Scout could not read the primary calendar on this Google account.',
  google_reconnect: 'Reconnect Google Calendar to continue.',
  google_scope_missing: 'Allow both read-only calendar permissions, then try again.',
  not_connected: 'Connect Google Calendar first.',
  google_access_denied: 'Google did not allow access to this calendar. Check its permissions.',
  connection_changed: 'The calendar was disconnected while Scout was reading it.',
};

function defaultAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('calendar_not_configured');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function browserStateMatches(req) {
  const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='));
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
      const status = ['invalid_range', 'invalid_state', 'calendar_origin_mismatch'].includes(code) ? 400
        : code === 'not_connected' ? 409 : code === 'calendar_not_configured' ? 503 : error.status || 502;
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
    if (!configured) return res.json({ configured: false, connected: false });
    res.json({ configured: true, connect_origin: new URL(config().redirectUri).origin, ...await service().status(req.user.id) });
  }));
  router.get('/inspection', authenticate, run(async (req, res) => {
    const range = validateInspectionRange(req.query.from, req.query.to);
    // No requested user id is accepted: this route can only inspect the
    // authenticated user's own encrypted Google connection.
    res.json(await service().inspect(req.user.id, range));
  }));
  router.delete('/connection', authenticate, run(async (req, res) => {
    const result = await service().disconnect(req.user.id);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true, ...result });
  }));
  return router;
}

module.exports = createCalendarRouter();
module.exports.createCalendarRouter = createCalendarRouter;
