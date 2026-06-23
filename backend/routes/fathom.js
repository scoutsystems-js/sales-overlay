const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');

var router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Scout v2.0 Phase 1 — Fathom sync routes
//
// Two routes:
//   GET /fathom/sync   — requireAuth. Refreshes the caller's access token if
//                        expired, then paginates GET https://api.fathom.ai
//                        /external/v1/meetings?created_after=<last_sync_at>
//                        and INSERTs new calls into fathom_calls. Returns
//                        { synced: N }.
//   GET /fathom/status — requireAuth. Returns the caller's connection
//                        metadata + total synced call count for the
//                        dashboard's Fathom connection strip.
//
// Domain note: OAuth flows through `fathom.video/external/v1/*` (auth.js)
// but the API itself lives at `api.fathom.ai/external/v1/*`. Both URLs are
// confirmed verbatim from the fathom-typescript v0.0.40 SDK source — the
// public docs surfaced 404s on the relevant pages, so SDK source is the
// source of truth here too.
// ─────────────────────────────────────────────────────────────────────────────

const FATHOM_API_BASE   = 'https://api.fathom.ai/external/v1';
const FATHOM_TOKEN_URL  = 'https://fathom.video/external/v1/oauth2/token';
const TOKEN_EXPIRY_TOLERANCE_SECONDS = 300; // 5 min — matches OAuth route + SDK
const MAX_PAGES         = 20;   // safety cap; 20 pages * Fathom page size ≈ enough for any realistic user
// LIMITATION (Phase 1): when a user has more calls than MAX_PAGES * Fathom's
// page size in their FIRST sync (last_sync_at = null), the older tail may be
// missed depending on Fathom's sort order. We do not currently persist the
// cursor across sync runs — so we can't resume mid-walk. The response field
// `truncated: true` signals this case; the dashboard can prompt re-sync.
// Phase 1.5 (cron + cursor persistence) handles this properly. Acceptable
// for Phase 1 because steady-state syncs (with last_sync_at set) almost
// never exceed a single page worth of new calls.
const RECONNECT_HINT    = 'Fathom rejected the refresh token. Please reconnect Fathom from the dashboard.';

// Service-role client: same lazy pattern used in kb.js / me.js. Per-router so
// each can carry its own [tag] in error messages without sharing state.
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[fathom] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

// Sync uses only client_id + client_secret (for token refresh). Redirect URI
// and state secret are OAuth-flow-only — checking them here would surface
// false 503s when those vars happen to be unset but sync would otherwise work.
function requireFathomEnv() {
  var missing = [];
  if (!process.env.FATHOM_CLIENT_ID)     missing.push('FATHOM_CLIENT_ID');
  if (!process.env.FATHOM_CLIENT_SECRET) missing.push('FATHOM_CLIENT_SECRET');
  if (missing.length > 0) {
    throw new Error('Fathom OAuth not configured — missing: ' + missing.join(', ') + ' (set in Railway Variables).');
  }
}

