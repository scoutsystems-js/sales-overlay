const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeCallAnalytics, computeObjectionIntel } = require('../lib/session-analytics');
const { computeObjectionSynthesis } = require('../lib/objection-synthesis');
const { computePerformanceSynthesis } = require('../lib/performance-synthesis');
const { computePersonalNeedsWork, loadBucketEvidence } = require('../lib/team-needs-work');
const { fetchSellingContext } = require('../lib/selling-context');
const welcomeEmail = require('../lib/welcome-email');
const { canManageTarget, deleteBlockReason, deactivateBlockReason } = require('../lib/user-management');
const { CANONICAL_ORIGIN } = require('../config');
const { linkTargetsSetPassword } = require('../lib/recovery-link');
const provisionUser = require('../lib/provision-user');
const fathomRoutes = require('./fathom'); // for _loadCallsList / _parseCallListOpts (admin-pivot call list)

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
var protect = [requireAuth, requireRole(['manager', 'owner'])];

// Loads {role, managed_by, active} for a target user (or null).
async function loadTargetProfile(admin, targetId) {
  var r = await admin.from('user_profiles').select('role, managed_by, active').eq('user_id', targetId).maybeSingle();
  if (r.error) throw new Error('target lookup: ' + r.error.message);
  return r.data || null;
}
// Manager rep-scope guard. Sends a 404/403 and returns true when the actor may
// NOT manage the target (owner: anyone; manager: only own reps). false = proceed.
function denyIfCannotManage(req, res, target) {
  if (!target) { res.status(404).json({ error: 'User not found' }); return true; }
  if (!canManageTarget(req.user.role, req.user.id, target)) {
    console.warn('[admin] scope violation: actor=%s (%s) target=%s', req.user.email, req.user.id, req.params.user_id);
    res.status(403).json({ error: 'Not authorized for that user' }); return true;
  }
  return false;
}
// Count of reps a user manages (for the deactivate "move reps first" guard).
async function countManagedReps(admin, userId) {
  var r = await admin.from('user_profiles').select('user_id', { count: 'exact', head: true }).eq('managed_by', userId);
  return r.error ? 0 : (r.count || 0);
}
// Total recorded calls for the zero-history delete gate (fathom + sessions).
async function countUserHistory(admin, userId) {
  var fc = await admin.from('fathom_calls').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  var cs = await admin.from('call_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return { calls: fc.error ? 0 : (fc.count || 0), sessions: cs.error ? 0 : (cs.count || 0) };
}

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

// ── GET /admin/sessions/:session_id/logs ────────────────────────────────────
// Session metadata + up to LOG_HARD_CAP (10000) log rows. `total_count` is the
// unfiltered row count so the client can display "Showing X of Y" when capped.

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
router.get('/users', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
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
        billing_status: u.billing_status,
        billing_plan: u.billing_plan,
        active: u.active,
        first_name: u.first_name,
        last_name: u.last_name,
        created_at: u.created_at,
        session_count: s.session_count,
        last_session_at: s.last_session_at,
      };
    });

    // Seat count = active users in the visible scope (billing: seat = active user).
    var seatsActive = visible.filter(function (u) { return u.active !== false; }).length;
    res.json({ users: enriched, seats_active: seatsActive, seats_total: visible.length });
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
var ALLOWED_ROLES = ['user', 'manager', 'owner'];

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

