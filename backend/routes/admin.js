const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');

var router = express.Router();

// Service-role client: bypasses RLS so an owner can read across all users.
// requireRole('owner') upstream is the access gate — the queries themselves
// are intentionally unfiltered by user_id.
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[admin] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 100;
var LOG_HARD_CAP = 2000;

var protect = [requireAuth, requireRole('owner')];

// Build a { user_id: email } map from listUsers once per list request.
// perPage=1000 is Supabase's max — covers our current scale without pagination.
// If user count ever exceeds 1000, loop over pages here.
async function buildUserEmailMap(admin) {
  var list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (list.error) throw new Error('listUsers failed: ' + list.error.message);
  var map = {};
  var users = (list.data && list.data.users) || [];
  for (var i = 0; i < users.length; i++) {
    if (users[i] && users[i].id) map[users[i].id] = users[i].email || null;
  }
  return map;
}

// [{ session_id, level }] → { <session_id>: { log_count, error_count } }
function computeCountsBySession(rows) {
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !r.session_id) continue;
    if (!out[r.session_id]) out[r.session_id] = { log_count: 0, error_count: 0 };
    out[r.session_id].log_count += 1;
    if (r.level === 'error') out[r.session_id].error_count += 1;
  }
  return out;
}

function computeDurationSeconds(startedAt, endedAt) {
  if (!endedAt) return null;
  var start = new Date(startedAt).getTime();
  var end = new Date(endedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

// ── GET /admin/sessions ─────────────────────────────────────────────────────
// Returns the latest N sessions across ALL users. `before` cursor = started_at
// ISO timestamp, strictly less-than, for paginating older pages.
router.get('/sessions', protect, async function(req, res) {
  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  var before = req.query.before;

  try {
    var admin = getAdminClient();

    var q = admin
      .from('call_sessions')
      .select('session_id, user_id, started_at, ended_at, outcome, client_version, platform')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('started_at', before);

    var sessionsResult = await q;
    if (sessionsResult.error) {
      var sDetail = String(sessionsResult.error.message || 'unknown').slice(0, 200);
      console.error('[admin] sessions query failed:', sDetail);
      return res.status(500).json({ error: 'Could not fetch sessions: ' + sDetail });
    }
    var sessions = sessionsResult.data || [];

    if (sessions.length === 0) {
      return res.json({ sessions: [] });
    }

    var emailMap = await buildUserEmailMap(admin);

    // Single batched count query across all returned sessions. At our scale
    // (tens of sessions × hundreds of logs) this is trivial; if session_logs
    // ever grows large per session, swap to a Postgres RPC with group-by.
    var sessionIds = sessions.map(function(s) { return s.session_id; });
    var logsResult = await admin
      .from('session_logs')
      .select('session_id, level')
      .in('session_id', sessionIds);
    if (logsResult.error) {
      // Non-fatal: show sessions with zero counts rather than erroring the page.
      console.error('[admin] counts query failed:', logsResult.error.message);
    }
    var countsMap = computeCountsBySession(logsResult.data || []);

    var enriched = sessions.map(function(s) {
      var counts = countsMap[s.session_id] || { log_count: 0, error_count: 0 };
      return {
        session_id: s.session_id,
        user_id: s.user_id,
        user_email: emailMap[s.user_id] || null,
        started_at: s.started_at,
        ended_at: s.ended_at,
        duration_seconds: computeDurationSeconds(s.started_at, s.ended_at),
        client_version: s.client_version,
        platform: s.platform,
        outcome: s.outcome,
        log_count: counts.log_count,
        error_count: counts.error_count,
      };
    });

    res.json({ sessions: enriched });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] sessions error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// ── GET /admin/sessions/:session_id/logs ────────────────────────────────────
// Session metadata + up to LOG_HARD_CAP (2000) log rows. `total_count` is the
// unfiltered row count so the client can display "Showing X of Y" when capped.
router.get('/sessions/:session_id/logs', protect, async function(req, res) {
  var sessionId = req.params.session_id;
  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = LOG_HARD_CAP;
  if (limit > LOG_HARD_CAP) limit = LOG_HARD_CAP;

  try {
    var admin = getAdminClient();

    var sessionResult = await admin
      .from('call_sessions')
      .select('session_id, user_id, started_at, ended_at, outcome, client_version, platform')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (sessionResult.error) {
      console.error('[admin] session fetch failed:', sessionResult.error.message);
      return res.status(500).json({ error: 'Could not load session' });
    }
    if (!sessionResult.data) {
      return res.status(404).json({ error: 'Session not found' });
    }
    var session = sessionResult.data;

    // count: 'exact' returns total_count independent of limit — that's how
    // the client knows whether it hit the 2000 cap.
    var logsResult = await admin
      .from('session_logs')
      .select('logged_at, level, tag, message', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('logged_at', { ascending: true })
      .limit(limit);
    if (logsResult.error) {
      console.error('[admin] logs fetch failed:', logsResult.error.message);
      return res.status(500).json({ error: 'Could not load logs' });
    }

    var userEmail = null;
    try {
      var userResult = await admin.auth.admin.getUserById(session.user_id);
      if (userResult && userResult.data && userResult.data.user) {
        userEmail = userResult.data.user.email || null;
      }
    } catch (e) {
      // Email is cosmetic — don't fail the request if the auth lookup misfires.
      console.error('[admin] getUserById failed:', e.message);
    }

    res.json({
      session: {
        session_id: session.session_id,
        user_id: session.user_id,
        user_email: userEmail,
        started_at: session.started_at,
        ended_at: session.ended_at,
        duration_seconds: computeDurationSeconds(session.started_at, session.ended_at),
        outcome: session.outcome,
        client_version: session.client_version,
        platform: session.platform,
      },
      logs: logsResult.data || [],
      total_count: typeof logsResult.count === 'number' ? logsResult.count : (logsResult.data || []).length,
      limit: limit,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] logs error:', err.message);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// Pure helpers exported for tests (matches log.js `_validateLogBatch` pattern).
router._buildUserEmailMap = buildUserEmailMap;
router._computeCountsBySession = computeCountsBySession;
router._computeDurationSeconds = computeDurationSeconds;

module.exports = router;
