const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeAnalytics, loadSessionObjections } = require('../lib/session-analytics');

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
var LOG_HARD_CAP = 10000;

// /admin/sessions and /admin/sessions/:id/logs expanded from owner-only to
// admin+owner so the redesigned /admin page works for both roles. Scope
// filtering inside each route keeps admins bounded to self + managed users.
var protect = [requireAuth, requireRole(['admin', 'owner'])];

// Returns null for owners ("all users visible") or an array of allowed
// user_ids for admins (self + users where managed_by = self). Callers pass
// the result into a query via .in('user_id', ids) when non-null.
async function getAllowedUserIds(admin, user) {
  if (user.role === 'owner') return null;
  var managedResult = await admin
    .from('user_profiles')
    .select('user_id')
    .eq('managed_by', user.id);
  if (managedResult.error) throw new Error('managed lookup failed: ' + managedResult.error.message);
  var ids = [user.id];
  (managedResult.data || []).forEach(function(p) { if (p && p.user_id) ids.push(p.user_id); });
  return ids;
}

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
  var filterUserId = req.query.user_id || null;

  try {
    var admin = getAdminClient();
    var allowedUserIds = await getAllowedUserIds(admin, req.user);

    // Reject out-of-scope filter requests (admin trying to view a user they
    // don't manage). Null allowedUserIds means owner — skip the check.
    if (filterUserId && allowedUserIds && allowedUserIds.indexOf(filterUserId) === -1) {
      console.warn('[admin] Out-of-scope filter blocked: actor=%s (%s) attempted_user=%s',
        req.user.email, req.user.id, filterUserId);
      return res.status(403).json({ error: 'Cannot filter to that user' });
    }

    var q = admin
      .from('call_sessions')
      .select('session_id, user_id, started_at, ended_at, outcome, client_version, platform')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('started_at', before);
    if (filterUserId) {
      q = q.eq('user_id', filterUserId);
    } else if (allowedUserIds) {
      q = q.in('user_id', allowedUserIds);
    }

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
// Session metadata + up to LOG_HARD_CAP (10000) log rows. `total_count` is the
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

    // Admin-scope check: owners see any session; admins only sessions from
    // users in their scope. 404 (not 403) on mismatch to avoid leaking
    // session-id existence.
    if (req.user.role !== 'owner') {
      var allowedUserIds = await getAllowedUserIds(admin, req.user);
      if (allowedUserIds && allowedUserIds.indexOf(session.user_id) === -1) {
        console.warn('[admin] Scope violation: actor=%s (%s) attempted_session=%s owner=%s',
          req.user.email, req.user.id, sessionId, session.user_id);
        return res.status(404).json({ error: 'Session not found' });
      }
    }

    // count: 'exact' returns total_count independent of limit — that's how
    // the client knows whether it hit the 10000 cap.
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

// ── GET /admin/users ────────────────────────────────────────────────────────
// User management list. Owners see every signed-up user. Admins see users
// they manage (managed_by = self) plus themselves — the admin's own row is
// included so they can see their own role in context; it won't have
// role-change controls client-side.
//
// Missing user_profiles rows (signups who never completed onboarding — see
// migration 003 note) default to role='user' in the merge so the table
// still lists them. `managed_by` stays null for those users, meaning only
// owners will see them until an owner assigns them to an admin.
router.get('/users', requireAuth, requireRole(['admin', 'owner']), async function(req, res) {
  try {
    var admin = getAdminClient();
    var allUsers = await fetchUsersWithProfiles(admin);

    var visible;
    if (req.user.role === 'owner') {
      visible = allUsers;
    } else {
      // admin scope: managed users + self
      visible = allUsers.filter(function(u) {
        return u.managed_by === req.user.id || u.user_id === req.user.id;
      });
    }

    if (visible.length === 0) {
      return res.json({ users: [] });
    }

    // Single batched stats query: count sessions + latest started_at per user.
    var userIds = visible.map(function(u) { return u.user_id; });
    var sessionsResult = await admin
      .from('call_sessions')
      .select('user_id, started_at')
      .in('user_id', userIds);
    if (sessionsResult.error) {
      // Non-fatal — show users with zero stats rather than erroring the page.
      console.error('[admin] user stats query failed:', sessionsResult.error.message);
    }
    var statsMap = computeUserSessionStats(sessionsResult.data || []);

    var enriched = visible.map(function(u) {
      var s = statsMap[u.user_id] || { session_count: 0, last_session_at: null };
      return {
        user_id: u.user_id,
        email: u.email,
        role: u.role,
        managed_by: u.managed_by,
        session_count: s.session_count,
        last_session_at: s.last_session_at,
      };
    });

    res.json({ users: enriched });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] users error:', err.message);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ── PATCH /admin/users/:user_id/role ────────────────────────────────────────
// Owner-only role change. Two server-side guards:
//   1. Self-change is rejected (you can't change your own role).
//   2. Last-owner demotion is rejected (system must retain at least one owner).
// Upsert is used instead of update so un-onboarded users (no user_profiles
// row yet) can still be promoted.
var ALLOWED_ROLES = ['user', 'admin', 'owner'];

router.patch('/users/:user_id/role', requireAuth, requireRole('owner'), async function(req, res) {
  var targetId = req.params.user_id;
  var newRole = req.body && req.body.role;

  if (ALLOWED_ROLES.indexOf(newRole) === -1) {
    return res.status(400).json({ error: 'role must be one of: ' + ALLOWED_ROLES.join(', ') });
  }
  if (targetId === req.user.id) {
    console.warn('[admin] Self-role-change blocked: actor=%s (%s)', req.user.email, req.user.id);
    return res.status(403).json({ error: 'Cannot change your own role' });
  }

  try {
    var admin = getAdminClient();

    var currentResult = await admin
      .from('user_profiles')
      .select('user_id, role')
      .eq('user_id', targetId)
      .maybeSingle();
    if (currentResult.error) {
      console.error('[admin] current role lookup failed:', currentResult.error.message);
      return res.status(500).json({ error: 'Could not load target user' });
    }
    var currentRole = (currentResult.data && currentResult.data.role) || 'user';

    // No-op: avoid hitting the DB if nothing would change.
    if (currentRole === newRole) {
      return res.json({ user_id: targetId, role: currentRole });
    }

    // Last-owner guard.
    if (currentRole === 'owner' && newRole !== 'owner') {
      var countResult = await admin
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'owner');
      if (countResult.error) {
        console.error('[admin] owner count query failed:', countResult.error.message);
        return res.status(500).json({ error: 'Could not validate owner count' });
      }
      if ((countResult.count || 0) <= 1) {
        console.warn('[admin] Last-owner demote blocked: actor=%s (%s) target=%s',
          req.user.email, req.user.id, targetId);
        return res.status(403).json({ error: 'Cannot demote the last owner' });
      }
    }

    var upsertResult = await admin
      .from('user_profiles')
      .upsert({ user_id: targetId, role: newRole }, { onConflict: 'user_id' })
      .select('user_id, role')
      .single();
    if (upsertResult.error) {
      var detail = String(upsertResult.error.message || 'unknown').slice(0, 200);
      console.error('[admin] role update failed:', detail);
      return res.status(500).json({ error: 'Could not update role: ' + detail });
    }

    // Audit trail: successful role change. Expected event, not an error —
    // logged at info level so it surfaces in Railway logs and session_logs.
    console.log('[admin] Role changed: actor=%s (%s) target=%s role: %s->%s',
      req.user.email, req.user.id, targetId, currentRole, upsertResult.data.role);

    res.json({ user_id: upsertResult.data.user_id, role: upsertResult.data.role });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] role patch error:', err.message);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Fetch all auth users + all user_profiles rows, left-merge on user_id.
// Users without a profile row default to role='user', managed_by=null.
async function fetchUsersWithProfiles(admin) {
  var authResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authResult.error) throw new Error('listUsers failed: ' + authResult.error.message);
  var profilesResult = await admin
    .from('user_profiles')
    .select('user_id, role, managed_by');
  if (profilesResult.error) throw new Error('user_profiles query failed: ' + profilesResult.error.message);

  var profilesByUserId = {};
  var profiles = profilesResult.data || [];
  for (var i = 0; i < profiles.length; i++) {
    profilesByUserId[profiles[i].user_id] = profiles[i];
  }

  var authUsers = (authResult.data && authResult.data.users) || [];
  return authUsers.map(function(u) {
    var p = profilesByUserId[u.id] || {};
    return {
      user_id: u.id,
      email: u.email || null,
      role: p.role || 'user',
      managed_by: p.managed_by || null,
    };
  });
}

// [{ user_id, started_at }] → { <user_id>: { session_count, last_session_at } }
function computeUserSessionStats(rows) {
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !r.user_id) continue;
    if (!out[r.user_id]) out[r.user_id] = { session_count: 0, last_session_at: null };
    out[r.user_id].session_count += 1;
    if (!out[r.user_id].last_session_at || r.started_at > out[r.user_id].last_session_at) {
      out[r.user_id].last_session_at = r.started_at;
    }
  }
  return out;
}

// ── GET /admin/analytics/:user_id ───────────────────────────────────────────
// Same shape as /me/analytics, but for any user — admins see managed users +
// themselves, owners see anyone. Scope check enforces both: admins can only
// pull analytics for users where user_profiles.managed_by = self, plus self.
//
// Wraps shared computeAnalytics(). Defaults to last 30 days.
router.get('/analytics/:user_id', requireAuth, requireRole(['admin', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }

  try {
    var admin = getAdminClient();

    // Scope enforcement: admins can only see self + their managed users.
    // Owners can see anyone — skip the check entirely.
    if (req.user.role === 'admin' && targetUserId !== req.user.id) {
      var scopeCheck = await admin
        .from('user_profiles')
        .select('user_id, managed_by')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] analytics scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on analytics: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }

    var result = await computeAnalytics(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] analytics error:', err.message);
    res.status(500).json({ error: 'Failed to load analytics: ' + (err.message || 'unknown') });
  }
});

