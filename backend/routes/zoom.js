// /zoom/* — Zoom recording source. Sub-stage 1 ships /zoom/status only (the
// connect-UI needs it); sync + webhook land in later sub-stages. Reads the
// unified call_connections table (provider='zoom').
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const callConnections = require('../lib/call-connections');
const zoomClient = require('../lib/zoom-client');
// Reuse Fathom's first-sync cap + newest-picker VERBATIM so the two sources share
// one rule (the FD-4 cap, coming due for Zoom here). Not duplicated — imported.
const fathomRoutes = require('./fathom');
const FIRST_SYNC_ANALYZE_CAP = fathomRoutes._FIRST_SYNC_ANALYZE_CAP;
const pickNewestForAnalysis  = fathomRoutes._pickNewestForAnalysis;
const callIdsToAnalyze       = fathomRoutes._callIdsToAnalyze; // FIRST-SYNC-ONLY cap (shared)

const MAX_ZOOM_PAGES = 12; // next_page_token safety cap for the recordings list
const { ZOOM_TRANSCRIPT_RETRY_HOURS } = require('../lib/zoom-retry');
// how many requeued calls one sync may re-dispatch — a ceiling, never a sweep
const REQUEUE_DISPATCH_CAP = 10;

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

// ── Zoom sync (sub-stage 2) ──────────────────────────────────────────────────
// Mirror of Fathom's syncUserCalls: refresh the token via call_connections'
// SERIALIZED single-flight refresh (never bypassed — Zoom's single-use rotating
// refresh tokens make that a correctness requirement), page the user's cloud
// recordings, map each → a fathom_calls row (source='zoom'), upsert ON CONFLICT
// DO NOTHING, update the connection's sync status, and fire-and-forget analysis
// of the NEWEST FIRST_SYNC_ANALYZE_CAP new calls (the shared FD-4 cap).
//
// Degrade cleanly: a user with NO cloud recordings (free Zoom plan — the common
// case) is NOT an error. Zoom returns { meetings: [] } (200); we return
// { ok:true, synced:0, no_recordings:true } and the UI says so honestly.
//
// Result shapes (parallels Fathom):
//   { ok:true, synced, fetched, malformed, pages, truncated, dispatched, no_recordings }
//   { ok:false, kind:'refresh_failed'|'fetch_failed'|'insert_failed', error }
async function markZoomConnError(admin, userId, reason) {
  try {
    await admin.from('call_connections')
      .update({ last_sync_status: 'error', last_sync_error: String(reason).slice(0, 500), updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('provider', 'zoom');
  } catch (e) {
    console.error('[zoom] markZoomConnError failed for user ' + userId + ': ' + (e && e.message));
  }
}

// Zoom's `from` is a YYYY-MM-DD date. Zoom caps each from→to span at ~1 month.
// Steady-state (the 2h cron, last_sync_at ~2h ago) is always inside one window.
//
// ⚠⚠ A FIRST SYNC BACKDATES 30 DAYS, EXPLICITLY (Justin, 2026-08-24). It used
// to omit `from` and rely on Zoom DEFAULTING to the last month — which happened
// to match the ruling, but by inheritance rather than by choice. An upstream
// default is not a decision: Zoom could change it, and nothing here would say
// what we intended. Sending the date states it.
//
// ⚠ Fathom expresses the same ruling through `sync_window`; Zoom has no
// equivalent picker yet, so this is a constant rather than a stored choice.
var ZOOM_FIRST_SYNC_DAYS = 30;

function zoomFromDate(lastSyncAtIso) {
  if (lastSyncAtIso) {
    var d = new Date(lastSyncAtIso);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  var back = new Date(Date.now() - ZOOM_FIRST_SYNC_DAYS * 86400000);
  return back.toISOString().slice(0, 10);
}

async function syncZoomCalls(admin, userId, conn) {
  // Valid access token (serialized refresh; throws if Zoom rejects the refresh).
  var accessToken;
  try {
    accessToken = await callConnections.getValidAccessToken(admin, userId, 'zoom', conn);
  } catch (refreshErr) {
    await markZoomConnError(admin, userId, 'refresh_failed: ' + (refreshErr && refreshErr.message));
    console.error('[zoom] sync refresh failed for user ' + userId + ': ' + (refreshErr && refreshErr.message));
    return { ok: false, kind: 'refresh_failed', error: (refreshErr && refreshErr.message) || 'refresh failed' };
  }

  // Page the recordings list (next_page_token), bounded by MAX_ZOOM_PAGES.
  var from = zoomFromDate(conn && conn.last_sync_at);
  var token = null, pageCount = 0, allRows = [], malformedCount = 0;
  try {
    while (pageCount < MAX_ZOOM_PAGES) {
      var page = await zoomClient.listRecordings(accessToken, { from: from, pageSize: 100, nextPageToken: token });
      var meetings = Array.isArray(page.meetings) ? page.meetings : [];
      for (var i = 0; i < meetings.length; i++) {
        var row = zoomClient.zoomRecordingToRow(userId, meetings[i]);
        if (row) allRows.push(row);
        else malformedCount += 1;
      }
      token = (typeof page.next_page_token === 'string' && page.next_page_token) ? page.next_page_token : null;
      pageCount += 1;
      if (!token) break;
    }
  } catch (fetchErr) {
    await markZoomConnError(admin, userId, fetchErr.message);
    console.error('[zoom] sync fetch failed for user ' + userId + ': ' + fetchErr.message);
    return { ok: false, kind: 'fetch_failed', error: fetchErr.message };
  }
  var hitPageCap = token !== null;

  // No recordings at all — free plan / nothing recorded. Mark ok, report honestly.
  if (allRows.length === 0) {
    var nowIsoEmpty = new Date().toISOString();
    await admin.from('call_connections')
      .update({ last_sync_at: nowIsoEmpty, last_sync_status: 'ok', last_sync_error: null, updated_at: nowIsoEmpty })
      .eq('user_id', userId).eq('provider', 'zoom');
    console.log('[zoom] Sync complete for user ' + userId + ': no cloud recordings (fetched=0, malformed=' + malformedCount + ')');
    return { ok: true, synced: 0, fetched: 0, malformed: malformedCount, pages: pageCount, truncated: hitPageCap, dispatched: 0, no_recordings: true };
  }

  // Upsert ON CONFLICT DO NOTHING (idempotent). .select() returns only new rows.
  var insertResult = await admin
    .from('fathom_calls')
    .upsert(allRows, { onConflict: 'user_id,fathom_call_id', ignoreDuplicates: true })
    .select('id, call_date');
  if (insertResult.error) {
    await markZoomConnError(admin, userId, 'sync_failed: DB insert — ' + insertResult.error.message);
    console.error('[zoom] sync insert failed for user ' + userId + ': ' + insertResult.error.message);
    return { ok: false, kind: 'insert_failed', error: insertResult.error.message };
  }
  var newRows = insertResult.data || [];
  var insertedCount = newRows.length;

  // Mark connection success.
  var nowIso = new Date().toISOString();
  var statusUpdate = await admin.from('call_connections')
    .update({ last_sync_at: nowIso, last_sync_status: 'ok', last_sync_error: null, updated_at: nowIso })
    .eq('user_id', userId).eq('provider', 'zoom');
  if (statusUpdate.error) console.error('[zoom] sync status update failed for user ' + userId + ': ' + statusUpdate.error.message);

  // FD-4 cap — FIRST SYNC ONLY (shared with Fathom): cap the connect backlog to the
  // newest N; on steady-state syncs analyze every new call so a busy day isn't
  // silently truncated. The rest of a first-sync backlog stay pending for backfill.
  /**
   * ⚠⚠ PICK UP CALLS REQUEUED BECAUSE THEIR TRANSCRIPT WASN'T READY YET.
   * Without this the requeue only half-works: the row sits at 'pending' and
   * NOTHING re-dispatches it, because this sync only ever analyses rows it just
   * inserted. That is arguably worse than the error it replaced — an error card
   * at least tells the user something is wrong, whereas a permanently pending
   * row reads as "still analysing" forever.
   *
   * Bounded three ways so it can never become a backlog sweep: only Zoom rows,
   * only ones inside the retry window (lib/zoom-retry.js), and capped.
   * Retries are free — the transcript fetch precedes any Claude call.
   */
  var requeuedIds = [];
  try {
    var since = new Date(Date.now() - ZOOM_TRANSCRIPT_RETRY_HOURS * 3600 * 1000).toISOString();
    var rq = await admin.from('fathom_calls').select('id')
      .eq('user_id', userId).eq('source', 'zoom').eq('sync_status', 'pending')
      .gte('call_date', since)
      .order('call_date', { ascending: false }).limit(REQUEUE_DISPATCH_CAP);
    if (!rq.error) requeuedIds = (rq.data || []).map(function (r) { return r.id; });
  } catch (rqErr) {
    console.error('[zoom] requeue lookup failed for user ' + userId + ': ' + (rqErr.message || 'unknown'));
  }

  var newCallIds = callIdsToAnalyze(newRows, conn && conn.last_sync_at, FIRST_SYNC_ANALYZE_CAP);
  if (newRows.length > newCallIds.length) {
    console.log('[zoom] sync: first-sync backlog — capped auto-analysis to newest ' + newCallIds.length + ' of ' + newRows.length + ' new calls for user ' + userId + ' (rest stay pending for backfill)');
  }
  var newSet = {};
  newCallIds.forEach(function (id) { newSet[id] = true; });
  var retryIds = requeuedIds.filter(function (id) { return !newSet[id]; });
  var dispatchIds = newCallIds.concat(retryIds);
  if (retryIds.length > 0) {
    console.log('[zoom] sync: re-dispatching ' + retryIds.length + ' call(s) whose transcript was not ready last time (user=' + userId + ')');
  }
  if (dispatchIds.length > 0) {
    (async function() {
      try {
        var analyzeCall = require('../lib/analysis-worker').analyzeCall; // lazy — dodge require cycle
        for (var i = 0; i < dispatchIds.length; i++) {
          try { await analyzeCall(dispatchIds[i], userId); }
          catch (innerErr) { console.error('[zoom] analyzeCall failed for call ' + dispatchIds[i] + ' (user=' + userId + '): ' + (innerErr.message || 'unknown')); }
        }
      } catch (outerErr) {
        console.error('[zoom] background analysis loop error (user=' + userId + '): ' + (outerErr.message || 'unknown'));
      }
    })();
  }

  console.log('[zoom] Sync complete for user ' + userId + ': fetched=' + allRows.length + ' inserted=' + insertedCount + ' malformed=' + malformedCount + ' pages=' + pageCount + (hitPageCap ? ' (CAPPED — more available)' : '') + (newCallIds.length > 0 ? ' analysis_dispatched=' + newCallIds.length : ''));
  return { ok: true, synced: insertedCount, fetched: allRows.length, malformed: malformedCount, pages: pageCount, truncated: hitPageCap, dispatched: newCallIds.length, no_recordings: false };
}

// ── POST /zoom/sync ──────────────────────────────────────────────────────────
// Manual "Sync & grade my recent calls" trigger from the dashboard (mirrors
// GET /fathom/sync). 404 when the caller hasn't connected Zoom.
router.post('/sync', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();
    var conn = await callConnections.getConnection(admin, userId, 'zoom');
    if (!conn) return res.status(404).json({ error: 'Not connected to Zoom' });

    // getConnection doesn't select last_sync_at; fetch it for the sync window.
    var lsQ = await admin.from('call_connections').select('last_sync_at').eq('user_id', userId).eq('provider', 'zoom').maybeSingle();
    if (!lsQ.error && lsQ.data) conn.last_sync_at = lsQ.data.last_sync_at;

    var r = await syncZoomCalls(admin, userId, conn);
    if (!r.ok) {
      if (r.kind === 'refresh_failed') return res.status(401).json({ error: r.error });
      if (r.kind === 'fetch_failed')   return res.status(502).json({ error: r.error });
      return res.status(500).json({ error: 'Could not save synced calls' });
    }
    return res.json({
      synced: r.synced, fetched: r.fetched, malformed: r.malformed,
      pages: r.pages, truncated: r.truncated, no_recordings: r.no_recordings,
    });
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) return res.status(503).json({ error: err.message });
    console.error('[zoom] sync fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── POST /zoom/sync-all ──────────────────────────────────────────────────────
// Cron-triggered bulk Zoom sync (shared-secret X-Cron-Secret === CRON_SECRET),
// mirroring /fathom/sync-all. Iterates every provider='zoom' connection, skips
// DEACTIVATED users, runs the same per-user sync, error-isolated per user.
router.post('/sync-all', async function(req, res) {
  var secret = process.env.CRON_SECRET;
  if (!secret) { console.error('[zoom] sync-all called but CRON_SECRET is not set — refusing'); return res.status(503).json({ error: 'cron not configured' }); }
  var provided = req.get('X-Cron-Secret') || (req.query && req.query.secret) || '';
  if (provided !== secret) { console.warn('[zoom] sync-all unauthorized attempt'); return res.status(401).json({ error: 'unauthorized' }); }
  try {
    var admin = getAdminClient();
    var connsResult = await admin.from('call_connections')
      .select('user_id, provider, access_token, refresh_token, expires_at, last_sync_at')
      .eq('provider', 'zoom');
    if (connsResult.error) { console.error('[zoom] sync-all connection list failed: ' + connsResult.error.message); return res.status(500).json({ error: 'Could not load connections' }); }
    var conns = connsResult.data || [];
    // Skip deactivated users (a freed seat stops pulling NEW calls; history stays).
    var inactive = {};
    if (conns.length) {
      var uids = conns.map(function (c) { return c.user_id; });
      var actQ = await admin.from('user_profiles').select('user_id, active').in('user_id', uids);
      if (!actQ.error) (actQ.data || []).forEach(function (p) { if (p.active === false) inactive[p.user_id] = true; });
    }
    var summary = { total: conns.length, ok: 0, synced_total: 0, dispatched_total: 0, no_recordings: 0, skipped_inactive: 0, errors: 0 };
    for (var i = 0; i < conns.length; i++) {
      var conn = conns[i];
      var uid = conn.user_id;
      if (inactive[uid]) { summary.skipped_inactive += 1; continue; }
      try {
        var r = await syncZoomCalls(admin, uid, conn);
        if (r.ok) {
          summary.ok += 1;
          summary.synced_total += r.synced;
          summary.dispatched_total += r.dispatched;
          if (r.no_recordings) summary.no_recordings += 1;
        } else {
          summary.errors += 1;
          console.error('[zoom] sync-all user ' + uid + ' failed: ' + r.kind + ' ' + (r.error || ''));
        }
      } catch (perUserErr) {
        summary.errors += 1;
        console.error('[zoom] sync-all user ' + uid + ' threw: ' + (perUserErr.message || 'unknown'));
      }
    }
    console.log('[zoom] sync-all done: ' + JSON.stringify(summary));
    return res.json(summary);
  } catch (err) {
    if (err.message && err.message.indexOf('not configured') !== -1) return res.status(503).json({ error: err.message });
    console.error('[zoom] sync-all fatal: ' + err.message);
    res.status(500).json({ error: 'sync-all failed' });
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
// sub-stage 2 sync — reused Fathom cap/picker (exposed so tests can prove Zoom
// uses the SAME rule) + the date-window helper + the sync core.
module.exports._FIRST_SYNC_ANALYZE_CAP = FIRST_SYNC_ANALYZE_CAP;
module.exports._pickNewestForAnalysis  = pickNewestForAnalysis;
module.exports._callIdsToAnalyze       = callIdsToAnalyze;
module.exports._zoomFromDate = zoomFromDate;
module.exports._syncZoomCalls = syncZoomCalls;
// pure helpers for tests
module.exports._deauthUrlValidation = deauthUrlValidation;
module.exports._deauthIsUrlValidation = deauthIsUrlValidation;
module.exports._deauthVerifyToken = deauthVerifyToken;
module.exports._deauthTargetZoomUserId = deauthTargetZoomUserId;
