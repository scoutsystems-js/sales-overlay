// Zoom client — sub-stage 1: OAuth token exchange + refresh (native fetch).
// Zoom user-managed OAuth: token endpoint uses HTTP Basic auth
// (client_id:client_secret) with an application/x-www-form-urlencoded body.
// Access tokens live 1h; refresh tokens ROTATE on every refresh (like Fathom)
// — the caller MUST persist the new refresh_token in the same write.
//
// Env: ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI. Feature stays
// dark until client id/secret are present (env-gating, same as welcome-email).
// No credential or token is ever logged here.

const ZOOM_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
const ZOOM_TOKEN_URL     = 'https://zoom.us/oauth/token';
const ZOOM_API_BASE      = 'https://api.zoom.us/v2';
const DURATION_SANITY_SECONDS = 28800; // 8h — same corrupt-value guard as Fathom's meetingToRow

function isConfigured(env) {
  var e = env || process.env;
  return !!(e.ZOOM_CLIENT_ID && String(e.ZOOM_CLIENT_ID).trim()
         && e.ZOOM_CLIENT_SECRET && String(e.ZOOM_CLIENT_SECRET).trim());
}

// Zoom does NOT take a scope param in the authorize URL — scopes are fixed in
// the Marketplace app config. Only response_type/client_id/redirect_uri/state.
function buildAuthorizeUrl(clientId, redirectUri, state) {
  var u = new URL(ZOOM_AUTHORIZE_URL);
  u.searchParams.append('response_type', 'code');
  u.searchParams.append('client_id', clientId);
  u.searchParams.append('redirect_uri', redirectUri);
  u.searchParams.append('state', state);
  return u.toString();
}

function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
}

function validateTokenResponse(d) {
  return !!(d && typeof d.access_token === 'string'
            && typeof d.refresh_token === 'string'
            && typeof d.expires_in === 'number');
}

// POST the token endpoint. grantParams differ for code-exchange vs refresh.
// Returns { access_token, refresh_token, expires_in, scope } or throws with a
// message that NEVER contains the code/token (only HTTP status + a short,
// non-secret upstream snippet).
async function tokenRequest(grantParams) {
  if (!isConfigured()) throw new Error('Zoom not configured — missing ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET');
  var resp = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(process.env.ZOOM_CLIENT_ID, process.env.ZOOM_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(grantParams),
  });
  if (!resp.ok) {
    var reason = '';
    try { var b = await resp.json(); reason = (b && (b.reason || b.error)) ? ' — ' + String(b.reason || b.error).slice(0, 80) : ''; } catch (e) {}
    throw new Error('Zoom token endpoint HTTP ' + resp.status + reason);
  }
  var data = await resp.json();
  if (!validateTokenResponse(data)) throw new Error('Zoom token response missing required fields');
  return data;
}

function exchangeCode(code, redirectUri) {
  return tokenRequest({ grant_type: 'authorization_code', code: code, redirect_uri: redirectUri });
}

function refreshTokens(refreshToken) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

// ─── Sub-stage 2: recordings sync + transcript fetch ─────────────────────────

// Map a Zoom "recordings list" meeting object → a fathom_calls row (source='zoom').
// The Zoom instance UUID is the stable per-recording key → fathom_call_id. Zoom's
// `duration` is in MINUTES; we store seconds and null out corrupt/absurd values
// (same 8h sanity cap as Fathom). Returns null when there's no UUID to key on.
// PURE — no I/O.
function zoomRecordingToRow(userId, m) {
  if (!m || typeof m.uuid !== 'string' || !m.uuid) return null;
  var durationSeconds = null;
  if (typeof m.duration === 'number' && m.duration >= 0) {
    var secs = Math.floor(m.duration * 60);
    durationSeconds = (secs > DURATION_SANITY_SECONDS) ? null : secs;
  }
  return {
    user_id:          userId,
    fathom_call_id:   String(m.uuid),   // Zoom instance UUID (double-encoded when re-fetched)
    /* ⚠ THE NUMERIC MEETING ID, kept ALONGSIDE the uuid — they are different
       identifiers and both are needed. The uuid is per-INSTANCE and is what the
       recordings API is re-queried by; the numeric id is what a CALENDAR INVITE's
       join URL contains, so it is the only thing an event can be joined on.
       ⚠ It is REUSED across a recurring series and across every use of a personal
       meeting room, so any join must key on meeting_id + DATE, never id alone. */
    meeting_id:       (m.id === 0 || m.id) ? String(m.id) : null,
    source:           'zoom',
    title:            (m.topic && String(m.topic).trim()) || null,
    recording_url:    (typeof m.share_url === 'string' && m.share_url)
                        || (typeof m.play_url === 'string' && m.play_url) || null,
    transcript_url:   null,             // Zoom transcript re-fetched at analyze time, not stored
    duration_seconds: durationSeconds,
    call_date:        m.start_time || null,
    sync_status:      'pending',
  };
}