// ── GET /admin/sessions/:session_id/objections ──────────────────────────────
// Per-session objection drill for the admin/owner view. No user_id filter —
// requireRole upstream is the gate. (For admins, the existing
// /admin/sessions list is already scope-filtered to managed users, so by the
// time a session_id reaches here it's already been screened. Defensive
// check still happens in the analytics route above.)
router.get('/sessions/:session_id/objections', requireAuth, requireRole(['admin', 'owner']), async function(req, res) {
  var sessionId = req.params.session_id;
  try {
    var rows = await loadSessionObjections(getAdminClient(), sessionId);
    res.json({ session_id: sessionId, objections: rows });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] session-objections error:', err.message);
    res.status(500).json({ error: 'Failed to load objections' });
  }
});

// ── GET /admin/coaching/:user_id/patterns ───────────────────────────────────
// Admin/owner view of any user's coaching patterns. Reuses the same
// computation as /me/coaching/patterns — just calls it with a different
// user_id after a scope check (admins see managed users + self; owners see
// anyone). Lives on admin.js for the same reason analytics does — keeps
// caller-scope clean from cross-user-scope.
router.get('/coaching/:user_id/patterns', requireAuth, requireRole(['admin', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }

  try {
    var admin = getAdminClient();
    if (req.user.role === 'admin' && targetUserId !== req.user.id) {
      var scopeCheck = await admin
        .from('user_profiles')
        .select('user_id, managed_by')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] coaching patterns scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on coaching patterns: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }
    // Import lazily — keeps me.js as the canonical owner of the prompt; admin
    // just dispatches. The require() is at function scope to avoid a circular
    // dependency at module load (admin.js doesn't otherwise depend on me.js).
    var meRouter = require('./me');
    var result = await meRouter._computeCoachingPatterns(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] coaching patterns error:', err.message);
    res.status(500).json({ error: 'Failed to load coaching patterns: ' + (err.message || 'unknown') });
  }
});

// Pure helpers exported for tests (matches log.js `_validateLogBatch` pattern).
router._buildUserEmailMap = buildUserEmailMap;
router._computeCountsBySession = computeCountsBySession;
router._computeDurationSeconds = computeDurationSeconds;
router._computeUserSessionStats = computeUserSessionStats;

module.exports = router;
