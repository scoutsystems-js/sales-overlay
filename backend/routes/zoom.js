// /zoom/* — Zoom recording source. Sub-stage 1 ships /zoom/status only (the
// connect-UI needs it); sync + webhook land in later sub-stages. Reads the
// unified call_connections table (provider='zoom').
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

// GET /zoom/status — the caller's own Zoom connection state for the dashboard
// strip. { connected: false } when no row; otherwise the connected shape
// (mirrors /fathom/status's minimal fields — sync counts arrive in sub-stage 2).
router.get('/status', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var q = await admin.from('call_connections')
      .select('external_account_email, connected_at, expires_at, last_sync_at, last_sync_status, last_sync_error')
      .eq('user_id', req.user.id).eq('provider', 'zoom').maybeSingle();
    if (q.error) throw new Error('call_connections: ' + q.error.message);
    if (!q.data) return res.json({ connected: false });
    res.json({
      connected: true,
      account_email: q.data.external_account_email || null,
      connected_at: q.data.connected_at,
      last_sync_at: q.data.last_sync_at || null,
      last_sync_status: q.data.last_sync_status || null,
    });
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) return res.status(503).json({ error: err.message });
    console.error('[zoom] status:', err.message);
    res.status(500).json({ error: 'Failed to load Zoom status' });
  }
});

// ── DELETE /zoom/disconnect ──────────────────────────────────────────────────
// Deletes the caller's OWN Zoom connection (call_connections, provider='zoom').
// NEVER touches synced calls / analyses / highlights — history stays.
router.delete('/disconnect', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var del = await admin.from('call_connections').delete()
      .eq('user_id', req.user.id).eq('provider', 'zoom');
    if (del.error) throw new Error('call_connections delete: ' + del.error.message);
    console.log('[zoom] disconnected user ' + req.user.id + ' (history preserved)');
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) return res.status(503).json({ error: err.message });
    console.error('[zoom] disconnect error:', err.message);
    res.status(500).json({ error: 'Could not disconnect Zoom' });
  }
});

// ── Deauthorization (Zoom app-level) ─────────────────────────────────────────
// Zoom POSTs here when a user removes Scout from their Zoom Added Apps. We
// verify the app Secret/Verification Token, delete that Zoom account's
// call_connections row(s) (tokens die; calls/analyses/history stay — same as
// in-app Disconnect), and respond 200 fast. Also answers the
// endpoint.url_validation challenge. Degrades gracefully: never 500 loudly.
// NO requireAuth — Zoom calls it with no Scout session.

function deauthUrlValidation(plainToken, secret) {
  return { plainToken: plainToken, encryptedToken: crypto.createHmac('sha256', secret).update(String(plainToken)).digest('hex') };
}
function deauthIsUrlValidation(body) {
  return !!(body && body.event === 'endpoint.url_validation' && body.payload && body.payload.plainToken);
}
function deauthVerifyToken(authHeader, secret) {
  if (!secret || typeof authHeader !== 'string' || !authHeader) return false;
  var provided = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : authHeader;
  var a = Buffer.from(provided), b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}
function deauthTargetZoomUserId(body) {
  if (!body || body.event !== 'app_deauthorized' || !body.payload) return null;
  return (typeof body.payload.user_id === 'string' && body.payload.user_id) ? body.payload.user_id : null;
}

router.post('/deauthorization', async function(req, res) {
  try {
    var secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    var body = req.body || {};

    // Endpoint validation challenge (needs the secret to sign).
    if (deauthIsUrlValidation(body)) {
      if (!secret) { console.warn('[zoom] deauth url_validation but ZOOM_WEBHOOK_SECRET_TOKEN unset'); return res.status(200).json({}); }
      return res.status(200).json(deauthUrlValidation(body.payload.plainToken, secret));
    }

    // Feature-off / misconfig: degrade, do not act, do not 500.
    if (!secret) { console.warn('[zoom] deauthorization received but ZOOM_WEBHOOK_SECRET_TOKEN unset — ignoring'); return res.status(200).json({ ok: true }); }

    // Verify the app Secret/Verification Token (Authorization header).
    var authHeader = req.get('Authorization') || req.get('authorization') || '';
    if (!deauthVerifyToken(authHeader, secret)) {
      console.warn('[zoom] deauthorization verification failed — ignoring');
      return res.status(401).json({ error: 'unauthorized' });
    }

    var zoomUserId = deauthTargetZoomUserId(body);
    if (!zoomUserId) { console.warn('[zoom] deauthorization: no target user_id in payload — nothing to delete'); return res.status(200).json({ ok: true }); }

    var admin = getAdminClient();
    var del = await admin.from('call_connections').delete()
      .eq('provider', 'zoom').eq('external_account_id', zoomUserId).select('user_id');
    if (del.error) { console.error('[zoom] deauthorization delete failed for zoom user ' + zoomUserId + ': ' + del.error.message); }
    else { console.log('[zoom] deauthorized zoom user ' + zoomUserId + ' — connection rows removed: ' + (del.data ? del.data.length : 0) + ' (history preserved)'); }
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Never 500 loudly — Zoom would retry; log and 200.
    console.error('[zoom] deauthorization handler error (degraded to 200): ' + (err && err.message));
    return res.status(200).json({ ok: true });
  }
});

module.exports = router;
// pure helpers for tests
module.exports._deauthUrlValidation = deauthUrlValidation;
module.exports._deauthIsUrlValidation = deauthIsUrlValidation;
module.exports._deauthVerifyToken = deauthVerifyToken;
module.exports._deauthTargetZoomUserId = deauthTargetZoomUserId;
