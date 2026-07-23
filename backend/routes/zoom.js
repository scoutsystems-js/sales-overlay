// /zoom/* — Zoom recording source. Sub-stage 1 ships /zoom/status only (the
// connect-UI needs it); sync + webhook land in later sub-stages. Reads the
// unified call_connections table (provider='zoom').
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
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

module.exports = router;
