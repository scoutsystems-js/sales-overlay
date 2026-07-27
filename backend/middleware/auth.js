const { createClient } = require('@supabase/supabase-js');

// Lazy Supabase client — only created on first auth check so a missing env
// var returns 503 from the route instead of crashing `require()` at boot.
var _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Railway Variables.');
  }
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _supabase;
}

// Verifies the Supabase JWT sent by the Electron app.
// Attaches req.user (with id, email) and req.subscription status.
async function requireAuth(req, res, next) {
  var authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  var token = authHeader.replace('Bearer ', '');

  try {
    var supabase = getSupabase();
    var { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = data.user;

    // Deactivation enforcement (User Management, 2026-07-27). Empirically, a
    // Supabase ban blocks new login + refresh but does NOT reject an already-
    // issued access token, and supabase-js can't revoke sessions by user id — so
    // this app-level flag is the enforcer: a deactivated user's live token is
    // rejected here. One lookup that ALSO stamps the profile role so requireRole
    // reuses it (net-neutral for role-gated routes). Fail-open on a DB error —
    // the ban still locks the account within the access-token TTL.
    try {
      var prof = await supabase.from('user_profiles').select('role, active').eq('user_id', data.user.id).maybeSingle();
      if (!prof.error && prof.data) {
        if (prof.data.active === false) {
          return res.status(401).json({ error: 'Account deactivated. Contact your manager.' });
        }
        req.userProfileRole = prof.data.role || 'user';
        req.user.role = prof.data.role || 'user';
      }
    } catch (e) { console.warn('[auth] active-check skipped (fail-open):', e && e.message); }
    next();
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) {
      console.error('[auth middleware] Config error:', err.message);
      return res.status(503).json({ error: err.message });
    }
    console.error('[auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Auth check failed' });
  }
}

// Checks that the user has an active Stripe subscription in the subscriptions table.
// Run this AFTER requireAuth.
//
// Beta behavior: while SKIP_BILLING is not explicitly 'false', this middleware
// lets any authenticated user through. Matches the desktop app's own
// check-subscription IPC, which returns { active: true, status: 'beta' } under
// the same condition. Flip SKIP_BILLING=false in Railway env vars once Stripe
// is wired and a subscriptions table exists.
async function requireSubscription(req, res, next) {
  if (process.env.SKIP_BILLING !== 'false') {
    return next();
  }

  try {
    var supabase = getSupabase();
    var { data, error } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: 'No active subscription found' });
    }

    if (data.status !== 'active' && data.status !== 'trialing') {
      return res.status(403).json({ error: 'Subscription is not active', status: data.status });
    }

    next();
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) {
      console.error('[auth middleware] Config error:', err.message);
      return res.status(503).json({ error: err.message });
    }
    console.error('[auth] Subscription check failed:', err.message);
    return res.status(403).json({ error: 'Subscription check failed' });
  }
}

// v1.1.0: role check — gate routes on user_profiles.role. Compose after
// requireAuth so req.user is populated. Usage:
//   router.get('/admin/users', requireAuth, requireRole(['owner','admin']), handler)
//   router.get('/only-owner',  requireAuth, requireRole('owner'),           handler)
//
// A user with no user_profiles row (signed up, never opened onboarding)
// defaults to 'user' in memory — matches the column default for consistency.
//
// Caches the resolved role on req.user.role for the lifetime of the
// request, so repeated requireRole calls or downstream handlers don't
// re-query. Never cached across requests.
function requireRole(allowedRoles) {
  var roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return async function(req, res, next) {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthenticated — requireRole must run after requireAuth' });
    }

    // Within-request cache: skip the DB call if a previous requireRole stamped
    // it. Cache on req.userProfileRole (not req.user.role) because Supabase's
    // auth.getUser() already populates req.user.role with the JWT role claim
    // ("authenticated" for any logged-in user) — checking that field would
    // incorrectly 403 every authenticated user before the profile lookup ran.
    if (req.userProfileRole) {
      if (roles.indexOf(req.userProfileRole) !== -1) return next();
      return res.status(403).json({ error: 'Forbidden', required: roles, actual: req.userProfileRole });
    }

    try {
      var supabase = getSupabase();
      var { data, error } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (error) {
        console.error('[requireRole] DB error:', error.message);
        return res.status(500).json({ error: 'Role check failed' });
      }

      var role = (data && data.role) || 'user';
      req.userProfileRole = role;
      // Also overwrite req.user.role (was "authenticated" from the JWT claim)
      // so downstream handlers reading req.user.role get the profile role.
      req.user.role = role;

      if (roles.indexOf(role) === -1) {
        return res.status(403).json({ error: 'Forbidden', required: roles, actual: role });
      }
      next();
    } catch (err) {
      if (err.message && err.message.indexOf('not configured') !== -1) {
        console.error('[requireRole] Config error:', err.message);
        return res.status(503).json({ error: err.message });
      }
      console.error('[requireRole] Error:', err.message);
      return res.status(500).json({ error: 'Role check failed' });
    }
  };
}

module.exports = { requireAuth, requireSubscription, requireRole };