// ── PATCH /admin/users/:user_id/managed_by ──────────────────────────────────
// Owner-only. Assign/unassign a user to a manager (the v1.4 team-assignment
// mechanism). managed_by may be a manager/owner user_id, or null to unassign.
// Same audit-logging shape as the role change route.
router.patch('/users/:user_id/managed_by', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetId = req.params.user_id;
  var body = req.body || {};
  var newManagedBy = (body.managed_by === null || body.managed_by === undefined || body.managed_by === '') ? null : body.managed_by;

  // Reassignment only — never unassign (a rep always has an owner/manager).
  if (!newManagedBy) {
    return res.status(400).json({ error: 'A rep must be reassigned to another manager (unassign is not allowed)' });
  }
  // Reject self-assignment BEFORE the DB fires (mirror the no_self_manage check
  // with a clear 400 rather than surfacing a raw constraint error).
  if (newManagedBy === targetId) {
    return res.status(400).json({ error: 'A user cannot be managed by themselves' });
  }

  try {
    var admin = getAdminClient();

    // Rep-scope: a manager may only move a rep they currently manage.
    var moveTarget = await loadTargetProfile(admin, targetId);
    if (denyIfCannotManage(req, res, moveTarget)) return;

    // If assigning, the manager must exist and hold role manager or owner.
    if (newManagedBy) {
      var mgr = await admin.from('user_profiles').select('role').eq('user_id', newManagedBy).maybeSingle();
      if (mgr.error) { console.error('[admin] managed_by manager lookup failed:', mgr.error.message); return res.status(500).json({ error: 'Could not verify manager' }); }
      var mgrRole = mgr.data && mgr.data.role;
      if (mgrRole !== 'manager' && mgrRole !== 'owner') {
        return res.status(400).json({ error: 'managed_by must be a user with role manager or owner' });
      }
    }

    var cur = await admin.from('user_profiles').select('managed_by').eq('user_id', targetId).maybeSingle();
    if (cur.error) { console.error('[admin] managed_by current lookup failed:', cur.error.message); return res.status(500).json({ error: 'Could not load target user' }); }
    var currentManagedBy = (cur.data && cur.data.managed_by) || null;
    if (currentManagedBy === newManagedBy) return res.json({ user_id: targetId, managed_by: newManagedBy });

    var up = await admin.from('user_profiles')
      .upsert({ user_id: targetId, managed_by: newManagedBy }, { onConflict: 'user_id' })
      .select('user_id, managed_by').single();
    if (up.error) {
      var detail = String(up.error.message || 'unknown').slice(0, 200);
      console.error('[admin] managed_by update failed:', detail);
      return res.status(500).json({ error: 'Could not update manager assignment: ' + detail });
    }
    console.log('[admin] managed_by changed: actor=%s (%s) target=%s %s->%s',
      req.user.email, req.user.id, targetId, currentManagedBy || 'none', newManagedBy || 'none');
    res.json({ user_id: up.data.user_id, managed_by: up.data.managed_by });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] managed_by patch error:', err.message);
    res.status(500).json({ error: 'Failed to update manager assignment' });
  }
});

// ── PATCH /admin/users/:user_id/billing_status ──────────────────────────────
// Owner-only. Manual billing status until Stripe. Allowlisted values.
var BILLING_STATUSES = ['trial', 'active', 'past_due', 'canceled'];
router.patch('/users/:user_id/billing_status', requireAuth, requireRole('owner'), async function(req, res) {
  var targetId = req.params.user_id;
  var newStatus = req.body && req.body.billing_status;
  if (BILLING_STATUSES.indexOf(newStatus) === -1) {
    return res.status(400).json({ error: 'billing_status must be one of: ' + BILLING_STATUSES.join(', ') });
  }
  try {
    var admin = getAdminClient();
    var cur = await admin.from('user_profiles').select('billing_status').eq('user_id', targetId).maybeSingle();
    if (cur.error) { console.error('[admin] billing current lookup failed:', cur.error.message); return res.status(500).json({ error: 'Could not load target user' }); }
    var currentStatus = (cur.data && cur.data.billing_status) || 'trial';
    if (currentStatus === newStatus) return res.json({ user_id: targetId, billing_status: newStatus });

    var up = await admin.from('user_profiles')
      .upsert({ user_id: targetId, billing_status: newStatus }, { onConflict: 'user_id' })
      .select('user_id, billing_status').single();
    if (up.error) {
      var detail = String(up.error.message || 'unknown').slice(0, 200);
      console.error('[admin] billing update failed:', detail);
      return res.status(500).json({ error: 'Could not update billing status: ' + detail });
    }
    console.log('[admin] billing_status changed: actor=%s (%s) target=%s %s->%s',
      req.user.email, req.user.id, targetId, currentStatus, up.data.billing_status);
    res.json({ user_id: up.data.user_id, billing_status: up.data.billing_status });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] billing patch error:', err.message);
    res.status(500).json({ error: 'Failed to update billing status' });
  }
});

