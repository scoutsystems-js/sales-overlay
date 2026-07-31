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
// Core per-user sync. Takes an already-loaded connection row (access_token,
// refresh_token, expires_at, last_sync_at, fathom_email) and does token refresh
// → paginate /meetings → upsert new fathom_calls → update connection status →
// fire-and-forget analysis of NEWLY-inserted rows. Returns a result object
// instead of touching res, so both the authed /sync route AND the cron
// /sync-all endpoint can reuse it identically.
//
// The synced_unanalyzed holdback is respected for free: the upsert is ON
// CONFLICT DO NOTHING, so held rows are never re-inserted and thus never land
// in newCallIds — only genuinely NEW calls (which arrive as sync_status='pending'
// via meetingToRow) get analysis dispatched.
//
// Result shapes:
//   { ok:true, synced, fetched, malformed, pages, truncated, dispatched }
//   { ok:false, kind:'needs_identity' }
//   { ok:false, kind:'refresh_failed'|'fetch_failed'|'insert_failed', error }
async function syncUserCalls(admin, userId, conn) {
  // Identity gate — without the recorded_by[] email a sync would pull the whole
  // team workspace, so refuse and signal the dashboard to prompt for it.
  if (!conn.fathom_email) {
    console.log('[fathom] sync blocked for user ' + userId + ': fathom_email not set (needs_identity)');
    return { ok: false, kind: 'needs_identity' };
  }

  // Valid access token (refreshFathomToken throws if Fathom rejects the refresh).
  var accessToken;
  try {
    accessToken = await getValidAccessToken(admin, userId, conn);
  } catch (refreshErr) {
    console.error('[fathom] sync refresh failed for user ' + userId + ': ' + refreshErr.message);
    return { ok: false, kind: 'refresh_failed', error: refreshErr.message };
  }

  // Paginate /meetings. created_after = last_sync_at; first sync fetches all.
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
    return { ok: false, kind: 'fetch_failed', error: fetchErr.message };
  }
  var hitPageCap = cursor !== null;  // pagination didn't finish naturally

  // Upsert with ignoreDuplicates → INSERT ... ON CONFLICT DO NOTHING. Idempotent.
  var insertedCount = 0;
  var insertResult = null;
  if (allRows.length > 0) {
    insertResult = await admin
      .from('fathom_calls')
      .upsert(allRows, { onConflict: 'user_id,fathom_call_id', ignoreDuplicates: true })
      .select('id, call_date');
    if (insertResult.error) {
      var insReason = 'sync_failed: DB insert — ' + insertResult.error.message;
      await markConnectionError(admin, userId, insReason);
      console.error('[fathom] sync insert failed for user ' + userId + ': ' + insertResult.error.message);
      return { ok: false, kind: 'insert_failed', error: insertResult.error.message };
    }
    // .select('id') after ignoreDuplicates returns only newly-inserted rows.
    insertedCount = (insertResult.data || []).length;
  }

  // Mark connection success.
  var nowIso = new Date().toISOString();
  var statusUpdate = await admin
    .from('fathom_connections')
    .update({ last_sync_at: nowIso, last_sync_status: 'ok', last_sync_error: null, updated_at: nowIso })
    .eq('user_id', userId);
  if (statusUpdate.error) {
    // Calls saved but status row didn't update — log; the next sync fixes it.
    console.error('[fathom] sync status update failed for user ' + userId + ': ' + statusUpdate.error.message);
  }

  // Fire-and-forget post-sync analysis of the NEW rows only. Sequential (rate
  // limits + predictable ordering), lazy-required to dodge the fathom↔worker
  // circular dependency, per-call errors caught. Detached — not durable across a
  // Railway restart (bounded batches keep the blast radius small).
  // FD-4 cap: auto-analyze only the newest FIRST_SYNC_ANALYZE_CAP newly-synced
  // calls. The rest were still inserted (sync_status='pending') and are reachable
  // via Update-analyses backfill — they just don't fire a Claude call on connect.
  var newRows = (insertResult && insertResult.data) || [];
  var newCallIds = pickNewestForAnalysis(newRows, FIRST_SYNC_ANALYZE_CAP);
  if (newRows.length > newCallIds.length) {
    console.log('[fathom] sync: capped auto-analysis to newest ' + newCallIds.length + ' of ' + newRows.length + ' new calls for user ' + userId + ' (rest stay pending for backfill)');
  }
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
  return {
    ok: true,
    synced: insertedCount, fetched: allRows.length, malformed: malformedCount,
    pages: pageCount, truncated: hitPageCap, dispatched: newCallIds.length,
  };
}

