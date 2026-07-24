// Zoom deauthorization endpoint — pure verification + targeting (sub-stage prep).
// Zoom POSTs {event:'app_deauthorized', payload:{user_id,account_id,...}} to the
// app's Deauthorization Notification Endpoint, authenticated by the app Secret/
// Verification Token; and validates the endpoint with an endpoint.url_validation
// challenge (respond with HMAC-SHA256 of plainToken). We delete the Zoom
// connection row(s) matching payload.user_id — tokens die, history stays.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const z = require('../routes/zoom');

const SECRET = 'zoomSecretToken_ABC123';

test('urlValidationResponse: HMAC-SHA256(plainToken, secret) hex', () => {
  const out = z._deauthUrlValidation('plain-xyz', SECRET);
  const expected = crypto.createHmac('sha256', SECRET).update('plain-xyz').digest('hex');
  assert.deepStrictEqual(out, { plainToken: 'plain-xyz', encryptedToken: expected });
});

test('verifyToken: timing-safe match of the Authorization header to the secret', () => {
  assert.strictEqual(z._deauthVerifyToken(SECRET, SECRET), true);
  assert.strictEqual(z._deauthVerifyToken('Bearer ' + SECRET, SECRET), true); // tolerate Bearer prefix
  assert.strictEqual(z._deauthVerifyToken('wrong', SECRET), false);
  assert.strictEqual(z._deauthVerifyToken('', SECRET), false);
  assert.strictEqual(z._deauthVerifyToken(SECRET, ''), false);
  assert.strictEqual(z._deauthVerifyToken(undefined, SECRET), false);
});

test('targetZoomUserId: pulls payload.user_id only for app_deauthorized', () => {
  assert.strictEqual(z._deauthTargetZoomUserId({ event: 'app_deauthorized', payload: { user_id: 'zU1', account_id: 'A1' } }), 'zU1');
  assert.strictEqual(z._deauthTargetZoomUserId({ event: 'app_deauthorized', payload: {} }), null);
  assert.strictEqual(z._deauthTargetZoomUserId({ event: 'something_else', payload: { user_id: 'zU1' } }), null);
  assert.strictEqual(z._deauthTargetZoomUserId({}), null);
  assert.strictEqual(z._deauthTargetZoomUserId(null), null);
});

test('isUrlValidation: recognizes the challenge event', () => {
  assert.strictEqual(z._deauthIsUrlValidation({ event: 'endpoint.url_validation', payload: { plainToken: 'x' } }), true);
  assert.strictEqual(z._deauthIsUrlValidation({ event: 'app_deauthorized', payload: {} }), false);
  assert.strictEqual(z._deauthIsUrlValidation({}), false);
});
