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
//
// includeTranscript / includeHighlights default to false to preserve the
// /sync route's behavior (it only needs metadata for upserting new rows).
// The analysis worker calls this with both = true to get the full meeting
// payload Claude needs to grade and extract highlights from.
async function fetchMeetingsPage(accessToken, cursor, createdAfter, includeTranscript, includeHighlights, recordedBy) {
  var url = new URL(FATHOM_API_BASE + '/meetings');
  if (createdAfter)       url.searchParams.append('created_after',      createdAfter);
  if (cursor)             url.searchParams.append('cursor',             cursor);
  if (includeTranscript)  url.searchParams.append('include_transcript', 'true');
  if (includeHighlights)  url.searchParams.append('include_highlights', 'true');

  // recorded_by[] is Fathom's server-side owner filter — meetings recorded by
  // the given email. WITHOUT it, /meetings returns the entire team workspace's
  // recordings (there is no implicit per-user scoping on an OAuth token).
  // Appended manually to keep the brackets literal (recorded_by[]=email, the
  // SDK's on-the-wire form); URLSearchParams would percent-encode them to
  // %5B%5D. The email value is URL-encoded. `recordedBy` may be a single email
  // string or an array of emails (one recorded_by[] per address).
  var urlStr = url.toString();
  if (recordedBy) {
    var emails = Array.isArray(recordedBy) ? recordedBy : [recordedBy];
    for (var e = 0; e < emails.length; e++) {
      if (!emails[e]) continue;
      urlStr += (urlStr.indexOf('?') === -1 ? '?' : '&') + 'recorded_by[]=' + encodeURIComponent(emails[e]);
    }
  }

  var resp = await fetch(urlStr, {
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

// One recording's transcript via the dedicated /recordings/{id}/transcript
// endpoint. OAuth apps CANNOT use ?include_transcript=true on /meetings — for
// OAuth-scoped tokens that param is silently ignored, so the meeting payload
// comes back with NO transcript and the analysis worker would see zero turns.
// This sync-mode call (no destination_url param) returns the transcript array
// inline in the response body. Auth is Bearer, same pattern as
// fetchMeetingsPage. Returns response.transcript; throws on non-200 or a
// missing/invalid transcript field. Errors logged with the [fathom] prefix.
async function fetchRecordingTranscript(accessToken, recordingId) {
  var url = FATHOM_API_BASE + '/recordings/' + encodeURIComponent(recordingId) + '/transcript';

  var resp = await fetch(url, {
    method:  'GET',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Accept':        'application/json',
    },
  });

  if (!resp.ok) {
    var bodyText = '';
    try { bodyText = await resp.text(); } catch (e) { /* ignore */ }
    console.error('[fathom] transcript fetch failed for recording ' + recordingId + ': HTTP ' + resp.status + ' — ' + bodyText.slice(0, 200));
    throw new Error('transcript_fetch_failed: HTTP ' + resp.status + ' — ' + bodyText.slice(0, 200));
  }

  var data;
  try {
    data = await resp.json();
  } catch (err) {
    console.error('[fathom] transcript fetch returned invalid JSON for recording ' + recordingId);
    throw new Error('transcript_fetch_failed: invalid JSON response');
  }
  if (!data || !Array.isArray(data.transcript)) {
    console.error('[fathom] transcript fetch response missing transcript array for recording ' + recordingId);
    throw new Error('transcript_fetch_failed: response missing transcript array');
  }
  return data.transcript;
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
      .select('access_token, refresh_token, expires_at, last_sync_at, fathom_email')
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

    // 1b. Identity gate. Without the connected user's Fathom email we cannot
    // apply the recorded_by[] filter — and syncing unfiltered would pull the
    // ENTIRE team workspace's recordings (the exact bug this fixes). So refuse
    // to sync and signal the dashboard to prompt for the email instead.
    if (!conn.fathom_email) {
      console.log('[fathom] sync blocked for user ' + userId + ': fathom_email not set (needs_identity)');
      return res.json({ needs_identity: true });
    }

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
        var page = await fetchMeetingsPage(accessToken, cursor, conn.last_sync_at, false, false, conn.fathom_email);
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

    // 6. Fire-and-forget post-sync analysis. Dispatch sequentially per call
    //    so we respect Anthropic rate limits and produce predictable ordering
    //    in the dashboard. Lazy-required to sidestep the circular dependency
    //    between routes/fathom.js and lib/analysis-worker.js (the worker
    //    imports the token + fetch helpers exported below). Errors per call
    //    are caught + logged; never propagated. The sync response has
    //    already been sent by the time these run — closers never wait.
    var newCallIds = (insertResult && insertResult.data || []).map(function(r) { return r.id; });
    if (newCallIds.length > 0) {
      (async function() {
        try {
          var analyzeCall = require('../lib/analysis-worker').analyzeCall;
          for (var i = 0; i < newCallIds.length; i++) {
            try {
              await analyzeCall(newCallIds[i], userId);
            } catch (innerErr) {
              console.error('[fathom] analyzeCall failed for call ' + newCallIds[i] + ' (user=' + userId + '): ' + (innerErr.message || 'unknown'));
            }
          }
        } catch (outerErr) {
          console.error('[fathom] background analysis loop error (user=' + userId + '): ' + (outerErr.message || 'unknown'));
        }
      })();
    }

    console.log('[fathom] Sync complete for user ' + userId + ': fetched=' + allRows.length + ' inserted=' + insertedCount + ' malformed=' + malformedCount + ' pages=' + pageCount + (hitPageCap ? ' (CAPPED — more available)' : '') + (newCallIds.length > 0 ? ' analysis_dispatched=' + newCallIds.length : ''));
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

// ── POST /fathom/reanalyze ────────────────────────────────────────────────────
// Retry analysis on calls already in the DB but still sitting at
// sync_status='pending' — e.g. rows reset back to 'pending' after a worker bug
// fix (the OAuth transcript fix that left Josh's 200 calls stuck at 'error').
// The /sync route only dispatches analyzeCall for NEWLY-inserted rows, so
// pre-existing pending rows never get picked up; this route is the manual
// re-trigger (and the foundation of the Phase 2 dashboard retry button).
//
// Does NOT call Fathom's /meetings — it re-analyzes what's already stored.
// Returns { queued: N } immediately; analysis runs in the same fire-and-forget
// IIFE pattern as /sync so the caller never waits.
router.post('/reanalyze', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();

    // Batch size from the request body. Default 10, hard cap 50 — keeps one
    // click to a bounded, quality-checkable sample rather than draining a huge
    // backlog (Josh had 381 pending) into a multi-hour, full-budget run. The
    // detached fire-and-forget loop below isn't durable across dyno restarts,
    // so smaller batches also bound how much is lost if a redeploy interrupts it.
    var body = req.body || {};
    var limit = parseInt(body.limit, 10);
    if (!limit || limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    // Pull this caller's pending calls, most recent first (recent calls are the
    // ones worth reviewing), capped at the batch limit. Scoped to user_id so one
    // closer's retry can never touch another's rows.
    var pendingResult = await admin
      .from('fathom_calls')
      .select('id')
      .eq('user_id', userId)
      .eq('sync_status', 'pending')
      .order('call_date', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (pendingResult.error) {
      console.error('[fathom] reanalyze lookup failed for user ' + userId + ': ' + pendingResult.error.message);
      return res.status(500).json({ error: 'Could not load pending calls' });
    }
    var pendingIds = (pendingResult.data || []).map(function(r) { return r.id; });

    // Fire-and-forget — identical dispatch shape to the /sync IIFE: sequential
    // (Anthropic rate limits + predictable dashboard ordering), lazy-required to
    // dodge the routes/fathom.js ↔ lib/analysis-worker.js circular dependency,
    // per-call errors caught + logged, never propagated. The response below has
    // already been sent by the time these run — closers never wait.
    if (pendingIds.length > 0) {
      (async function() {
        try {
          var analyzeCall = require('../lib/analysis-worker').analyzeCall;
          for (var i = 0; i < pendingIds.length; i++) {
            try {
              await analyzeCall(pendingIds[i], userId);
            } catch (innerErr) {
              console.error('[fathom] reanalyze analyzeCall failed for call ' + pendingIds[i] + ' (user=' + userId + '): ' + (innerErr.message || 'unknown'));
            }
          }
        } catch (outerErr) {
          console.error('[fathom] reanalyze background loop error (user=' + userId + '): ' + (outerErr.message || 'unknown'));
        }
      })();
    }

    console.log('[fathom] Reanalyze queued for user ' + userId + ': queued=' + pendingIds.length + ' (batch_limit=' + limit + ')');
    return res.json({ queued: pendingIds.length, batch_limit: limit });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] reanalyze fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Reanalyze failed' });
  }
});

// ── GET /fathom/identity-options ──────────────────────────────────────────────
// Feeds the dashboard's "which email do you use for Fathom?" prompt. Returns the
// currently-stored fathom_email (or null) plus a suggestion list.
//
// The suggestions come from Fathom itself: we fetch ONE unfiltered page of
// meetings and tally the distinct recorded_by emails (with counts, most frequent
// first) so the user PICKS their real recorder identity instead of guessing.
// This is important because Fathom's recorded_by is often a workspace-assigned
// email that differs from the user's login/Scout email (e.g. joshua.mock@8fig.co
// vs josh@scoutsystems.io) — a guessed login email filters to zero calls. Falls
// back to the Scout login email if the fetch fails or the user isn't connected.
router.get('/identity-options', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();
    var connResult = await admin
      .from('fathom_connections')
      .select('access_token, refresh_token, expires_at, fathom_email')
      .eq('user_id', userId)
      .maybeSingle();
    if (connResult.error) {
      console.error('[fathom] identity-options lookup failed for user ' + userId + ': ' + connResult.error.message);
      return res.status(500).json({ error: 'Could not load Fathom identity' });
    }
    var conn = connResult.data;
    var current = (conn && conn.fathom_email) || null;

    // Last-resort fallback: the Scout login email (may differ from Fathom's —
    // that's exactly why the picked-from-data suggestions below are preferred).
    var scoutFallback = req.user.email
      ? [{ email: req.user.email, name: null, count: null }]
      : [];

    // Not connected / no token — can't ask Fathom who recorded. Fall back.
    if (!conn || !conn.access_token) {
      return res.json({ current: current, suggestions: scoutFallback });
    }

    var suggestions;
    try {
      var accessToken = await getValidAccessToken(admin, userId, conn);
      var page = await fetchMeetingsPage(accessToken, null, null, false, false);
      var items = Array.isArray(page.items) ? page.items : [];
      var byEmail = {};
      for (var i = 0; i < items.length; i++) {
        var rb = items[i] && items[i].recorded_by;
        if (!rb || typeof rb.email !== 'string' || !rb.email) continue;
        if (!byEmail[rb.email]) {
          byEmail[rb.email] = { email: rb.email, name: (typeof rb.name === 'string' ? rb.name : null), count: 0 };
        }
        byEmail[rb.email].count += 1;
      }
      suggestions = Object.keys(byEmail).map(function(k) { return byEmail[k]; })
        .sort(function(a, b) { return b.count - a.count; })
        .slice(0, 8);
      if (suggestions.length === 0) suggestions = scoutFallback;
    } catch (fetchErr) {
      // Best-effort: a Fathom hiccup shouldn't break the prompt.
      console.error('[fathom] identity-options meeting fetch failed for user ' + userId + ': ' + (fetchErr.message || 'unknown'));
      suggestions = scoutFallback;
    }

    return res.json({ current: current, suggestions: suggestions });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] identity-options fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Could not load Fathom identity' });
  }
});

