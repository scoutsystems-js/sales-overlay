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

module.exports = { requireAuth, requireSubscription };
