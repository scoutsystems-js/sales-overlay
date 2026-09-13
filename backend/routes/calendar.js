'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CHUNK } = require('../lib/chunk');
const { resolveDisplayName } = require('../lib/display-name');
const { createGoogleClient, validateInspectionRange } = require('../lib/google-calendar');
const { readConfig, createCalendarService } = require('../lib/calendar-service');
const teamRouter = require('./team');
const TEAM_READ_CONCURRENCY = 4;
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

async function activeProfiles(admin, memberIds) {
  const batches = [];
  for (let index = 0; index < memberIds.length; index += CHUNK) batches.push(memberIds.slice(index, index + CHUNK));
  const results = await Promise.all(batches.map(ids => admin.from('user_profiles')
    .select('user_id,first_name,last_name,active').in('user_id', ids)));
  const failed = results.find(result => result.error);
  if (failed) throw new Error('calendar_storage_error');
  const byId = new Map(results.flatMap(result => result.data || []).filter(profile => profile.active !== false).map(profile => [profile.user_id, profile]));
  return memberIds.map(id => byId.get(id)).filter(Boolean);
}

async function mapBounded(items, read) {
  let output = [];
  for (let index = 0; index < items.length; index += TEAM_READ_CONCURRENCY) {
    output = [...output, ...await Promise.all(items.slice(index, index + TEAM_READ_CONCURRENCY).map(read))];
  }
  return output;
}

async function currentViewerProfile(admin, userId) {
  const result = await admin.from('user_profiles').select('user_id,role,active').eq('user_id', userId).maybeSingle();
  if (result.error) throw new Error('calendar_storage_error');
  return result.data;
}

function createCalendarRouter(options = {}) {
  const router = express.Router();
  const admin = options.admin || defaultAdmin;
  const config = options.config || readConfig;
  const authenticate = options.authenticate || requireAuth;
  const resolveTeam = options.resolveTeam || teamRouter._resolveTeam;
  const service = options.service || (() => createCalendarService(admin(), createGoogleClient(), config()));
  const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: config().redirectUri.startsWith('https:'), path: '/calendar', maxAge: 600000 });
  const run = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) {
      const code = error.message;
      const status = ['invalid_range', 'invalid_state', 'calendar_origin_mismatch'].includes(code) ? 400
        : ['not_connected'].includes(code) ? 409 : code === 'calendar_not_configured' ? 503 : error.status || 502;
      res.status(status).json({ error: MESSAGES[code] || 'Calendar could not be loaded. Try again.', code: MESSAGES[code] ? code : 'calendar_unavailable' });
    }
  };

  router.post('/sync-all', run(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      const error = new Error('calendar_not_configured'); error.status = 503; throw error;
    }
    if ((req.get('X-Cron-Secret') || '') !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const summary = await service().syncAll();
    const allProviderReadsFailed = summary.total > 0 && summary.ok === 0 && summary.errors > 0;
    const allReconciliationFailed = summary.reconciliation_total > 0
      && summary.owners_reconciled === 0 && summary.reconciliation_errors > 0;
    res.status(allProviderReadsFailed || allReconciliationFailed ? 502 : 200).json(summary);
  }));

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
  router.get('/team', authenticate, requireRole(['manager', 'owner']), run(async (req, res) => {
    const range = validateInspectionRange(req.query.from, req.query.to);
    const database = admin();
    const team = await resolveTeam(database, req);
    const profiles = await activeProfiles(database, team.memberIds || []);
    const viewer = { id: req.user.id, role: req.userProfileRole || req.user.role };
    const readMembers = await mapBounded(profiles, async profile => {
      const result = await service().sharedCount(viewer, profile.user_id, range);
      return { user_id: profile.user_id, name: resolveDisplayName(profile, null, profile.user_id), status: result.status,
        ...(result.status === 'ready' ? { count: result.count, generation: result.generation } : {}) };
    });

    // External reads create a permission race. Resolve the actor, team and
    // active member set again before any result crosses the response boundary.
    const currentViewer = await currentViewerProfile(database, req.user.id);
    if (!currentViewer || currentViewer.active === false || !['manager', 'owner'].includes(currentViewer.role)) {
      const error = new Error('calendar_team_access_changed'); error.status = 403; throw error;
    }
    req.user.role = currentViewer.role;
    req.userProfileRole = currentViewer.role;
    const currentTeam = await resolveTeam(database, req);
    const currentProfiles = await activeProfiles(database, currentTeam.memberIds || []);
    const currentById = new Map(currentProfiles.map(profile => [profile.user_id, profile]));
    const stillAuthorized = readMembers.filter(member => currentById.has(member.user_id));
    const finalViewer = { id: req.user.id, role: currentViewer.role };
    const revalidated = await mapBounded(stillAuthorized, async member => {
      if (member.status !== 'ready') return member;
      const current = await service().revalidateSharedCount(finalViewer, member.user_id, member.generation);
      return current.status === 'ready' ? member : { ...member, status: current.status, count: undefined };
    });
    const members = revalidated.map(member => ({
      user_id: member.user_id,
      name: resolveDisplayName(currentById.get(member.user_id), null, member.user_id),
      status: member.status,
      ...(member.status === 'ready' ? { count: member.count } : {}),
    }));
    res.json({ ...range, team_label: currentTeam.label, members });
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