// ── POST /admin/users ───────────────────────────────────────────────────────
// Owner-only manual user creation with a server-generated temp password.
// Owners are NEVER created this way (role limited to user|manager). Both-or-
// neither: if the profile insert fails after the auth user is created, the auth
// user is deleted so no orphan remains. The temp password is returned ONCE and
// is never stored or logged (the audit line logs the event, not the password).
// Mint a one-time set-password action link (Supabase recovery-type — invite
// type rejects existing users; generateLink never sends Supabase's own email).
// Returns the action link, or null on failure (logged; no token exists in
// mint-failure messages). Requires the Supabase Auth redirect allowlist to
// include CANONICAL_ORIGIN + '/set-password'.
async function mintSetPasswordLink(admin, email) {
  var r = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: email,
    options: { redirectTo: CANONICAL_ORIGIN + '/set-password' },
  });
  if (r.error || !r.data || !r.data.properties || !r.data.properties.action_link) {
    console.error('[admin] set-password link mint failed for ' + email + ': ' + ((r.error && r.error.message) || 'no action_link in response'));
    return null;
  }
  // GoTrue silently swaps in the project Site URL when redirect_to isn't
  // allowlisted (observed in recon: links pointed at localhost:3000). A link
  // that won't land on our set-password page is a broken invite — fail loudly
  // instead of reporting 'invite_sent' on a dud.
  var link = r.data.properties.action_link;
  if (!linkTargetsSetPassword(link)) {
    console.error('[admin] set-password link mint REJECTED for ' + email + ': redirect_to was not honored — add ' + CANONICAL_ORIGIN + '/set-password to the Supabase Auth redirect allowlist (Dashboard → Auth → URL Configuration)');
    return null;
  }
  return link;
}

// Shared by create + resend: mint the link, send the welcome email, and map to
// a console status. Isolation contract: never throws; any failure → 'failed'.
async function sendWelcomeInvite(admin, email, firstName) {
  if (!welcomeEmail.isConfigured()) return 'not_configured';
  try {
    var link = await mintSetPasswordLink(admin, email);
    if (!link) return 'failed';
    var sent = await welcomeEmail.sendWelcomeEmail({ firstName: firstName, email: email, actionLink: link });
    return sent.sent ? 'invite_sent' : 'failed';
  } catch (err) {
    console.error('[admin] welcome invite threw unexpectedly (creation unaffected): ' + (err && err.message));
    return 'failed';
  }
}

// ── POST /admin/reset-diagnose (owner-only) ──────────────────────────────────
// Visibility for FD-1: an owner can tell WHY a password reset didn't arrive —
// no Scout account, a rejected/dud link, or email transport off — WITHOUT reading
// Railway logs. Dry run: mints the recovery link exactly as the real endpoint
// (redirect_to = /set-password?flow=reset) and runs the same guard, but sends
// NOTHING. Owner-gated, so revealing account existence here is fine; the public
// POST /auth/forgot-password stays enumeration-safe (the requester sees no change).
router.post('/reset-diagnose', requireAuth, requireRole(['owner']), async function(req, res) {
  try {
    var raw = req.body && req.body.email;
    if (typeof raw !== 'string' || raw.indexOf('@') === -1) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    var email = raw.trim().toLowerCase();
    if (!welcomeEmail.isConfigured()) {
      return res.json({ status: 'email_not_configured', message: 'RESEND_API_KEY is unset — no reset email can be sent for anyone until it is configured.' });
    }
    var admin = getAdminClient();
    var r = await admin.auth.admin.generateLink({
      type: 'recovery', email: email,
      options: { redirectTo: CANONICAL_ORIGIN + '/set-password?flow=reset' },
    });
    if (r.error || !r.data || !r.data.properties || !r.data.properties.action_link) {
      return res.json({ status: 'no_account', message: 'No Scout account for this email. A real request returns the same neutral message but sends nothing.' });
    }
    if (!linkTargetsSetPassword(r.data.properties.action_link)) {
      var resolved = '';
      try { resolved = new URL(r.data.properties.action_link).searchParams.get('redirect_to') || ''; } catch (e) {}
      return res.json({ status: 'link_rejected', message: 'A link was minted but does not target /set-password (redirect-allowlist / Site-URL fallback). It would be refused — no email sends.', resolved_redirect: resolved });
    }
    return res.json({ status: 'would_send', message: 'All good — a real reset request for this email would email a working link.' });
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) return res.status(503).json({ error: err.message });
    console.error('[admin] reset-diagnose error: ' + (err && err.message));
    return res.status(500).json({ error: 'Diagnostic failed. Please try again.' });
  }
});