// Refresh an expired access token. Fathom refresh tokens are single-use per
// the SDK source — every refresh returns a NEW refresh_token that we MUST
// persist alongside the new access_token in the same UPDATE. Returns the
// fresh access token on success; throws on failure (caller surfaces).
//
// If Fathom rejects the refresh token (HTTP 4xx), we mark the connection
// with last_sync_status='error' and a reconnect hint so the dashboard UI can
// route the user back through OAuth. We do NOT delete the row — that would
// erase a working connection on a transient Fathom outage.
async function refreshFathomToken(admin, userId, conn) {
  requireFathomEnv();
  var resp;
  try {
    resp = await fetch(FATHOM_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.FATHOM_CLIENT_ID,
        client_secret: process.env.FATHOM_CLIENT_SECRET,
        refresh_token: conn.refresh_token,
        grant_type:    'refresh_token',
      }),
    });
  } catch (err) {
    var netReason = 'refresh_failed: network — ' + String(err.message || 'unknown').slice(0, 120);
    await markConnectionError(admin, userId, netReason);
    throw new Error(netReason);
  }

  if (!resp.ok) {
    var bodyText = '';
    try { bodyText = await resp.text(); } catch (e) { /* ignore */ }
    // 4xx from Fathom on a refresh almost always means the refresh token is
    // dead (revoked, expired beyond TTL, or already used). 5xx is transient.
    // Both get the same treatment: mark error, surface to caller. The dashboard
    // distinguishes them by showing the reconnect hint when status >= 400 < 500.
    var statusReason = resp.status >= 400 && resp.status < 500
      ? 'refresh_failed: ' + resp.status + ' — ' + RECONNECT_HINT
      : 'refresh_failed: HTTP ' + resp.status + ' (transient)';
    await markConnectionError(admin, userId, statusReason + ' — body=' + bodyText.slice(0, 100));
    throw new Error(statusReason);
  }

  var data;
  try {
    data = await resp.json();
  } catch (err) {
    var parseReason = 'refresh_failed: invalid JSON response';
    await markConnectionError(admin, userId, parseReason);
    throw new Error(parseReason);
  }

  if (!data || typeof data.access_token !== 'string'
            || typeof data.refresh_token !== 'string'
            || typeof data.expires_in !== 'number') {
    var shapeReason = 'refresh_failed: response missing required fields';
    await markConnectionError(admin, userId, shapeReason);
    throw new Error(shapeReason);
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var expiresAt = new Date((nowSec + data.expires_in - TOKEN_EXPIRY_TOLERANCE_SECONDS) * 1000).toISOString();
  var nowIso = new Date().toISOString();

  // CRITICAL: persist the NEW refresh_token. Fathom invalidates the old one
  // immediately on use, so dropping this UPDATE would brick the connection
  // on the next refresh attempt.
  var update = await admin
    .from('fathom_connections')
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    expiresAt,
      updated_at:    nowIso,
    })
    .eq('user_id', userId);
  if (update.error) {
    var dbReason = 'refresh_failed: DB write — ' + update.error.message;
    await markConnectionError(admin, userId, dbReason);
    throw new Error(dbReason);
  }

  return data.access_token;
}

async function markConnectionError(admin, userId, reason) {
  try {
    await admin
      .from('fathom_connections')
      .update({
        last_sync_status: 'error',
        last_sync_error:  String(reason).slice(0, 500),
        updated_at:       new Date().toISOString(),
      })
      .eq('user_id', userId);
  } catch (err) {
    // Defensive — if even the error-marking fails, log and move on. The
    // caller has already failed; we don't want to mask the original error.
    console.error('[fathom] markConnectionError failed for user ' + userId + ':', err.message);
  }
}

// Returns a valid access token, refreshing if the stored one is expired or
// within the 5-min tolerance window. Caller catches and surfaces errors.
async function getValidAccessToken(admin, userId, conn) {
  var nowSec = Math.floor(Date.now() / 1000);
  var needsRefresh = !conn.expires_at
    || new Date(conn.expires_at).getTime() / 1000 < nowSec + TOKEN_EXPIRY_TOLERANCE_SECONDS;
  if (!needsRefresh) {
    return conn.access_token;
  }
  return await refreshFathomToken(admin, userId, conn);
}

// One page of meetings. Returns the parsed shape { items, next_cursor } or
// throws on any network / shape failure. Auth is Bearer per OAuth 2.0
// convention (SDK source uses `bearerAuth: token`).
async function fetchMeetingsPage(accessToken, cursor, createdAfter) {
  var url = new URL(FATHOM_API_BASE + '/meetings');
  if (createdAfter) url.searchParams.append('created_after', createdAfter);
  if (cursor)       url.searchParams.append('cursor', cursor);

  var resp = await fetch(url.toString(), {
    method:  'GET',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Accept':        'application/json',
    },
  });

  if (!resp.ok) {
    var bodyText = '';
    try { bodyText = await resp.text(); } catch (e) { /* ignore */ }
    throw new Error('meetings_fetch_failed: HTTP ' + resp.status + ' — ' + bodyText.slice(0, 200));
  }

  var data;
  try {
    data = await resp.json();
  } catch (err) {
    throw new Error('meetings_fetch_failed: invalid JSON response');
  }
  if (!data || !Array.isArray(data.items)) {
    throw new Error('meetings_fetch_failed: response missing items array');
  }
  return data;
}