// ── POST /fathom/identity ─────────────────────────────────────────────────────
// Stores the connected user's Fathom email (from the dashboard prompt) so sync
// can apply the recorded_by[] filter. Plausible-email validation only — the real
// confirmation is whether a filtered sync returns the user's own calls. UPDATE
// (not upsert): a connection row must already exist to be setting identity.
router.post('/identity', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var body = req.body || {};
    var email = (typeof body.email === 'string') ? body.email.trim() : '';
    if (!email || email.length > 254 || /\s/.test(email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    var admin = getAdminClient();
    var update = await admin
      .from('fathom_connections')
      .update({ fathom_email: email, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (update.error) {
      console.error('[fathom] identity save failed for user ' + userId + ': ' + update.error.message);
      return res.status(500).json({ error: 'Could not save Fathom email' });
    }
    console.log('[fathom] identity set for user ' + userId);
    return res.json({ ok: true });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] identity save fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Could not save Fathom email' });
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
    // Pending-call count drives the dashboard's "Reanalyze" button visibility —
    // the button only shows when there are calls sitting at sync_status='pending'
    // waiting for the analysis worker (e.g. rows reset after the transcript fix).
    var pendingCountPromise = admin
      .from('fathom_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('sync_status', 'pending');

    var connResult = await connPromise;
    var countResult = await countPromise;
    var pendingCountResult = await pendingCountPromise;

    if (connResult.error) {
      console.error('[fathom] status connection lookup failed for user ' + userId + ': ' + connResult.error.message);
      return res.status(500).json({ error: 'Could not load Fathom status' });
    }
    if (countResult.error) {
      // Non-fatal: render with 0 calls. The strip will still show connection state.
      console.error('[fathom] status count lookup failed for user ' + userId + ': ' + countResult.error.message);
    }
    if (pendingCountResult.error) {
      // Non-fatal: render with 0 pending (Reanalyze button stays hidden).
      console.error('[fathom] status pending-count lookup failed for user ' + userId + ': ' + pendingCountResult.error.message);
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
      pending_count:    (typeof pendingCountResult.count === 'number') ? pendingCountResult.count : 0,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] status fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Status failed' });
  }
});

// ── GET /fathom/calls ────────────────────────────────────────────────────────
// Powers the v1.3.0 Call Library page on the dashboard. Returns the caller's
// fathom_calls page joined with the corresponding call_analyses row (when one
// exists) so each card can show its analysis state + score in one round trip.
//
// Pagination: limit (1..100, default 20) + offset (>=0, default 0). This
// diverges from /me/sessions's `?before=` cursor pattern by design — the
// brief for the Call Library specified limit/offset, and call counts per
// user are bounded enough that offset performance isn't a concern at this
// scale. Cursor can be added in a follow-up if user counts grow.
//
// The join is two queries + JS merge to match the established
// computeCountsBySession-style pattern in /me/sessions (supabase-js v2 has
// no Postgres JOIN syntax; embed-via-FK was considered but adds extra
// complexity for a one-to-zero-or-one relationship like this one).
router.get('/calls', requireAuth, async function(req, res) {
  var userId = req.user.id;

  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  var offset = parseInt(req.query.offset, 10);
  if (!offset || offset < 0) offset = 0;

  try {
    var admin = getAdminClient();

    // 1) Page of fathom_calls for the caller, newest-first by call_date.
    //    Rows with NULL call_date sort last so they don't outrank dated calls.
    var callsResult = await admin
      .from('fathom_calls')
      .select('id, fathom_call_id, title, call_date, duration_seconds, recording_url, sync_status')
      .eq('user_id', userId)
      .order('call_date', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (callsResult.error) {
      console.error('[fathom] /calls fetch failed for user ' + userId + ': ' + callsResult.error.message);
      return res.status(500).json({ error: 'Could not load calls' });
    }
    var calls = callsResult.data || [];
    if (calls.length === 0) {
      return res.json({ calls: [], limit: limit, offset: offset });
    }

    // 2) Companion call_analyses rows (zero-or-one per fathom_call_id).
    //    Non-fatal — if this query fails we still render the calls list
    //    with null analysis fields so the dashboard isn't blocked by an
    //    analysis-table outage.
    var fathomCallIds = calls.map(function(c) { return c.id; });
    var analysesResult = await admin
      .from('call_analyses')
      .select('fathom_call_id, status, overall_score, overall_summary')
      .in('fathom_call_id', fathomCallIds);
    if (analysesResult.error) {
      console.error('[fathom] /calls analyses fetch failed for user ' + userId + ': ' + analysesResult.error.message);
    }
    var analysisByCallId = {};
    var analyses = analysesResult.data || [];
    for (var i = 0; i < analyses.length; i++) {
      analysisByCallId[analyses[i].fathom_call_id] = analyses[i];
    }

    var enriched = calls.map(function(c) {
      var a = analysisByCallId[c.id] || null;
      return {
        id:               c.id,
        fathom_call_id:   c.fathom_call_id,
        title:            c.title,
        call_date:        c.call_date,
        duration_seconds: c.duration_seconds,
        recording_url:    c.recording_url,
        sync_status:      c.sync_status,
        analysis_status:  a ? a.status          : null,
        overall_score:    a ? a.overall_score   : null,
        overall_summary:  a ? a.overall_summary : null,
      };
    });

    res.json({ calls: enriched, limit: limit, offset: offset });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] /calls fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Failed to load calls' });
  }
});

// ── GET /fathom/calls/:id ────────────────────────────────────────────────────
// Powers the Call Review page. Returns ONE call plus its companion
// call_analyses row (or null) and call_highlights rows (ordered by
// sequence_order ASC). 404 if the call doesn't exist OR belongs to a
// different user — same opacity pattern as /me/sessions/:id/logs to avoid
// leaking call-id validity to unauthorized users.
//
// Two queries + JS merge (matches the /calls precedent — supabase-js v2 has
// no native JOIN; embed-via-FK was considered but adds complexity for a
// zero-or-one relationship). Highlights query is non-fatal: a transient
// call_highlights outage still surfaces the call + its analysis with
// highlights:[].
router.get('/calls/:id', requireAuth, async function(req, res) {
  var userId = req.user.id;
  var callId = req.params.id;
  if (!callId) return res.status(400).json({ error: 'call id required' });

  try {
    var admin = getAdminClient();

    // 1) Call row — ownership-checked. 404 covers both "doesn't exist" and
    //    "belongs to another user" to avoid leaking ID validity.
    var callResult = await admin
      .from('fathom_calls')
      .select('id, user_id, fathom_call_id, title, call_date, duration_seconds, recording_url, sync_status')
      .eq('id', callId)
      .maybeSingle();
    if (callResult.error) {
      console.error('[fathom] /calls/:id fetch failed for user ' + userId + ' call ' + callId + ': ' + callResult.error.message);
      return res.status(500).json({ error: 'Could not load call' });
    }
    if (!callResult.data || callResult.data.user_id !== userId) {
      return res.status(404).json({ error: 'Call not found' });
    }
    var call = callResult.data;

    // 2) Analysis row (zero-or-one). Non-fatal: render the call without
    //    analysis fields if the table read errors.
    var analysisResult = await admin
      .from('call_analyses')
      .select('status, overall_score, overall_summary, one_thing, follow_up_email, speaker_closer_name, intro_grade, intro_score, intro_notes, discovery_grade, discovery_score, discovery_notes, pitch_grade, pitch_score, pitch_notes, objection_grade, objection_score, objection_notes, close_grade, close_score, close_notes')
      .eq('fathom_call_id', callId)
      .maybeSingle();
    if (analysisResult.error) {
      console.error('[fathom] /calls/:id analysis fetch failed for user ' + userId + ' call ' + callId + ': ' + analysisResult.error.message);
    }
    var analysis = analysisResult.data || null;

    // 3) Highlights rows (zero or many). Non-fatal — render with empty
    //    highlights array on failure so the page still loads.
    var highlightsResult = await admin
      .from('call_highlights')
      .select('timestamp_seconds, speaker, quote, observation, type, sequence_order')
      .eq('fathom_call_id', callId)
      .order('sequence_order', { ascending: true });
    if (highlightsResult.error) {
      console.error('[fathom] /calls/:id highlights fetch failed for user ' + userId + ' call ' + callId + ': ' + highlightsResult.error.message);
    }
    var highlights = highlightsResult.data || [];

    res.json({
      id:               call.id,
      fathom_call_id:   call.fathom_call_id,
      title:            call.title,
      call_date:        call.call_date,
      duration_seconds: call.duration_seconds,
      recording_url:    call.recording_url,
      sync_status:      call.sync_status,
      analysis:         analysis,
      highlights:       highlights,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] /calls/:id fatal for user ' + userId + ' call ' + callId + ':', err.message);
    res.status(500).json({ error: 'Failed to load call' });
  }
});

// Exported for backend/lib/analysis-worker.js — same precedent as me.js
// (router._computeCoachingPatterns, etc.). Lib code that needs the same
// token-refresh + Fathom-fetch logic imports these rather than duplicating.
// Picking up a route file's helpers via attached underscore properties is a
// slight architectural smell but matches the established Scout pattern and
// keeps file churn minimal — if a third consumer appears (CRM client in
// v1.5.0+), the right time to extract to backend/lib/fathom-client.js is then.
router._getValidAccessToken = getValidAccessToken;
router._refreshFathomToken  = refreshFathomToken;
router._fetchMeetingsPage   = fetchMeetingsPage;
router._fetchRecordingTranscript = fetchRecordingTranscript;
router._markConnectionError = markConnectionError;

module.exports = router;
