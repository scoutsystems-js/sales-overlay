// linkTargetsSetPassword — the loud-fail guard shared by the invite mint
// (admin.js) and the password-reset mint (auth.js). GoTrue silently swaps in the
// project Site URL when redirect_to isn't allowlisted, so a minted recovery link
// that does NOT point at /set-password is a dud and must NEVER be emailed.
//
// ROOT CAUSE of the 2026-07-31 reset failure encoded here: GoTrue leaves
// redirect_to UNENCODED for a bare path but PERCENT-ENCODES it once it carries a
// query/fragment (?flow=reset). A naive substring on the raw action_link then
// misses `%2Fset-password` and false-negatives a perfectly valid reset link. The
// guard must decode redirect_to and check its path.
const test = require('node:test');
const assert = require('node:assert');
const { linkTargetsSetPassword } = require('../lib/recovery-link');

const VERIFY = 'https://x.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=';

test('accepts the invite form — redirect_to unencoded (bare /set-password)', () => {
  assert.strictEqual(linkTargetsSetPassword(VERIFY + 'https://www.scoutsystems.io/set-password'), true);
});

// The regression: real action_link when redirect_to carries ?flow=reset — the
// whole value is percent-encoded (/set-password -> %2Fset-password).
test('accepts the reset form — redirect_to PERCENT-ENCODED (?flow=reset)', () => {
  assert.strictEqual(
    linkTargetsSetPassword(VERIFY + 'https%3A%2F%2Fwww.scoutsystems.io%2Fset-password%3Fflow%3Dreset'),
    true
  );
});

test('accepts an encoded fragment form (#flow=reset)', () => {
  assert.strictEqual(
    linkTargetsSetPassword(VERIFY + 'https%3A%2F%2Fwww.scoutsystems.io%2Fset-password%23flow%3Dreset'),
    true
  );
});

test('still accepts a plain landing URL that literally contains /set-password', () => {
  assert.strictEqual(linkTargetsSetPassword('https://www.scoutsystems.io/set-password?flow=reset#access_token=x'), true);
});

test('rejects a Site-URL fallback dud — encoded and unencoded root', () => {
  assert.strictEqual(linkTargetsSetPassword(VERIFY + 'https%3A%2F%2Fwww.scoutsystems.io%2F'), false); // encoded site root
  assert.strictEqual(linkTargetsSetPassword(VERIFY + 'https://www.scoutsystems.io/'), false);          // unencoded site root
  assert.strictEqual(linkTargetsSetPassword('https://www.scoutsystems.io/'), false);
  assert.strictEqual(linkTargetsSetPassword('http://localhost:3000/?token=x'), false);
});

test('rejects null / undefined / non-string / empty', () => {
  assert.strictEqual(linkTargetsSetPassword(null), false);
  assert.strictEqual(linkTargetsSetPassword(undefined), false);
  assert.strictEqual(linkTargetsSetPassword(''), false);
  assert.strictEqual(linkTargetsSetPassword(42), false);
  assert.strictEqual(linkTargetsSetPassword({}), false);
});
