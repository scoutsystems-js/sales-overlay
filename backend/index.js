require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const proxyRoutes = require('./routes/proxy');
const downloadRoutes = require('./routes/download');
const logRoutes = require('./routes/log');
const adminRoutes = require('./routes/admin');
const meRoutes = require('./routes/me');
const kbRoutes = require('./routes/kb');
const fathomRoutes = require('./routes/fathom');
const teamRoutes = require('./routes/team');
const eodRoutes = require('./routes/eod');
const zoomRoutes = require('./routes/zoom');
const welcomeEmail = require('./lib/welcome-email');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe webhooks need raw body — must be before express.json()
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

// Security headers (helmet). CSP is PERMISSIVE-BUT-REAL by design (2026-07-24
// DAST pass): the served pages use inline <script>/onclick and inline styles
// everywhere, and load Chart.js from jsdelivr — so script/style-src allow
// 'unsafe-inline' + the jsdelivr CDN, or the product breaks. Tighten to nonces
// later. connect/frame/media-src pre-allow the provider hosts (Supabase signed
// clips, Zoom/Fathom) so sub-stage-3 playback + OAuth popups keep working.
// COEP left OFF (require-corp breaks cross-origin images); CORP cross-origin +
// open CORS stay for the desktop Electron client (API is Bearer-auth'd).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      // MUST override helmet's default script-src-attr:'none' or every inline
      // onclick= handler across the product is blocked (curl can't see this —
      // CSP only bites in a browser).
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "https:"],
      fontSrc:     ["'self'", "data:"],
      connectSrc:  ["'self'", "https://*.supabase.co", "https://api.zoom.us", "https://*.fathom.video", "https://api.anthropic.com", "https://api.github.com"],
      frameSrc:    ["'self'", "https://*.fathom.video", "https://*.zoom.us"],
      mediaSrc:    ["'self'", "https://*.supabase.co", "blob:"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // OAuth popups (Zoom/Fathom connect) rely on window.opener for the
  // postMessage-close handoff. Helmet's DEFAULT COOP 'same-origin' SEVERS
  // window.opener the moment the popup navigates cross-origin to the provider,
  // so the popup can't notify the main window or close itself → it strands on
  // /dashboard. 'same-origin-allow-popups' keeps the opener for popups we open,
  // which restores the handoff while still isolating us from cross-origin openers.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  hsts: { maxAge: 15552000, includeSubDomains: true },
}));
app.use(cors());
app.use(express.json());

// Serve static website files
// Folder is named 'web' (not 'public') because Railpack's Staticfile
// detector auto-triggers on a 'public/' folder and deploys Caddy instead
// of Node. Renaming sidesteps that entirely.
app.use(express.static(path.join(__dirname, 'web'), {
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Health check
app.get('/health', function(req, res) {
  res.json({ status: 'ok', service: 'Scout Systems Backend' });
});

// Pretty URL for the login page — /login serves web/login.html
// (express.static only matches exact filenames, so /login needs an explicit route)
app.get('/login', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'login.html'));
});

// Pretty URL for the admin session logs page. Must register BEFORE
// app.use('/admin', adminRoutes) so the exact-match page serve isn't
// shadowed by the router mount.
app.get('/admin', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'admin.html'));
});

// Pretty URL for the user dashboard. Page-side role check routes
// admins/owners to /admin automatically.
app.get('/set-password', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'set-password.html'));
});

app.get('/privacy', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'privacy.html'));
});
app.get('/terms', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'terms.html'));
});
app.get('/docs', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'docs.html'));
});
app.get('/support', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'support.html'));
});

app.get('/dashboard', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'dashboard.html'));
});

// Zoom app-submission "Direct Landing URL" (install method = "From Your Site").
// Zoom requires this to be a page where a LOGGED-IN user can connect Zoom and a
// LOGGED-OUT user is sent to log in first. connect.html does the client-side
// session gate: signed-in → /dashboard#connect (the #account Connections section
// where Connect Zoom lives); signed-out → /login?return=... back to that surface.
app.get('/connect', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'connect.html'));
});

// Tiny OAuth popup landing page. The Zoom/Fathom callbacks redirect the popup here
// (not to /dashboard) so it never renders the whole product. It signals the main
// window opener-free (BroadcastChannel + localStorage) and best-effort self-closes.
app.get('/connected', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'connected.html'));
});

// v1.1.11 coaching page — role-pivoted by client-side query param.
// /coaching          → closer's own coaching (req.user.id)
// /coaching?user=X   → admin/owner viewing user X (scope-checked server-side)
app.get('/coaching', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'coaching.html'));
});

// Routes
app.use('/auth', authRoutes);
app.use('/billing', billingRoutes);
app.use('/proxy', proxyRoutes);
app.use('/download', downloadRoutes);
app.use('/log', logRoutes);
app.use('/admin', adminRoutes);
app.use('/me', meRoutes);
app.use('/kb', kbRoutes);
app.use('/fathom', fathomRoutes);
app.use('/team', teamRoutes);
app.use('/eod', eodRoutes);
app.use('/zoom', zoomRoutes);

// Global error handler
app.use(function(err, req, res, next) {
  console.error('[server] Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Log env var presence at startup — helps diagnose Railway deploys.
// Values are never logged, only whether each key is set.
function reportEnv() {
  var required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPGRAM_API_KEY',
    'DEEPGRAM_PROJECT_ID',
  ];
  var optional = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'GITHUB_TOKEN'];
  console.log('[server] Env check:');
  required.forEach(function(k) {
    console.log('  ' + k + ': ' + (process.env[k] ? 'set' : 'MISSING (required)'));
  });
  optional.forEach(function(k) {
    console.log('  ' + k + ': ' + (process.env[k] ? 'set' : 'not set (optional)'));
  });
}

welcomeEmail.init(); // one-time SMTP verify at boot; feature-off log when unconfigured

app.listen(PORT, '0.0.0.0', function() {
  console.log('[server] Scout backend running on port ' + PORT);
  reportEnv();
});