router.get('/sync', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();

    // Look up the connection. 404 if the caller hasn't connected Fathom.
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

    var r = await syncUserCalls(admin, userId, connResult.data);
    if (!r.ok) {
      if (r.kind === 'needs_identity') return res.json({ needs_identity: true });
      if (r.kind === 'refresh_failed') return res.status(401).json({ error: r.error });
      if (r.kind === 'fetch_failed')   return res.status(502).json({ error: r.error });
      return res.status(500).json({ error: 'Could not save synced calls' });
    }
    return res.json({
      synced:    r.synced,
      fetched:   r.fetched,
      malformed: r.malformed,
      pages:     r.pages,
      truncated: r.truncated,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] sync fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── POST /fathom/sync-all ─────────────────────────────────────────────────────
// Cron-triggered bulk sync (Phase 1.5 — the auto-sync deferred from Phase 1).
// Protected by a shared secret (X-Cron-Secret header must equal CRON_SECRET),
// NOT requireAuth — the cron has no user session. Iterates every connection that
// has a fathom_email set and runs the same per-user sync; per-user failures are
// logged and DO NOT halt the loop. New calls sync in as 'pending' and analyze;
// held ('synced_unanalyzed') calls are never re-inserted, so they stay held.
router.post('/sync-all', async function(req, res) {
  var secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[fathom] sync-all called but CRON_SECRET is not set — refusing');
    return res.status(503).json({ error: 'cron not configured' });
  }
  var provided = req.get('X-Cron-Secret') || (req.query && req.query.secret) || '';
  if (provided !== secret) {
    console.warn('[fathom] sync-all unauthorized attempt');
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    var admin = getAdminClient();
    var connsResult = await admin
      .from('fathom_connections')
      .select('user_id, access_token, refresh_token, expires_at, last_sync_at, fathom_email')
      .not('fathom_email', 'is', null);
    if (connsResult.error) {
      console.error('[fathom] sync-all connection list failed: ' + connsResult.error.message);
      return res.status(500).json({ error: 'Could not load connections' });
    }
    var conns = connsResult.data || [];
    // Skip DEACTIVATED users (User Management, 2026-07-27): a freed seat stops
    // pulling NEW calls. Their existing calls/history are untouched. Absent
    // profile row → active by default (matches the column default).
    var inactive = {};
    if (conns.length) {
      var uids = conns.map(function (c) { return c.user_id; });
      var actQ = await admin.from('user_profiles').select('user_id, active').in('user_id', uids);
      if (!actQ.error) (actQ.data || []).forEach(function (p) { if (p.active === false) inactive[p.user_id] = true; });
    }
    var summary = { total: conns.length, ok: 0, synced_total: 0, dispatched_total: 0, needs_identity: 0, skipped_inactive: 0, errors: 0 };
    for (var i = 0; i < conns.length; i++) {
      var conn = conns[i];
      var uid = conn.user_id;
      if (inactive[uid]) { summary.skipped_inactive += 1; continue; }
      try {
        var r = await syncUserCalls(admin, uid, conn);
        if (r.ok) {
          summary.ok += 1;
          summary.synced_total += r.synced;
          summary.dispatched_total += r.dispatched;
        } else if (r.kind === 'needs_identity') {
          summary.needs_identity += 1;
        } else {
          summary.errors += 1;
          console.error('[fathom] sync-all user ' + uid + ' failed: ' + r.kind + ' ' + (r.error || ''));
        }
      } catch (perUserErr) {
        // A single user's failure must never halt the loop.
        summary.errors += 1;
        console.error('[fathom] sync-all user ' + uid + ' threw: ' + (perUserErr.message || 'unknown'));
      }
    }
    console.log('[fathom] sync-all done: ' + JSON.stringify(summary));

    // Post-sync step: daily manager digests (v1.4 final stage). Fires AFTER
    // every user's sync has completed (the loop above is sequential). Detached
    // fire-and-forget + internally per-manager error-isolated — a digest
    // problem must never fail or block the sync cron (same degrade-gracefully
    // rule as KB). Idempotent across the every-2h cron: the digest cache is
    // keyed per (manager, ET-yesterday, analysis-set+kb hash), so repeat runs
    // in the same day are cache hits with zero Claude spend.
    (async function () {
      try {
        var generateDailyDigests = require('../lib/team-digest').generateDailyDigests;
        await generateDailyDigests(admin);
      } catch (digestErr) {
        console.error('[fathom] sync-all digest pass threw (isolated): ' + (digestErr.message || 'unknown'));
      }
    })();

    return res.json(summary);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] sync-all fatal: ' + err.message);
    res.status(500).json({ error: 'sync-all failed' });
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

// ── POST /fathom/update-analyses ──────────────────────────────────────────────
// Re-analyze calls that were graded under an OLDER prompt version so they pick up
// the current grader (e.g. Josh's v3 calls → v4 "why this call closed" fields).
// Batch ORDERING only (not sizing): pending block first (explicitly queued work
// outranks staleness), then outdated; BOTH newest-first by fathom_calls.call_date,
// missing dates last within their block. Batch SIZE is set by the caller — the
// first-sync cap (FIRST_SYNC_ANALYZE_CAP) or the re-grade `limit` (default 10) —
// never a fixed 20. Pure — exported for tests.
function orderBatchIds(pendingIds, outdatedIds, dateById) {
  function newestFirst(ids) {
    return ids.slice().sort(function (a, b) {
      var da = dateById[a] || '', db = dateById[b] || '';
      return da < db ? 1 : (da > db ? -1 : 0);
    });
  }
  var seen = {};
  return newestFirst(pendingIds).concat(newestFirst(outdatedIds)).filter(function (id) {
    if (seen[id]) return false; seen[id] = true; return true;
  });
}

// First-sync analysis cap (ruling 2026-07-31, Option B). On a sync, only the
// newest FIRST_SYNC_ANALYZE_CAP newly-synced calls are auto-analyzed; the rest
// sync (sync_status='pending') and stay unanalyzed until the user backfills via
// Update-analyses (7d/30d/all, dry-run + confirm). Rationale: "analyze everything
// on connect" is unbounded — a customer with years of history would auto-fire
// hundreds of Claude analyses, slow + costly, never chosen. Capping gives fast
// time-to-value and loses nothing (the dropdown is the deliberate backfill path).
// MIRROR this cap for Zoom sync when that lands (sub-stage 2).
var FIRST_SYNC_ANALYZE_CAP = 20;

// Pure: given newly-inserted rows [{id, call_date}], return the ids of the newest
// `cap` by call_date (descending; missing/null dates sort last). Exported for tests.
function pickNewestForAnalysis(rows, cap) {
  return (rows || []).slice().sort(function (a, b) {
    var da = (a && a.call_date) || '', db = (b && b.call_date) || '';
    return da < db ? 1 : (da > db ? -1 : 0); // newest first; '' (missing date) sorts last
  }).slice(0, cap).map(function (r) { return r.id; });
}

// Same shape as /reanalyze, with an explicit reset step: it selects outdated
// 'processed' calls (excluding held/error), flips fathom_calls.sync_status +
// call_analyses.status back to 'pending', then fires the same fire-and-forget
// analyze loop. Kept as its own route (rather than two client round-trips to
// /reanalyze) so the reset + dispatch are atomic and can't race a status poll.
router.post('/update-analyses', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();
    var worker = require('../lib/analysis-worker');
    var currentVersion = worker.ANALYSIS_PROMPT_VERSION;

    var body = req.body || {};
    var limit = parseInt(body.limit, 10);
    if (!limit || limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    var outdatedIds;
    try {
      outdatedIds = await outdatedCallIds(admin, userId, currentVersion);
    } catch (lookupErr) {
      console.error('[fathom] update-analyses lookup failed for user ' + userId + ': ' + lookupErr.message);
      return res.status(500).json({ error: 'Could not load outdated calls' });
    }
    // One batch covers BOTH stale-version analyses and calls already sitting at
    // sync_status='pending' (manually reset / recovered rows) — pending rows are
    // status!='done' so outdatedCallIds can't see them, and without this union a
    // reset call would need a separate /reanalyze click. Pending first (they
    // were explicitly queued), then outdated; sets are disjoint by construction
    // (pending analyses are never status='done') but dedupe anyway.
    var pendingQ = await admin
      .from('fathom_calls')
      .select('id')
      .eq('user_id', userId)
      .eq('sync_status', 'pending')
      .order('call_date', { ascending: false, nullsFirst: false });
    var pendingIds2 = pendingQ.error ? [] : (pendingQ.data || []).map(function (r) { return r.id; });
    if (pendingQ.error) console.error('[fathom] update-analyses pending lookup failed (proceeding with outdated only): ' + pendingQ.error.message);
    // Newest-first by CALL date across both blocks (outdatedCallIds orders by
    // analyzed_at, which is analysis recency, not call recency) — fetch the
    // call dates for the union and let orderBatchIds do the rest.
    var dateById = {};
    var allIds = pendingIds2.concat(outdatedIds);
    for (var ci = 0; ci < allIds.length; ci += 100) {
      var dq = await admin.from('fathom_calls').select('id, call_date').in('id', allIds.slice(ci, ci + 100));
      if (dq.error) { console.error('[fathom] update-analyses date lookup failed (order degrades to analyzed_at): ' + dq.error.message); break; }
      (dq.data || []).forEach(function (r) { dateById[r.id] = r.call_date || ''; });
    }
    var unionIds = orderBatchIds(pendingIds2, outdatedIds, dateById);

    // How-far-back scope (2026-07-27): '7d' | '30d' | 'all' re-grades EVERY
    // outdated/pending call in that window (not just the newest 20). Backward-
    // compatible: without `scope`, the old newest-`limit` batch behaviour holds.
    // dry_run returns the count only, so the UI can confirm before triggering
    // (all-time on 250+ calls = 250+ Claude calls).
    var scope = (typeof body.scope === 'string') ? body.scope : null;
    var ids;
    if (scope) {
      var days = scope === 'all' ? null : (scope === '7d' ? 7 : scope === '30d' ? 30 : NaN);
      if (Number.isNaN(days)) return res.status(400).json({ error: "scope must be '7d', '30d', or 'all'" });
      if (days == null) { ids = unionIds; }
      else {
        var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        ids = unionIds.filter(function (id) { return (dateById[id] || '') >= cutoff; });
      }
    } else {
      ids = unionIds.slice(0, limit);
    }

    if (body.dry_run) {
      return res.json({ count: ids.length, scope: scope || null, outdated: outdatedIds.length, pending: pendingIds2.length });
    }

    if (ids.length > 0) {
      // Reset step: back to 'pending' on both tables so the worker re-grades them
      // (and so the reanalyze/pending UI reflects them if the page reloads mid-run).
      var fcReset = await admin.from('fathom_calls').update({ sync_status: 'pending' }).in('id', ids);
      if (fcReset.error) {
        console.error('[fathom] update-analyses fathom_calls reset failed for user ' + userId + ': ' + fcReset.error.message);
        return res.status(500).json({ error: 'Could not reset calls' });
      }
      var caReset = await admin.from('call_analyses').update({ status: 'pending' }).in('fathom_call_id', ids);
      if (caReset.error) {
        // Non-fatal: fathom_calls is already pending; the worker re-upserts the
        // analysis row anyway. Log and proceed.
        console.error('[fathom] update-analyses call_analyses reset failed for user ' + userId + ': ' + caReset.error.message);
      }

      // Fire-and-forget analyze — identical dispatch shape to /sync and /reanalyze.
      (async function() {
        try {
          var analyzeCall = worker.analyzeCall;
          for (var i = 0; i < ids.length; i++) {
            try {
              await analyzeCall(ids[i], userId);
            } catch (innerErr) {
              console.error('[fathom] update-analyses analyzeCall failed for call ' + ids[i] + ' (user=' + userId + '): ' + (innerErr.message || 'unknown'));
            }
          }
        } catch (outerErr) {
          console.error('[fathom] update-analyses background loop error (user=' + userId + '): ' + (outerErr.message || 'unknown'));
        }
      })();
    }

    console.log('[fathom] Update-analyses queued for user ' + userId + ': queued=' + ids.length + ' remaining=' + (unionIds.length - ids.length) + ' (outdated=' + outdatedIds.length + ', pending=' + pendingIds2.length + ', batch_limit=' + limit + ')');
    return res.json({ queued: ids.length, remaining: unionIds.length - ids.length, batch_limit: limit });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] update-analyses fatal for user ' + userId + ':', err.message);
    res.status(500).json({ error: 'Update analyses failed' });
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
// Every DONE analysis for this user graded on a version OTHER than the current
// one (NULL prompt_version counts as outdated). Returned most-recent-analyzed
// first as fathom_calls UUIDs (call_analyses.fathom_call_id === fathom_calls.id).
//
// Definition change (was: join fathom_calls.sync_status='processed'): the count
// is now based PURELY on call_analyses.status='done'. Held calls carry
// status='synced_unanalyzed', so they're excluded naturally — no sync_status join
// is needed to protect the holdback. The old 'processed' join UNDER-counted: a
// call reset to fathom_calls.sync_status='pending' (or left 'error') by a prior
// "Update analyses" whose re-analysis was interrupted (deploy-race) still had a
// done+old analysis row, but escaped the 'processed' filter. Now N == exactly
// "all done analyses where prompt_version != CURRENT". Paginated to dodge the
// supabase-js 1000-row cap.
async function outdatedCallIds(admin, userId, currentVersion) {
  var out = [];
  var PAGE = 1000;
  var offset = 0;
  while (true) {
    var q = await admin
      .from('call_analyses')
      .select('fathom_call_id, prompt_version')
      .eq('user_id', userId)
      .eq('status', 'done')
      .order('analyzed_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (q.error) throw new Error('call_analyses: ' + q.error.message);
    var rows = q.data || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].prompt_version !== currentVersion) out.push(rows[i].fathom_call_id);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

router.get('/status', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var admin = getAdminClient();

    var connPromise = admin
      .from('fathom_connections')
      .select('connected_at, last_sync_at, last_sync_status, last_sync_error, scope, expires_at, fathom_email')
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

    // Outdated-analyses count — drives the "Update analyses (N outdated)" button
    // that appears when there's nothing pending but calls were graded under an
    // older prompt version. Non-fatal: on error, report 0 (button stays hidden).
    var currentVersion = require('../lib/analysis-worker').ANALYSIS_PROMPT_VERSION;
    var outdatedCount = 0;
    try {
      outdatedCount = (await outdatedCallIds(admin, userId, currentVersion)).length;
    } catch (outdatedErr) {
      console.error('[fathom] status outdated-count failed for user ' + userId + ': ' + outdatedErr.message);
    }

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
      fathom_email:     c.fathom_email || null,
      connected_at:     c.connected_at,
      last_sync_at:     c.last_sync_at,
      last_sync_status: c.last_sync_status,
      last_sync_error:  c.last_sync_error,
      scope:            c.scope,
      expires_at:       c.expires_at,
      call_count:       (typeof countResult.count === 'number') ? countResult.count : 0,
      pending_count:    (typeof pendingCountResult.count === 'number') ? pendingCountResult.count : 0,
      outdated_count:   outdatedCount,
      prompt_version:   currentVersion,
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
// Parse the shared /calls query options (used by /fathom/calls and the admin
// mirror). filter=analyzed|objections restricts to calls with a done analysis /
// with ≥1 objection highlight (powers the donut drill-downs). sort=score orders
// worst-first. from/to window on call_date so a drill matches its donut's count.
function parseCallListOpts(req) {
  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  var offset = parseInt(req.query.offset, 10);
  if (!offset || offset < 0) offset = 0;
  var filter = (req.query.filter === 'analyzed' || req.query.filter === 'objections') ? req.query.filter : null;
  var sort = (req.query.sort === 'score') ? 'score' : null;
  var from = (req.query.from && !isNaN(Date.parse(req.query.from))) ? req.query.from : null;
  var to = (req.query.to && !isNaN(Date.parse(req.query.to))) ? req.query.to : null;
  return { limit: limit, offset: offset, filter: filter, sort: sort, from: from, to: to };
}

// Distinct fathom_call ids for a user from a child table, optionally refined.
// Paginated so the 1000-row cap can't truncate. Returns a plain-object id set.
async function distinctChildCallIds(admin, table, userId, refine) {
  var ids = {};
  var PAGE = 1000, start = 0;
  while (true) {
    var qb = admin.from(table).select('fathom_call_id').eq('user_id', userId).range(start, start + PAGE - 1);
    if (refine) qb = refine(qb);
    var r = await qb;
    if (r.error) throw new Error(table + ': ' + r.error.message);
    var batch = r.data || [];
    for (var i = 0; i < batch.length; i++) ids[batch[i].fathom_call_id] = true;
    if (batch.length < PAGE) break;
    start += PAGE;
  }
  return ids;
}

// Shared call-list loader (self + admin pivot). Returns { calls, limit, offset }.
async function loadCallsList(admin, userId, opts) {
  var restrict = null;
  if (opts.filter === 'objections') {
    restrict = await distinctChildCallIds(admin, 'call_highlights', userId, function(q) { return q.eq('type', 'objection'); });
  } else if (opts.filter === 'analyzed') {
    restrict = await distinctChildCallIds(admin, 'call_analyses', userId, function(q) { return q.eq('status', 'done'); });
  }
  if (restrict && Object.keys(restrict).length === 0) {
    return { calls: [], limit: opts.limit, offset: opts.offset };
  }

  // When restricting or sorting-by-score we need the candidate set in memory
  // (bounded per user) to filter/sort then paginate in JS; otherwise page in DB.
  var needFullSet = !!restrict || opts.sort === 'score';
  var q = admin
    .from('fathom_calls')
    .select('id, fathom_call_id, title, call_date, duration_seconds, recording_url, sync_status')
    .eq('user_id', userId)
    .order('call_date', { ascending: false, nullsFirst: false });
  if (opts.from) q = q.gte('call_date', opts.from);
  if (opts.to)   q = q.lte('call_date', opts.to);
  q = needFullSet ? q.range(0, 9999) : q.range(opts.offset, opts.offset + opts.limit - 1);
  var callsResult = await q;
  if (callsResult.error) throw new Error('fathom_calls: ' + callsResult.error.message);
  var calls = callsResult.data || [];
  if (restrict) calls = calls.filter(function(c) { return restrict[c.id]; });
  if (calls.length === 0) return { calls: [], limit: opts.limit, offset: opts.offset };

  // Enrich with analyses (chunked .in — cap-safe).
  var ids = calls.map(function(c) { return c.id; });
  var analysisByCallId = {};
  for (var c = 0; c < ids.length; c += 100) {
    var ar = await admin
      .from('call_analyses')
      .select('fathom_call_id, status, overall_score, overall_summary, outcome, outcome_source')
      .in('fathom_call_id', ids.slice(c, c + 100));
    if (!ar.error) (ar.data || []).forEach(function(a) { analysisByCallId[a.fathom_call_id] = a; });
  }
  var enriched = calls.map(function(cc) {
    var a = analysisByCallId[cc.id] || null;
    return {
      id: cc.id, fathom_call_id: cc.fathom_call_id, title: cc.title, call_date: cc.call_date,
      duration_seconds: cc.duration_seconds, recording_url: cc.recording_url, sync_status: cc.sync_status,
      analysis_status: a ? a.status : null, overall_score: a ? a.overall_score : null, overall_summary: a ? a.overall_summary : null,
      outcome: a ? a.outcome : null, outcome_source: a ? a.outcome_source : null,
    };
  });

  if (opts.sort === 'score') {
    enriched.sort(function(x, y) {
      var xs = (typeof x.overall_score === 'number') ? x.overall_score : Infinity; // nulls last
      var ys = (typeof y.overall_score === 'number') ? y.overall_score : Infinity;
      return xs - ys; // worst-first
    });
  }
  if (needFullSet) enriched = enriched.slice(opts.offset, opts.offset + opts.limit);
  return { calls: enriched, limit: opts.limit, offset: opts.offset };
}

router.get('/calls', requireAuth, async function(req, res) {
  var userId = req.user.id;
  try {
    var result = await loadCallsList(getAdminClient(), userId, parseCallListOpts(req));
    res.json(result);
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
      .select('status, overall_score, overall_summary, one_thing, outcome, outcome_source, why_outcome, why_quote, why_timestamp_seconds, one_thing_timestamp_seconds, follow_up_email, speaker_closer_name, intro_grade, intro_score, intro_notes, discovery_grade, discovery_score, discovery_notes, pitch_grade, pitch_score, pitch_notes, objection_grade, objection_score, objection_notes, close_grade, close_score, close_notes')
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
router._loadCallsList       = loadCallsList;      // shared with /admin/fathom-calls/:user_id
router._parseCallListOpts   = parseCallListOpts;

// ── DELETE /fathom/disconnect ────────────────────────────────────────────────
// Deletes the caller's OWN Fathom connection (stops syncing new calls). NEVER
// touches fathom_calls / call_analyses / call_highlights — history stays.
// Idempotent: succeeds whether or not a row existed.
router.delete('/disconnect', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var del = await admin.from('fathom_connections').delete().eq('user_id', req.user.id);
    if (del.error) throw new Error('fathom_connections delete: ' + del.error.message);
    console.log('[fathom] disconnected user ' + req.user.id + ' (history preserved)');
    res.json({ ok: true });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[fathom] disconnect error:', err.message);
    res.status(500).json({ error: 'Could not disconnect Fathom' });
  }
});

module.exports = router;
// pure helper exported for tests (log.js:_validateLogBatch pattern)
module.exports._orderBatchIds = orderBatchIds;
module.exports._pickNewestForAnalysis = pickNewestForAnalysis;
module.exports._FIRST_SYNC_ANALYZE_CAP = FIRST_SYNC_ANALYZE_CAP;
