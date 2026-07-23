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

module.exports = {
  isConfigured: isConfigured,
  buildAuthorizeUrl: buildAuthorizeUrl,
  exchangeCode: exchangeCode,
  refreshTokens: refreshTokens,
  ZOOM_TOKEN_URL: ZOOM_TOKEN_URL,
  // test surface
  _isConfigured: isConfigured,
  _buildAuthorizeUrl: buildAuthorizeUrl,
  _basicAuthHeader: basicAuthHeader,
  _validateTokenResponse: validateTokenResponse,
};
