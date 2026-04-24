require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const proxyRoutes = require('./routes/proxy');
const downloadRoutes = require('./routes/download');
const logRoutes = require('./routes/log');
const adminRoutes = require('./routes/admin');
const meRoutes = require('./routes/me');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe webhooks need raw body — must be before express.json()
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

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
app.get('/dashboard', function(req, res) {
  res.sendFile(path.join(__dirname, 'web', 'dashboard.html'));
});

// Routes
app.use('/auth', authRoutes);
app.use('/billing', billingRoutes);
app.use('/proxy', proxyRoutes);
app.use('/download', downloadRoutes);
app.use('/log', logRoutes);
app.use('/admin', adminRoutes);
app.use('/me', meRoutes);

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

app.listen(PORT, '0.0.0.0', function() {
  console.log('[server] Scout backend running on port ' + PORT);
  reportEnv();
});
