const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');

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

// Separate service-role client for reads that need to bypass RLS (e.g. /me
// reading user_profiles — the SELECT policy allows it anyway, but using the
// admin client keeps /me robust if policies change).
var _adminSupabase = null;
function getAdminClient() {
  if (_adminSupabase) return _adminSupabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Railway Variables.');
  }
  _adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _adminSupabase;
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

// Return the caller's identity + role. Used by login.html to decide where
// to redirect after a successful login (owner/admin → /admin, user →
// /dashboard). Un-onboarded users have no user_profiles row — default to
// 'user' in memory, matching the requireRole middleware's own default.
router.get('/me', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var { data, error } = await admin
      .from('user_profiles')
      .select('role, managed_by')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) {
      console.error('[auth] /me role lookup failed:', error.message);
      return res.status(500).json({ error: 'Could not load user profile' });
    }
    var role = (data && data.role) || 'user';
    // is_managed: does this caller have a manager (managed_by IS NOT NULL)?
    // Derived from the row already fetched — no extra query, and it defaults to
    // false when there's no profile, so it never introduces a new /me failure.
    var isManaged = !!(data && data.managed_by);
    // has_reps: does this caller manage anyone (user_profiles.managed_by = self)?
    // Drives the Team-view landing. head:true count = no rows returned, so callers
    // that ignore the field pay nothing extra in payload. NEVER fail /me over this
    // — default false + log on error.
    var hasReps = false;
    var repsCount = await admin
      .from('user_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('managed_by', req.user.id);
    if (repsCount.error) {
      console.error('[auth] /me has_reps count failed:', repsCount.error.message);
    } else {
      hasReps = (repsCount.count || 0) > 0;
    }
    res.json({ user_id: req.user.id, email: req.user.email, role: role, has_reps: hasReps, is_managed: isManaged });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[auth] /me error:', err.message);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// Refresh a session token
// ── POST /auth/diag ───────────────────────────────────────────────────────────
// Client auth-diagnostics beacon (scout-auth.js). UNAUTHENTICATED on purpose —
// it fires precisely when auth may be broken (refresh failure, logout, empty
// storage at boot), so it must not depend on a valid session. It only writes to
// the server log so an overnight logout is captured in Railway logs even if no
// one is watching the browser console. Fire-and-forget: always 204, never throws.
router.post('/diag', function(req, res) {
  try {
    var s = JSON.stringify(req.body || {});
    if (s.length > 8000) s = s.slice(0, 8000) + '…[trunc]';
    console.log('[auth-diag] ' + s);
  } catch (e) {
    console.log('[auth-diag] <unloggable body>');
  }
  res.status(204).end();
});

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

// ─────────────────────────────────────────────────────────────────────────────
// Fathom OAuth integration — Scout v2.0 Phase 1
//
// Two routes implement the standard OAuth 2.0 authorization code flow against
// Fathom's endpoints (confirmed verbatim from the official fathom-typescript
// v0.0.40 SDK source — not the docs, which surfaced 404s on the relevant
// pages). We deliberately do NOT depend on the SDK: it's pre-1.0, pulls in
// Zod for runtime validation, and ships a TokenStore abstraction that fights
// our service-role+Supabase persistence model. We use its exact URLs and
// snake_case parameter names with two plain fetch() calls.
//
// State validation: the /callback route is intentionally UNAUTHENTICATED
// because Fathom redirects to it as a plain browser navigation with no
// Authorization header. Caller identity comes from a signed `state` parameter
// (HMAC-SHA256 over a {user_id, exp} payload using FATHOM_STATE_SECRET). The
// structure is a JWS-Compact-shaped `payloadB64.signatureB64` — we don't take
// a jsonwebtoken dependency since we only need symmetric HMAC and Node 20+
// gives us Buffer.toString('base64url') natively. Constant-time signature
// compare via crypto.timingSafeEqual prevents timing attacks.
// ─────────────────────────────────────────────────────────────────────────────

const FATHOM_AUTHORIZE_URL = 'https://fathom.video/external/v1/oauth2/authorize';
const FATHOM_TOKEN_URL     = 'https://fathom.video/external/v1/oauth2/token';
const FATHOM_SCOPE         = 'public_api';
const STATE_TTL_SECONDS    = 600;   // 10 minutes — plenty for a normal OAuth round-trip, short enough to limit replay window
const TOKEN_EXPIRY_TOLERANCE_SECONDS = 300; // 5 min — matches fathom-typescript SDK; refresh slightly early to dodge clock skew

// Lazy env-var check — throws a "not configured" error that handleConfigError
// surfaces as 503 (for /connect, which returns JSON). The /callback route
// catches its own throws and redirects instead (browser tab can't read JSON 503).
function requireFathomEnv() {
  var missing = [];
  if (!process.env.FATHOM_CLIENT_ID)     missing.push('FATHOM_CLIENT_ID');
  if (!process.env.FATHOM_CLIENT_SECRET) missing.push('FATHOM_CLIENT_SECRET');
  if (!process.env.FATHOM_REDIRECT_URI)  missing.push('FATHOM_REDIRECT_URI');
  if (!process.env.FATHOM_STATE_SECRET)  missing.push('FATHOM_STATE_SECRET');
  if (missing.length > 0) {
    throw new Error('Fathom OAuth not configured — set ' + missing.join(', ') + ' in Railway Variables.');
  }
}

function signFathomState(userId) {
  requireFathomEnv();
  var payload = {
    user_id: userId,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  var payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  var sigB64 = crypto.createHmac('sha256', process.env.FATHOM_STATE_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return payloadB64 + '.' + sigB64;
}

// Returns the parsed payload on success, null on any failure (bad format,
// bad signature, expired, malformed payload). Never throws on bad input —
// only throws if env vars are missing. Callers treat null as "reject".
function verifyFathomState(token) {
  requireFathomEnv();
  if (typeof token !== 'string' || token.indexOf('.') === -1) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var payloadB64 = parts[0];
  var sigB64 = parts[1];

  var expected = crypto.createHmac('sha256', process.env.FATHOM_STATE_SECRET)
    .update(payloadB64)
    .digest();
  var provided;
  try {
    provided = Buffer.from(sigB64, 'base64url');
  } catch (e) {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;

  var payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.user_id !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// GET /auth/fathom/connect — initiate the OAuth flow. Returns { url } for the
// dashboard to open in a popup window. requireAuth ensures we know which
// user_id to bind into the state token.
router.get('/fathom/connect', requireAuth, function(req, res) {
  try {
    var state = signFathomState(req.user.id);
    var authorizeUrl = new URL(FATHOM_AUTHORIZE_URL);
    authorizeUrl.searchParams.append('client_id',     process.env.FATHOM_CLIENT_ID);
    authorizeUrl.searchParams.append('redirect_uri',  process.env.FATHOM_REDIRECT_URI);
    authorizeUrl.searchParams.append('response_type', 'code');
    authorizeUrl.searchParams.append('scope',         FATHOM_SCOPE);
    authorizeUrl.searchParams.append('state',         state);
    console.log('[auth] Fathom connect initiated for user ' + req.user.id);
    res.json({ url: authorizeUrl.toString() });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[auth] Fathom connect error:', err.message);
    res.status(500).json({ error: 'Could not start Fathom OAuth' });
  }
});

// GET /auth/fathom/callback — Fathom redirects here after the user authorizes
// in their account. NO requireAuth: the browser hits this as a plain
// navigation with no Authorization header. Caller identity is recovered from
// the signed state parameter only. Every failure path REDIRECTS — never
// returns JSON — because the destination is a browser tab. handleConfigError
// is intentionally skipped here for the same reason; a config error becomes
// `?fathom=error` like any other failure.
router.get('/fathom/callback', async function(req, res) {
  // Fathom can include an error param when the user denies or its own flow
  // fails. Handle that before attempting any token exchange — there will be
  // no code to exchange in this case.
  if (req.query.error) {
    console.warn('[auth] Fathom callback returned error: ' + String(req.query.error).slice(0, 200));
    return res.redirect('/dashboard?fathom=denied');
  }

  var code = req.query.code;
  var state = req.query.state;
  if (!code || !state) {
    console.warn('[auth] Fathom callback missing code or state');
    return res.status(400).send('Missing code or state');
  }

  var userId = null;
  try {
    var payload = verifyFathomState(state);
    if (!payload) {
      console.warn('[auth] Fathom callback invalid or expired state');
      return res.status(400).send('Invalid or expired state');
    }
    userId = payload.user_id;

    // Exchange code for tokens — Fathom expects application/x-www-form-urlencoded
    // per the SDK source (NOT JSON). Param names are snake_case as confirmed.
    var tokenResp = await fetch(FATHOM_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.FATHOM_CLIENT_ID,
        client_secret: process.env.FATHOM_CLIENT_SECRET,
        code:          code,
        redirect_uri:  process.env.FATHOM_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    if (!tokenResp.ok) {
      var errText = await tokenResp.text();
      console.error('[auth] Fathom token exchange HTTP ' + tokenResp.status + ' for user ' + userId + ': ' + errText.slice(0, 200));
      return res.redirect('/dashboard?fathom=error');
    }

    var data = await tokenResp.json();
    // Defensive type checks: don't trust upstream shape. Per the SDK's Zod
    // schema, access_token + refresh_token + expires_in are required.
    if (!data || typeof data.access_token !== 'string'
              || typeof data.refresh_token !== 'string'
              || typeof data.expires_in !== 'number') {
      console.error('[auth] Fathom token response missing required fields for user ' + userId);
      return res.redirect('/dashboard?fathom=error');
    }

    var nowSec = Math.floor(Date.now() / 1000);
    var expiresAt = new Date((nowSec + data.expires_in - TOKEN_EXPIRY_TOLERANCE_SECONDS) * 1000).toISOString();
    var nowIso = new Date().toISOString();

    var admin = getAdminClient();
    var upsert = await admin
      .from('fathom_connections')
      .upsert({
        user_id:          userId,
        access_token:     data.access_token,
        refresh_token:    data.refresh_token,
        expires_at:       expiresAt,
        scope:            data.scope || FATHOM_SCOPE,
        connected_at:     nowIso,
        last_sync_status: null,  // clear any stale error state from a prior broken connection
        last_sync_error:  null,
        updated_at:       nowIso,
      }, { onConflict: 'user_id' });

    if (upsert.error) {
      console.error('[auth] Fathom connection upsert failed for user ' + userId + ': ' + upsert.error.message);
      return res.redirect('/dashboard?fathom=error');
    }

    console.log('[auth] Fathom connection stored for user ' + userId + ' (expires_in=' + data.expires_in + 's)');
    return res.redirect('/dashboard?fathom=connected');
  } catch (err) {
    console.error('[auth] Fathom callback fatal for user ' + (userId || 'unknown') + ':', err.message);
    return res.redirect('/dashboard?fathom=error');
  }
});

module.exports = router;
