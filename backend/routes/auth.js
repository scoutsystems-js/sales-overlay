const express = require('express');
const { createClient } = require('@supabase/supabase-js');

var router = express.Router();

// Lazy Supabase client — only created on first request so a missing env var
// returns a clean 503 from the route instead of crashing `require()` at boot.
// If Railway forgets to set SUPABASE_URL, /health and /download still work.
var _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Supabase not configured — set SUPABASE_URL and SUPABASE_ANON_KEY in Railway Variables.');
  }
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return _supabase;
}

// Wraps a route handler so a getSupabase() throw turns into a 503 response.
function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[auth] Config error:', err.message);
    return res.status(503).json({ error: err.message });
  }
  return null;
}

// Sign up with email + password
router.post('/signup', async function(req, res) {
  var { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    var supabase = getSupabase();
    var { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    // If session is null, Supabase requires email confirmation
    if (!data.session) {
      return res.status(400).json({ error: 'Please check your email to confirm your account before logging in.' });
    }
    // Return full session — includes refresh token and expires_at so the
    // frontend can persist login across browser restarts and auto-refresh.
    // `token` kept for backwards compat with existing Electron app code.
    res.json({
      token: data.session.access_token,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: data.user,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[auth] Signup error:', err.message);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Log in with email + password
router.post('/login', async function(req, res) {
  var { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    var supabase = getSupabase();
    var { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({
      token: data.session.access_token,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: data.user,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Google OAuth URL — Electron app opens this in a browser window,
// user logs in, gets redirected back with a session token.
router.get('/google', async function(req, res) {
  try {
    var supabase = getSupabase();
    var { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'scout://auth/callback', // Custom URL scheme — Electron intercepts this
      },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ url: data.url });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[auth] Google OAuth error:', err.message);
    res.status(500).json({ error: 'Google OAuth failed' });
  }
});

// Refresh a session token
router.post('/refresh', async function(req, res) {
  var { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    var supabase = getSupabase();
    var { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[auth] Refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

module.exports = router;
