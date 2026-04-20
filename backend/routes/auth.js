const express = require('express');
const { createClient } = require('@supabase/supabase-js');

var router = express.Router();
var supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Sign up with email + password
router.post('/signup', async function(req, res) {
  var { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    var { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    // If session is null, Supabase requires email confirmation
    if (!data.session) {
      return res.status(400).json({ error: 'Please check your email to confirm your account before logging in.' });
    }
    res.json({ token: data.session.access_token, user: data.user });
  } catch (err) {
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
    var { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ token: data.session.access_token, user: data.user });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Google OAuth URL — Electron app opens this in a browser window,
// user logs in, gets redirected back with a session token.
router.get('/google', async function(req, res) {
  try {
    var { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'scout://auth/callback', // Custom URL scheme — Electron intercepts this
      },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ url: data.url });
  } catch (err) {
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
    var { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    console.error('[auth] Refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

module.exports = router;