var CREATE_ROLES = ['user', 'manager'];
router.post('/users', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var body = req.body || {};
  var email = (typeof body.email === 'string') ? body.email.trim() : '';
  var role = body.role;
  var managedBy = (body.managed_by === null || body.managed_by === undefined || body.managed_by === '') ? null : body.managed_by;
  // ⚠ NORMALISED ON THE WAY IN (ruling 2026-08-17). "josh" is saved as "Josh", so
  // every reader — screens, prompts, exports — gets it right from one write
  // instead of each render fixing it. A name the person capitalised themselves is
  // left exactly as typed; see lib/display-name.js.
  var firstName = normalizeName(body.first_name);
  var lastName = normalizeName(body.last_name);

  // A manager may only create their OWN reps: force managed_by=self and role=user
  // (only an owner can mint managers or assign a rep to a different manager).
  if (req.user.role !== 'owner') {
    managedBy = req.user.id;
    role = 'user';
  }

  if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'A valid email is required' });
  if (CREATE_ROLES.indexOf(role) === -1) return res.status(400).json({ error: 'role must be one of: user, manager (owners are not created here)' });
  if (!firstName || firstName.length > 60) return res.status(400).json({ error: 'first_name is required (1-60 chars)' });
  if (!lastName || lastName.length > 60) return res.status(400).json({ error: 'last_name is required (1-60 chars)' });

  try {
    var admin = getAdminClient();

    if (managedBy) {
      var mgr = await admin.from('user_profiles').select('role').eq('user_id', managedBy).maybeSingle();
      if (mgr.error) { console.error('[admin] create-user manager lookup failed:', mgr.error.message); return res.status(500).json({ error: 'Could not verify manager' }); }
      var mgrRole = mgr.data && mgr.data.role;
      if (mgrRole !== 'manager' && mgrRole !== 'owner') return res.status(400).json({ error: 'managed_by must be a user with role manager or owner' });
    }

    // Strong temp password — generated server-side, returned once, never logged.
    var tempPassword = crypto.randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16) + 'aA1!';

    // Atomic provisioning (ruling 2026-07-31): fully succeed or leave nothing new
    // behind, and reclaim a stale orphan (auth row with no profile) instead of
    // failing "already registered" on a fresh-looking email. See lib/provision-user.
    var deps = {
      createAuthUser: async function (em, pw) {
        var r = await admin.auth.admin.createUser({ email: em, password: pw, email_confirm: true });
        return r.error ? { error: r.error.message } : { id: r.data.user.id };
      },
      findAuthUserByEmail: async function (em) {
        // Current scale is tiny; listUsers(perPage:1000) is fine. Revisit if users > 1000.
        var lu = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (lu.error) return null;
        var f = (lu.data.users || []).find(function (u) { return (u.email || '').toLowerCase() === em.toLowerCase(); });
        return f ? { id: f.id } : null;
      },
      profileExists: async function (uid) {
        var p = await admin.from('user_profiles').select('user_id').eq('user_id', uid).maybeSingle();
        return !p.error && !!(p.data && p.data.user_id);
      },
      setPassword: async function (uid, pw) {
        var u = await admin.auth.admin.updateUserById(uid, { password: pw });
        return u.error ? { error: u.error.message } : {};
      },
      insertProfile: async function (uid, f) {
        var ins = await admin.from('user_profiles').upsert(
          { user_id: uid, role: f.role, managed_by: f.managed_by, billing_status: 'trial', first_name: f.firstName, last_name: f.lastName },
          { onConflict: 'user_id' });
        return ins.error ? { error: ins.error.message } : {};
      },
      deleteAuthUser: async function (uid) {
        try { var d = await admin.auth.admin.deleteUser(uid); return (d && d.error) ? { error: d.error.message } : {}; }
        catch (e) { return { error: e.message }; }
      },
    };
    var prov = await provisionUser(deps, { email: email, role: role, managedBy: managedBy, firstName: firstName, lastName: lastName, password: tempPassword });
    if (!prov.ok) {
      if (prov.code === 'duplicate') return res.status(409).json({ error: prov.error });
      if (prov.code === 'rollback_failed') { console.error('[admin] create-user CRITICAL: ' + prov.error); return res.status(500).json({ error: 'Could not create the user. Please try again or contact support.' }); }
      console.error('[admin] create-user failed (' + prov.code + '): ' + prov.error);
      return res.status(prov.code === 'create_failed' ? 400 : 500).json({ error: prov.error });
    }
    var newId = prov.user_id;
    if (prov.reclaimed) console.log('[admin] create-user reclaimed a stale orphan auth row for ' + email + ' (id=' + newId + ')');

    // Audit the creation event — includes the name, but NEVER the temp password.
    console.log('[admin] User created: actor=%s (%s) new=%s (%s) name="%s %s" role=%s managed_by=%s',
      req.user.email, req.user.id, email, newId, firstName, lastName, role, managedBy || 'none');

    // Welcome email — AFTER the rollback-able section (user + profile are
    // committed), so no email outcome can ever unwind or fail the creation.
    // sendWelcomeEmail never throws (KB/digest isolation contract); the extra
    // try/catch is belt-and-braces so even a lib bug can't 500 this request.
    // Awaited deliberately: the console shows the TRUE sent/failed status.
    var welcomeStatus = await sendWelcomeInvite(admin, email, firstName);

    res.json({ user_id: newId, email: email, first_name: firstName, last_name: lastName, role: role, managed_by: managedBy, billing_status: 'trial', temp_password: tempPassword, welcome_email: welcomeStatus });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] create-user error:', err.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ── POST /admin/users/:user_id/welcome-email ─────────────────────────────────