// Map a Fathom Meeting object → fathom_calls row. Returns null if the
// meeting is malformed enough that we can't safely insert it (no recording_id).
// transcript_url stays NULL — Fathom returns transcripts inline via
// ?include_transcript=true, not as a separate URL. Schema column kept for
// a future Scout-hosted transcript copy.
function meetingToRow(userId, m) {
  if (!m || (typeof m.recording_id !== 'number' && typeof m.recording_id !== 'string')) return null;
  var startTime = m.recording_start_time || null;
  var endTime   = m.recording_end_time   || null;
  var durationSeconds = null;
  if (startTime && endTime) {
    var startMs = new Date(startTime).getTime();
    var endMs   = new Date(endTime).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      var raw = Math.floor((endMs - startMs) / 1000);
      // Sanity cap at 8 hours. Corrupt recording_end_time values surface in
      // real Fathom data (the demo recording shipped with the Justin account
      // came back with duration ~95M seconds = ~3 years — endTime was set to
      // the present moment while startTime was the 2021 demo recording).
      // Null is honest — it tells the dashboard "we don't know" — rather
      // than letting a fake 3-year call pollute aggregates.
      durationSeconds = (raw > 28800) ? null : raw;
    }
  }
  return {
    user_id:          userId,
    fathom_call_id:   String(m.recording_id),
    title:            (m.meeting_title && String(m.meeting_title).trim()) || (m.title && String(m.title).trim()) || null,
    recording_url:    (typeof m.url === 'string' && m.url) || null,
    transcript_url:   null,  // Fathom inline-only — see comment above
    duration_seconds: durationSeconds,
    call_date:        startTime || m.created_at || null,
    sync_status:      'pending',
  };
}

