const test = require('node:test');
const assert = require('node:assert/strict');
const { issuedAt, requiresSessionReset } = require('../lib/session-reset');

function token(payload) {
  return 'header.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.signature';
}

function controls(cutoff) {
  return {
    from: function () {
      return {
        select: function () { return this; },
        eq: function () { return this; },
        maybeSingle: async function () { return { data: { minimum_session_issued_at: cutoff }, error: null }; },
      };
    },
  };
}

test('reads a JWT issued-at value without trusting an unverified token', function () {
  assert.equal(issuedAt(token({ iat: 1234 })), 1234000);
  assert.equal(issuedAt('not-a-token'), null);
});

test('requires a new session when the access token predates the cutoff', async function () {
  const cutoff = '2026-09-13T20:00:00.000Z';
  const cutoffSeconds = Math.floor(Date.parse(cutoff) / 1000);
  assert.equal(await requiresSessionReset(controls(cutoff), token({ iat: cutoffSeconds - 1 })), true);
  assert.equal(await requiresSessionReset(controls(cutoff), token({ iat: cutoffSeconds + 1 })), false);
  assert.equal(await requiresSessionReset(controls(cutoff), null), true);
});