// Owner-only resend: mints a FRESH set-password link (supersedes any prior
// one) and sends the welcome email again. Same isolation contract as creation
// — failures report status, never 500 for email reasons.
router.post('/users/:user_id/welcome-email', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  try {
    var admin = getAdminClient();
    var uid = req.params.user_id;
    // Rep-scope: a manager may only send a reset link to their own reps.
    var t = await loadTargetProfile(admin, uid);
    if (denyIfCannotManage(req, res, t)) return;
    var got = await admin.auth.admin.getUserById(uid);
    if (got.error || !got.data || !got.data.user) return res.status(404).json({ error: 'user not found' });
    var email = got.data.user.email;
    var prof = await admin.from('user_profiles').select('first_name').eq('user_id', uid).maybeSingle();
    var firstName = (prof.data && prof.data.first_name) || 'there';
    var status = await sendWelcomeInvite(admin, email, firstName);
    console.log('[admin] welcome-email resend: actor=%s target=%s status=%s', req.user.id, uid, status);
    res.json({ welcome_email: status, email: email });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] welcome-email resend error:', err.message);
    res.status(500).json({ error: 'Failed to resend welcome email' });
  }
});

// ── POST /admin/users/:user_id/deactivate — ban + active=false (frees a seat) ──
// manager (own reps) + owner. Blocks self, owners, and managers who still have
// reps (move them first). Ban blocks new login+refresh; the active flag is what
// rejects a still-valid access token (see middleware/auth.js).
router.post('/users/:user_id/deactivate', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  try {
    var admin = getAdminClient();
    var uid = req.params.user_id;
    var t = await loadTargetProfile(admin, uid);
    if (denyIfCannotManage(req, res, t)) return;
    var repCount = (t.role === 'manager' || t.role === 'owner') ? await countManagedReps(admin, uid) : 0;
    var reason = deactivateBlockReason({ actorId: req.user.id, targetId: uid, targetRole: t.role, repCount: repCount });
    if (reason) return res.status(409).json({ error: reason });

    var banned = await admin.auth.admin.updateUserById(uid, { ban_duration: '876000h' }); // ~100y
    if (banned.error) return res.status(500).json({ error: 'Could not deactivate: ' + banned.error.message });
    var up = await admin.from('user_profiles').upsert({ user_id: uid, active: false }, { onConflict: 'user_id' }).select('user_id, active').single();
    if (up.error) {
      // roll the ban back so state stays consistent
      await admin.auth.admin.updateUserById(uid, { ban_duration: 'none' }).catch(function () {});
      return res.status(500).json({ error: 'Could not deactivate: ' + up.error.message });
    }
    console.log('[admin] user deactivated: actor=%s (%s) target=%s', req.user.email, req.user.id, uid);
    res.json({ user_id: uid, active: false });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] deactivate error:', err.message);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// ── POST /admin/users/:user_id/reactivate — un-ban + active=true (adds a seat) ─
router.post('/users/:user_id/reactivate', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  try {
    var admin = getAdminClient();
    var uid = req.params.user_id;
    var t = await loadTargetProfile(admin, uid);
    if (denyIfCannotManage(req, res, t)) return;
    var unban = await admin.auth.admin.updateUserById(uid, { ban_duration: 'none' });
    if (unban.error) return res.status(500).json({ error: 'Could not reactivate: ' + unban.error.message });
    var up = await admin.from('user_profiles').upsert({ user_id: uid, active: true }, { onConflict: 'user_id' }).select('user_id, active').single();
    if (up.error) return res.status(500).json({ error: 'Could not reactivate: ' + up.error.message });
    console.log('[admin] user reactivated: actor=%s (%s) target=%s', req.user.email, req.user.id, uid);
    res.json({ user_id: uid, active: true });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] reactivate error:', err.message);
    res.status(500).json({ error: 'Failed to reactivate user' });
  }
});

