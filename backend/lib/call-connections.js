// Unified per-provider OAuth token store (migration 024). Sub-stage 1 wires
// ZOOM through this; Fathom keeps its own fathom_connections path until the
// deferred cutover. One accessor so both providers share refresh discipline:
// read the row, refresh if the access token is stale, PERSIST the rotated
// refresh_token in the same write, return a valid access token.
//
// Provider refreshers are injected (zoom-client for 'zoom') so this module
// stays free of provider HTTP details and easily testable. No token is logged.

const TOKEN_EXPIRY_TOLERANCE_MS = 5 * 60 * 1000; // refresh if <5 min of life left

// Pure: should we refresh given the stored expires_at (ISO string|null)?
// null → always refresh (unknown expiry); past or within tolerance → refresh.
function needsRefresh(expiresAtIso, nowMs) {
  if (!expiresAtIso) return true;
  var exp = new Date(expiresAtIso).getTime();
  if (isNaN(exp)) return true;
  return exp - nowMs <= TOKEN_EXPIRY_TOLERANCE_MS;
}

async function getConnection(admin, userId, provider) {
  var q = await admin.from('call_connections')
    .select('user_id, provider, access_token, refresh_token, expires_at, scope, external_account_email')
    .eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (q.error) throw new Error('call_connections fetch: ' + q.error.message);
  return q.data || null;
}

// Refreshers keyed by provider: (refreshToken) => { access_token, refresh_token, expires_in }.
var REFRESHERS = {
  zoom: function (refreshToken) { return require('./zoom-client').refreshTokens(refreshToken); },
};

// Returns a valid access token for (user, provider), refreshing + persisting
// the rotated refresh_token when stale. Throws if no connection exists or the
// refresh fails (caller decides how to surface — mirrors Fathom's behavior).
async function getValidAccessToken(admin, userId, provider, conn) {
  conn = conn || await getConnection(admin, userId, provider);
  if (!conn) throw new Error(provider + ' connection not found for user ' + userId);
  if (!needsRefresh(conn.expires_at, Date.now())) return conn.access_token;

  var refresher = REFRESHERS[provider];
  if (!refresher) throw new Error('No refresher for provider ' + provider);
  var data = await refresher(conn.refresh_token);

  var nowSec = Math.floor(Date.now() / 1000);
  var expiresAt = new Date((nowSec + data.expires_in - 300) * 1000).toISOString(); // 5-min safety margin
  var upd = await admin.from('call_connections').update({
    access_token:  data.access_token,
    refresh_token: data.refresh_token, // ROTATED — persist in the same write or the connection bricks
    expires_at:    expiresAt,
    scope:         data.scope || conn.scope || null,
    updated_at:    new Date().toISOString(),
  }).eq('user_id', userId).eq('provider', provider);
  if (upd.error) throw new Error('call_connections token persist: ' + upd.error.message);
  return data.access_token;
}

async function upsertConnection(admin, row) {
  var up = await admin.from('call_connections')
    .upsert(Object.assign({ updated_at: new Date().toISOString() }, row), { onConflict: 'user_id,provider' });
  if (up.error) throw new Error('call_connections upsert: ' + up.error.message);
  return true;
}

module.exports = {
  getConnection: getConnection,
  getValidAccessToken: getValidAccessToken,
  upsertConnection: upsertConnection,
  _needsRefresh: needsRefresh,
};
