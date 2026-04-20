require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const proxyRoutes = require('./routes/proxy');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe webhooks need raw body — must be before express.json()
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

app.use(cors());
app.use(express.json());

// Serve static website files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', function(req, res) {
  res.json({ status: 'ok', service: 'Scout Systems Backend' });
});

// Routes
app.use('/auth', authRoutes);
app.use('/billing', billingRoutes);
app.use('/proxy', proxyRoutes);
app.use('/download', downloadRoutes);

// Global error handler
app.use(function(err, req, res, next) {
  console.error('[server] Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('[server] Scout backend running on port ' + PORT);
});