// ── PATCH /admin/users/:user_id/email — change login email + notify OLD address ─
// manager (own reps) + owner. The old address is emailed a heads-up (account-
// takeover safeguard) naming what changed and who did it — best-effort, never
// blocks or fails the change.
router.patch('/users/:user_id/email', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  try {
    var admin = getAdminClient();
    var uid = req.params.user_id;
    var newEmail = (req.body && typeof req.body.email === 'string') ? req.body.email.trim() : '';
    if (!newEmail || newEmail.indexOf('@') === -1) return res.status(400).json({ error: 'A valid email is required' });
    var t = await loadTargetProfile(admin, uid);
    if (denyIfCannotManage(req, res, t)) return;
    var got = await admin.auth.admin.getUserById(uid);
    if (got.error || !got.data || !got.data.user) return res.status(404).json({ error: 'user not found' });
    var oldEmail = got.data.user.email;
    if (oldEmail && oldEmail.toLowerCase() === newEmail.toLowerCase()) return res.json({ user_id: uid, email: oldEmail });

    var upd = await admin.auth.admin.updateUserById(uid, { email: newEmail, email_confirm: true });
    if (upd.error) return res.status(400).json({ error: upd.error.message });
    console.log('[admin] email changed: actor=%s (%s) target=%s', req.user.email, req.user.id, uid);
    // Notify the OLD address — best-effort, isolated from the change outcome.
    var notified = 'skipped';
    if (oldEmail) {
      try { var r = await welcomeEmail.sendEmailChangeNotice({ oldEmail: oldEmail, newEmail: newEmail, actorEmail: req.user.email }); notified = r && r.sent ? 'sent' : (r && r.reason ? r.reason : 'failed'); }
      catch (e) { notified = 'failed'; console.error('[admin] email-change notice threw (change unaffected): ' + (e && e.message)); }
    }
    res.json({ user_id: uid, email: newEmail, old_notified: notified });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] email change error:', err.message);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

// ── DELETE /admin/users/:user_id — OWNER-ONLY, zero-history gate ────────────────
// A user with ANY recorded call cannot be hard-deleted (call history is the
// company's asset) → 409, steer to deactivate. Hard delete cascades the empty
// profile/rows. (2026-07-31: the typed-email confirmation was removed as redundant
// friction — delete is already owner-only + zero-history-gated; a plain
// name-the-user warning dialog on the client is the confirmation now.)
router.delete('/users/:user_id', requireAuth, requireRole('owner'), async function(req, res) {
  try {
    var admin = getAdminClient();
    var uid = req.params.user_id;
    if (uid === req.user.id) return res.status(400).json({ error: 'You can’t delete your own account.' });
    var got = await admin.auth.admin.getUserById(uid);
    if (got.error || !got.data || !got.data.user) return res.status(404).json({ error: 'user not found' });
    var email = got.data.user.email;
    var hist = await countUserHistory(admin, uid);
    var block = deleteBlockReason(hist.calls, hist.sessions);
    if (block) return res.status(409).json({ error: block });

    var del = await admin.auth.admin.deleteUser(uid);
    if (del.error) return res.status(500).json({ error: 'Could not delete user: ' + del.error.message });
    console.log('[admin] user DELETED: actor=%s (%s) target=%s (%s)', req.user.email, req.user.id, uid, email);
    res.json({ deleted: true, user_id: uid });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ── GET /admin/needs-work/:user_id — personal What-needs-work for a pivoted rep ─
router.get('/needs-work/:user_id', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  // Range-responsive (default 90d), same as /me/needs-work.
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  try {
    var admin = getAdminClient();
    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var t = await loadTargetProfile(admin, targetUserId);
      if (!t || t.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on needs-work: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }
    var result = await computePersonalNeedsWork(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] needs-work error:', err.message);
    res.status(500).json({ error: 'Failed to load needs-work' });
  }
});

// ── POST /admin/needs-work/:user_id/bucket — per-call bucket evidence (pivot) ─
router.post('/needs-work/:user_id/bucket', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var b = req.body || {};
  var surfaces = Array.isArray(b.surfaces) ? b.surfaces.slice(0, 200) : null;
  if (!surfaces || !surfaces.length) return res.status(400).json({ error: 'surfaces[] required' });
  var to = b.to || new Date().toISOString();
  var from = b.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    var admin = getAdminClient();
    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var t = await loadTargetProfile(admin, targetUserId);
      if (!t || t.managed_by !== req.user.id) return res.status(403).json({ error: 'Not authorized for that user' });
    }
    var rows = await loadBucketEvidence(admin, [targetUserId], surfaces, from, to);
    res.json({ calls: rows });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] needs-work bucket error:', err.message);
    res.status(500).json({ error: 'Failed to load bucket evidence' });
  }
});

