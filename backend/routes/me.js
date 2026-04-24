const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');

var router = express.Router();

// Service-role client: bypasses RLS so the route can read the caller's
// sessions without the RLS scoped policy round-trip. Ownership is enforced
// explicitly below (user_id match from the JWT).
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
    console.error('[me] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 100;
var LOG_HARD_CAP = 2000;

// Duplicated from routes/admin.js — two tiny pure helpers. If a third
// consumer appears, extract to backend/lib/session-helpers.js.
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

// ── GET /me/sessions ────────────────────────────────────────────────────────
// Caller's own sessions. Same payload shape as /admin/sessions but
// auto-filtered to req.user.id — no email enrichment needed.
router.get('/sessions', requireAuth, async function(req, res) {
  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  var before = req.query.before;

  try {
    var admin = getAdminClient();
    var q = admin
      .from('call_sessions')
      .select('session_id, user_id, started_at, ended_at, outcome, client_version, platform')
      .eq('user_id', req.user.id)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('started_at', before);

    var sessionsResult = await q;
    if (sessionsResult.error) {
      console.error('[me] sessions query failed:', sessionsResult.error.message);
      return res.status(500).json({ error: 'Could not fetch sessions' });
    }
    var sessions = sessionsResult.data || [];
    if (sessions.length === 0) return res.json({ sessions: [] });

    var sessionIds = sessions.map(function(s) { return s.session_id; });
    var logsResult = await admin
      .from('session_logs')
      .select('session_id, level')
      .in('session_id', sessionIds);
    if (logsResult.error) {
      // Non-fatal — render with zero counts.
      console.error('[me] counts query failed:', logsResult.error.message);
    }
    var countsMap = computeCountsBySession(logsResult.data || []);

    var enriched = sessions.map(function(s) {
      var c = countsMap[s.session_id] || { log_count: 0, error_count: 0 };
      return {
        session_id: s.session_id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        duration_seconds: computeDurationSeconds(s.started_at, s.ended_at),
        client_version: s.client_version,
        platform: s.platform,
        outcome: s.outcome,
        log_count: c.log_count,
        error_count: c.error_count,
      };
    });

    res.json({ sessions: enriched });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] sessions error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// ── GET /me/sessions/:session_id/logs ───────────────────────────────────────
// Caller's own session logs. Ownership check: 404 if the session doesn't
// belong to req.user.id — prevents an authenticated user from iterating
// UUIDs to snoop on other users' logs. 404 rather than 403 to avoid
// leaking session-id validity.
router.get('/sessions/:session_id/logs', requireAuth, async function(req, res) {
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
      console.error('[me] session fetch failed:', sessionResult.error.message);
      return res.status(500).json({ error: 'Could not load session' });
    }
    if (!sessionResult.data || sessionResult.data.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }
    var session = sessionResult.data;

    var logsResult = await admin
      .from('session_logs')
      .select('logged_at, level, tag, message', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('logged_at', { ascending: true })
      .limit(limit);
    if (logsResult.error) {
      console.error('[me] logs fetch failed:', logsResult.error.message);
      return res.status(500).json({ error: 'Could not load logs' });
    }

    res.json({
      session: {
        session_id: session.session_id,
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
    console.error('[me] logs error:', err.message);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

router._computeCountsBySession = computeCountsBySession;
router._computeDurationSeconds = computeDurationSeconds;

module.exports = router;
