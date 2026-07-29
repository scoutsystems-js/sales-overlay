// linkTargetsSetPassword — the loud-fail guard shared by the invite mint
// (admin.js) and the password-reset mint (auth.js). GoTrue silently swaps in the
// project Site URL when redirect_to isn't allowlisted, so a minted recovery link
// that does NOT point at /set-password is a dud and must NEVER be emailed.
// This guard is the single contract both mint paths assert against.
const test = require('node:test');
const assert = require('node:assert');
const { linkTargetsSetPassword } = require('../lib/recovery-link');

test('accepts a link containing /set-password (invite form, no query)', () => {
  assert.strictEqual(
    linkTargetsSetPassword('https://x.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https://www.scoutsystems.io/set-password'),
    true
  );
});

test('accepts the reset form with ?flow=reset', () => {
  assert.strictEqual(
    linkTargetsSetPassword('https://www.scoutsystems.io/set-password?flow=reset#access_token=x'),
    true
  );
});

test('rejects a dud that fell back to the Site URL root', () => {
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