// ── GET /admin/selling-context/:user_id ─────────────────────────────────────
// Verification harness (owner-only, read-only): resolves the KB selling context
// for a user WITHOUT running an analysis — so scope resolution can be verified
// (sources, char count, hash). Optional ?maxchars= (default 5000, the grader cap).
router.get('/selling-context/:user_id', requireAuth, requireRole('owner'), async function(req, res) {
  try {
    var admin = getAdminClient();
    var cap = parseInt(req.query.maxchars, 10); if (!cap || cap < 1) cap = 5000;
    var sc = await fetchSellingContext(admin, req.params.user_id, cap);
    res.json({
      user_id: req.params.user_id,
      max_chars: cap,
      empty: !sc.contextText,
      char_count: sc.contextText.length,
      kb_hash: sc.kbHash,
      sources: sc.sources || [],
      preview: sc.contextText.slice(0, 600),
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] selling-context harness error:', err.message);
    res.status(500).json({ error: 'Failed to resolve selling context' });
  }
});

// Fetch all auth users + all user_profiles rows, left-merge on user_id.
// Users without a profile row default to role='user', managed_by=null.
async function fetchUsersWithProfiles(admin) {
  var authResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authResult.error) throw new Error('listUsers failed: ' + authResult.error.message);
  var profilesResult = await admin
    .from('user_profiles')
    .select('user_id, role, managed_by, billing_status, billing_plan, active, first_name, last_name');
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
      billing_status: p.billing_status || 'trial',
      billing_plan: p.billing_plan || null,
      active: p.active !== false, // profile-less or unset → active (matches column default)
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      created_at: u.created_at || null,
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

// ── GET /admin/analytics2/:user_id ──────────────────────────────────────────
// Admin-pivot equivalent of /me/analytics2 (Fathom-era Coaching Dashboard).
// Same scope enforcement as /admin/analytics/:user_id: admins → self + managed
// users; owners → anyone. Wraps computeCallAnalytics().
router.get('/analytics2/:user_id', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }

  try {
    var admin = getAdminClient();

    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var scopeCheck = await admin
        .from('user_profiles')
        .select('user_id, managed_by')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] analytics2 scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on analytics2: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }

    var result = await computeCallAnalytics(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] analytics2 error:', err.message);
    res.status(500).json({ error: 'Failed to load analytics: ' + (err.message || 'unknown') });
  }
});


// ── GET /admin/sections/:user_id/:section ───────────────────────────────────
// Admin-pivot equivalent of /me/sections/:section (stage 4a/4b). Same scope
// enforcement as every other coaching mirror: managers → self + managed users;
// owners → anyone. Ruling 3: the drilldown honours ?user= like every other
// coaching surface, and it does so through the standard /admin mirror rather
// than a second authorization path inside /me.
router.get('/sections/:user_id/:section', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var section = req.params.section;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }

  try {
    var admin = getAdminClient();

    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var scopeCheck = await admin
        .from('user_profiles')
        .select('user_id, managed_by')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] sections scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on sections: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }

    var meRoutes = require('./me');
    var result = await meRoutes._computeSectionBreakdown(admin, targetUserId, section, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] sections error:', err.message);
    res.status(500).json({ error: 'Failed to load section: ' + (err.message || 'unknown') });
  }
});

