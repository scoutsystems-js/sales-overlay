const { createClient } = require('@supabase/supabase-js');

var supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verifies the Supabase JWT sent by the Electron app.
// Attaches req.user (with id, email) and req.subscription status.
async function requireAuth(req, res, next) {
  var authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  var token = authHeader.replace('Bearer ', '');

  try {
    var { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = data.user;
    next();
  } catch (err) {
    console.error('[auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Auth check failed' });
  }
}

// Checks that the user has an active Stripe subscription in the subscriptions table.
// Run this AFTER requireAuth.
async function requireSubscription(req, res, next) {
  try {
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
    console.error('[auth] Subscription check failed:', err.message);
    return res.status(403).json({ error: 'Subscription check failed' });
  }
}

module.exports = { requireAuth, requireSubscription };
