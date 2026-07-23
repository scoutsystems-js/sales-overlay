// Zoom sub-stage 1 tests: OAuth token-response validation + authorize-URL
// construction (pure), and the call-connections refresh DECISION (pure — when
// is an access token stale enough to refresh). No network.
const test = require('node:test');
const assert = require('node:assert');
const zoom = require('../lib/zoom-client');
const cc = require('../lib/call-connections');

test('isConfigured: needs ZOOM_CLIENT_ID + ZOOM_CLIENT_SECRET', () => {
  assert.strictEqual(zoom._isConfigured({ ZOOM_CLIENT_ID: 'a', ZOOM_CLIENT_SECRET: 'b' }), true);
  assert.strictEqual(zoom._isConfigured({ ZOOM_CLIENT_ID: 'a' }), false);
  assert.strictEqual(zoom._isConfigured({ ZOOM_CLIENT_ID: '  ', ZOOM_CLIENT_SECRET: 'b' }), false);
  assert.strictEqual(zoom._isConfigured({}), false);
});

test('buildAuthorizeUrl: Zoom authorize URL — response_type=code, client_id, redirect_uri, state; NO scope param (Zoom scopes come from app config)', () => {
  const u = new URL(zoom._buildAuthorizeUrl('cid-123', 'https://www.scoutsystems.io/auth/zoom/callback', 'STATE.TOK'));
  assert.strictEqual(u.origin + u.pathname, 'https://zoom.us/oauth/authorize');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('client_id'), 'cid-123');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://www.scoutsystems.io/auth/zoom/callback');
  assert.strictEqual(u.searchParams.get('state'), 'STATE.TOK');
  assert.strictEqual(u.searchParams.get('scope'), null);
});

test('basicAuthHeader: base64(client_id:client_secret)', () => {
  assert.strictEqual(zoom._basicAuthHeader('id', 'secret'),
    'Basic ' + Buffer.from('id:secret').toString('base64'));
});

test('validateTokenResponse: requires access_token, refresh_token, numeric expires_in', () => {
  const f = zoom._validateTokenResponse;
  assert.ok(f({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
  assert.strictEqual(f({ access_token: 'a', refresh_token: 'r' }), false);      // no expires_in
  assert.strictEqual(f({ access_token: 'a', expires_in: 3600 }), false);        // no refresh (Zoom rotates — required)
  assert.strictEqual(f({ refresh_token: 'r', expires_in: 3600 }), false);
  assert.strictEqual(f(null), false);
  assert.strictEqual(f({ access_token: 'a', refresh_token: 'r', expires_in: '3600' }), false); // string
});

test('needsRefresh: refresh when expires_at is null, past, or within the tolerance window', () => {
  const now = 1_700_000_000_000; // fixed ms
  const iso = (msFromNow) => new Date(now + msFromNow).toISOString();
  assert.strictEqual(cc._needsRefresh(null, now), true, 'null = always refresh');
  assert.strictEqual(cc._needsRefresh(iso(-60_000), now), true, 'already expired');
  assert.strictEqual(cc._needsRefresh(iso(60_000), now), true, 'inside the 5-min tolerance');
  assert.strictEqual(cc._needsRefresh(iso(600_000), now), false, '10 min out = fresh');
});