// ── GET /admin/fathom-calls/:user_id ────────────────────────────────────────
// Admin-pivot equivalent of GET /fathom/calls — the drill-down call list for a
// viewed user. Same scope enforcement as the other /admin analytics routes.
// Reuses the shared _loadCallsList helper (filter=analyzed|objections, sort,
// from/to). Lets the coaching donuts drill through under ?user=.
router.get('/fathom-calls/:user_id', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  try {
    var admin = getAdminClient();

    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var scopeCheck = await admin
        .from('user_profiles')
        .select('user_id, managed_by')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] fathom-calls scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on fathom-calls: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }

    var result = await fathomRoutes._loadCallsList(admin, targetUserId, fathomRoutes._parseCallListOpts(req));
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] fathom-calls error:', err.message);
    res.status(500).json({ error: 'Failed to load calls' });
  }
});

// ── GET /admin/objections-intel/:user_id ────────────────────────────────────
// Admin-pivot equivalent of /me/objections-intel. Same scope enforcement.
router.get('/objections-intel/:user_id', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var admin = getAdminClient();
    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var scopeCheck = await admin
        .from('user_profiles')
        .select('user_id, managed_by')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] objections-intel scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on objections-intel: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }
    var result = await computeObjectionIntel(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] objections-intel error:', err.message);
    res.status(500).json({ error: 'Failed to load objection intelligence: ' + (err.message || 'unknown') });
  }
});

// ── GET /admin/objections-synthesis/:user_id ────────────────────────────────
// Admin-pivot equivalent of /me/objections-synthesis. Same scope enforcement.
router.get('/objections-synthesis/:user_id', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var admin = getAdminClient();
    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var scopeCheck = await admin.from('user_profiles').select('user_id, managed_by').eq('user_id', targetUserId).maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] objections-synthesis scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on objections-synthesis: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }
    var result = await computeObjectionSynthesis(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] objections-synthesis error:', err.message);
    res.status(500).json({ error: 'Failed to load synthesis: ' + (err.message || 'unknown') });
  }
});

// ── GET /admin/performance-synthesis/:user_id ───────────────────────────────
router.get('/performance-synthesis/:user_id', requireAuth, requireRole(['manager', 'owner']), async function(req, res) {
  var targetUserId = req.params.user_id;
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var admin = getAdminClient();
    if (req.user.role !== 'owner' && targetUserId !== req.user.id) {
      var scopeCheck = await admin.from('user_profiles').select('user_id, managed_by').eq('user_id', targetUserId).maybeSingle();
      if (scopeCheck.error) {
        console.error('[admin] performance-synthesis scope check failed:', scopeCheck.error.message);
        return res.status(500).json({ error: 'Could not verify access' });
      }
      if (!scopeCheck.data || scopeCheck.data.managed_by !== req.user.id) {
        console.warn('[admin] Scope violation on performance-synthesis: actor=%s target=%s', req.user.id, targetUserId);
        return res.status(403).json({ error: 'Not authorized for that user' });
      }
    }
    var result = await computePerformanceSynthesis(admin, targetUserId, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[admin] performance-synthesis error:', err.message);
    res.status(500).json({ error: 'Failed to load performance summary: ' + (err.message || 'unknown') });
  }
});

// ── GET /admin/objections/:user_id?objection_id=<id>&from=&to= ──────────────
// Per-type drill for admins/owners viewing another user's coaching dashboard.
// Same shape as /me/objections; scope-checked.

// ── GET /admin/sessions/:session_id/objections ──────────────────────────────
// Per-session objection drill for the admin/owner view. No user_id filter —
// requireRole upstream is the gate. (For admins, the existing
// /admin/sessions list is already scope-filtered to managed users, so by the
// time a session_id reaches here it's already been screened. Defensive
// check still happens in the analytics route above.)

// ── GET /admin/coaching/:user_id/patterns ───────────────────────────────────
// Admin/owner view of any user's coaching patterns. Reuses the same
// computation as /me/coaching/patterns — just calls it with a different
// user_id after a scope check (admins see managed users + self; owners see
// anyone). Lives on admin.js for the same reason analytics does — keeps
// caller-scope clean from cross-user-scope.

// Pure helpers exported for tests (matches log.js `_validateLogBatch` pattern).
router._buildUserEmailMap = buildUserEmailMap;
router._computeCountsBySession = computeCountsBySession;
router._computeDurationSeconds = computeDurationSeconds;
router._computeUserSessionStats = computeUserSessionStats;

module.exports = router;