// Find the transcript (WebVTT) file among a meeting's recording_files. Zoom marks
// it file_type='TRANSCRIPT' / recording_type='audio_transcript'. Returns the file
// object or null (null = transcript not produced yet, or free plan / no cloud
// recording). PURE.
function pickTranscriptFile(recordingFiles) {
  if (!Array.isArray(recordingFiles)) return null;
  for (var i = 0; i < recordingFiles.length; i++) {
    var f = recordingFiles[i];
    if (!f) continue;
    if (f.file_type === 'TRANSCRIPT' || f.recording_type === 'audio_transcript') return f;
  }
  return null;
}

// Zoom meeting UUIDs may contain '/' or '//' or start with '/'. Per Zoom's API
// rules such a UUID must be DOUBLE URL-encoded before being placed in a path
// segment; a plain UUID is single-encoded. PURE.
function encodeMeetingUuid(uuid) {
  var s = String(uuid);
  if (s.indexOf('/') !== -1) return encodeURIComponent(encodeURIComponent(s));
  return encodeURIComponent(s);
}

// Shared Bearer GET → parsed JSON. Throws with an HTTP-status message that never
// contains the token (only a short, non-secret upstream snippet).
async function apiGet(accessToken, url) {
  var resp = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' },
  });
  if (!resp.ok) {
    var reason = '';
    try { reason = (await resp.text()).slice(0, 160); } catch (e) {}
    throw new Error('Zoom API HTTP ' + resp.status + (reason ? ' — ' + reason : ''));
  }
  try { return await resp.json(); }
  catch (e) { throw new Error('Zoom API invalid JSON response'); }
}

// GET /users/me/recordings — one page of the caller's cloud recordings. opts:
// { from, to (YYYY-MM-DD), pageSize (<=300), nextPageToken }. Zoom caps the
// from→to span at ~1 month per request and defaults to the last month when
// `from` is omitted (steady-state 2h cron covers this; full-history backfill is
// a later refinement). Returns the parsed body { meetings, next_page_token, ... }.
async function listRecordings(accessToken, opts) {
  opts = opts || {};
  var url = new URL(ZOOM_API_BASE + '/users/me/recordings');
  url.searchParams.append('page_size', String(opts.pageSize || 100));
  if (opts.from)          url.searchParams.append('from', opts.from);
  if (opts.to)            url.searchParams.append('to', opts.to);
  if (opts.nextPageToken) url.searchParams.append('next_page_token', opts.nextPageToken);
  var data = await apiGet(accessToken, url.toString());
  if (!data || !Array.isArray(data.meetings)) throw new Error('Zoom recordings response missing meetings array');
  return data;
}

// GET /meetings/{uuid}/recordings — one meeting's recording files (fresh
// download URLs). Used at analyze time to locate + download the transcript.
async function getMeetingRecordings(accessToken, meetingUuid) {
  var url = ZOOM_API_BASE + '/meetings/' + encodeMeetingUuid(meetingUuid) + '/recordings';
  return await apiGet(accessToken, url);
}

// Download a recording file's content (the transcript VTT) as text. Bearer auth
// on the download_url (OAuth apps). Returns the raw VTT string.
async function downloadFile(accessToken, downloadUrl) {
  var resp = await fetch(downloadUrl, { method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken } });
  if (!resp.ok) {
    var reason = '';
    try { reason = (await resp.text()).slice(0, 160); } catch (e) {}
    throw new Error('Zoom transcript download HTTP ' + resp.status + (reason ? ' — ' + reason : ''));
  }
  return await resp.text();
}

// Orchestration used by the analysis worker's Zoom branch: fetch the meeting's
// recording files → find the transcript → download it → return the VTT string.
// Throws 'zoom_no_transcript' when the meeting has no transcript file yet (e.g.
// transcript_completed hasn't fired, or the account/plan produced none) — a
// recoverable state the worker surfaces as an error the user can retry.
async function fetchTranscriptVtt(accessToken, meetingUuid) {
  var rec = await getMeetingRecordings(accessToken, meetingUuid);
  var file = pickTranscriptFile(rec && rec.recording_files);
  if (!file || !file.download_url) throw new Error('zoom_no_transcript: no transcript file for meeting ' + meetingUuid);
  return await downloadFile(accessToken, file.download_url);
}

module.exports = {
  isConfigured: isConfigured,
  buildAuthorizeUrl: buildAuthorizeUrl,
  exchangeCode: exchangeCode,
  refreshTokens: refreshTokens,
  ZOOM_TOKEN_URL: ZOOM_TOKEN_URL,
  ZOOM_API_BASE: ZOOM_API_BASE,
  // sub-stage 2 sync surface
  zoomRecordingToRow: zoomRecordingToRow,
  pickTranscriptFile: pickTranscriptFile,
  encodeMeetingUuid: encodeMeetingUuid,
  listRecordings: listRecordings,
  getMeetingRecordings: getMeetingRecordings,
  downloadFile: downloadFile,
  fetchTranscriptVtt: fetchTranscriptVtt,
  // test surface
  _isConfigured: isConfigured,
  _buildAuthorizeUrl: buildAuthorizeUrl,
  _basicAuthHeader: basicAuthHeader,
  _validateTokenResponse: validateTokenResponse,
};