// ── GET /fathom/sync ─────────────────────────────────────────────────────────
// Manual sync trigger from the dashboard's "Sync now" button (Phase 1 ships
// manual-only; cron added in Phase 1.5). Refreshes the access token if
// needed, paginates Fathom's /meetings endpoint filtered by created_after,
// inserts new rows into fathom_calls with ON CONFLICT DO NOTHING, updates
// last_sync_at on the connection row, returns { synced: N }.
router.get('/sync', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();

    // 1. Look up the connection. 404 if the caller hasn't connected Fathom.
    var connResult = await admin
      .from('fathom_connections')
      .select('access_token, refresh_token, expires_at, last_sync_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (connResult.error) {
      console.error('[fathom] sync connection lookup failed for user ' + userId + ': ' + connResult.error.message);
      return res.status(500).json({ error: 'Could not load Fathom connection' });
    }
    if (!connResult.data) {
      return res.status(404).json({ error: 'Not connected to Fathom' });
    }
    var conn = connResult.data;

    // 2. Make sure we have a valid access token. refreshFathomToken throws
    // if Fathom rejects the refresh — surface to caller.
    var accessToken;
    try {
      accessToken = await getValidAccessToken(admin, userId, conn);
    } catch (refreshErr) {
      console.error('[fathom] sync refresh failed for user ' + userId + ': ' + refreshErr.message);
      return res.status(401).json({ error: refreshErr.message });
    }

    // 3. Paginate /meetings. created_after = last_sync_at; first sync
    // (last_sync_at null) fetches everything.
    var cursor = null;
    var pageCount = 0;
    var allRows = [];
    var malformedCount = 0;
    try {
      while (pageCount < MAX_PAGES) {
        var page = await fetchMeetingsPage(accessToken, cursor, conn.last_sync_at);
        for (var i = 0; i < page.items.length; i++) {
          var row = meetingToRow(userId, page.items[i]);
          if (row) allRows.push(row);
          else malformedCount += 1;
        }
        cursor = (typeof page.next_cursor === 'string' && page.next_cursor) ? page.next_cursor : null;
        pageCount += 1;
        if (!cursor) break;
      }
    } catch (fetchErr) {
      await markConnectionError(admin, userId, fetchErr.message);
      console.error('[fathom] sync fetch failed for user ' + userId + ': ' + fetchErr.message);
      return res.status(502).json({ error: fetchErr.message });
    }
    var hitPageCap = cursor !== null;  // pagination didn't finish naturally

    // 4. Upsert with ignoreDuplicates: maps to INSERT ... ON CONFLICT
    // (user_id, fathom_call_id) DO NOTHING. Idempotent re-syncs.
    var insertedCount = 0;
    if (allRows.length > 0) {
      var insertResult = await admin
        .from('fathom_calls')
        .upsert(allRows, { onConflict: 'user_id,fathom_call_id', ignoreDuplicates: true })
        .select('id');
      if (insertResult.error) {
        var insReason = 'sync_failed: DB insert — ' + insertResult.error.message;
        await markConnectionError(admin, userId, insReason);
        console.error('[fathom] sync insert failed for user ' + userId + ': ' + insertResult.error.message);
        return res.status(500).json({ error: 'Could not save synced calls' });
      }
      // .select('id') after upsert with ignoreDuplicates returns only newly-
      // inserted rows (the ones that weren't skipped), so length is the true
      // count of new calls landed this sync.
      insertedCount = (insertResult.data || []).length;
    }

    // 5. Mark connection success.
    var nowIso = new Date().toISOString();
    var statusUpdate = await admin
      .from('fathom_connections')
      .update({
        last_sync_at:     nowIso,
        last_sync_status: 'ok',
        last_sync_error:  null,
        updated_at:       nowIso,
      })
      .eq('user_id', userId);
    if (statusUpdate.error) {
      // Calls saved but status didn't update — log loudly. Don't fail the
      // request; the user's data is safe and the next sync will fix the
      // status row.
      console.error('[fathom] sync status update failed for user ' + userId + ': ' + statusUpdate.error.message);
    }

    console.log('[fathom] Sync complete for user ' + userId + ': fetched=' + allRows.length + ' inserted=' + insertedCount + ' malformed=' + malformedCount + ' pages=' + pageCount + (hitPageCap ? ' (CAPPED — more available)' : ''));
    return res.json({
      synced:    insertedCount,
      fetched:   allRows.length,
      malformed: malformedCount,
      pages:     pageCount,
      truncated: hitPageCap,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] sync fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── GET /fathom/status ───────────────────────────────────────────────────────
// Dashboard polls this on load to decide which Fathom strip to show.
// Returns connection metadata (with tokens redacted — never leak) plus the
// total call count synced for this user. Two parallel queries since there's
// no FK between fathom_calls and fathom_connections.
router.get('/status', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();

    var connPromise = admin
      .from('fathom_connections')
      .select('connected_at, last_sync_at, last_sync_status, last_sync_error, scope, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    var countPromise = admin
      .from('fathom_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    var connResult = await connPromise;
    var countResult = await countPromise;

    if (connResult.error) {
      console.error('[fathom] status connection lookup failed for user ' + userId + ': ' + connResult.error.message);
      return res.status(500).json({ error: 'Could not load Fathom status' });
    }
    if (countResult.error) {
      // Non-fatal: render with 0 calls. The strip will still show connection state.
      console.error('[fathom] status count lookup failed for user ' + userId + ': ' + countResult.error.message);
    }

    if (!connResult.data) {
      return res.json({ connected: false });
    }
    var c = connResult.data;
    return res.json({
      connected:        true,
      connected_at:     c.connected_at,
      last_sync_at:     c.last_sync_at,
      last_sync_status: c.last_sync_status,
      last_sync_error:  c.last_sync_error,
      scope:            c.scope,
      expires_at:       c.expires_at,
      call_count:       (typeof countResult.count === 'number') ? countResult.count : 0,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] status fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Status failed' });
  }
});

module.exports = router;
