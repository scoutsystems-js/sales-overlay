// Public self-signup is CLOSED (2026-07-31). Scout is invite-only; FD-2 hid the
// Sign Up tab but left POST /auth/signup provisioning accounts (contradicting
// invite-only, and an orphan source). This locks in that the endpoint rejects and
// NEVER provisions. Accounts come only from the admin create flow.
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../routes/auth');

function fakeRes() {
  return {
    _status: null, _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}

test('POST /auth/signup is disabled — 403 invite-only', () => {
  assert.strictEqual(typeof auth._signupDisabled, 'function');
  const res = fakeRes();
  auth._signupDisabled({ body: { email: 'x@y.com', password: 'someLongPassword' } }, res);
  assert.strictEqual(res._status, 403);
  assert.match(res._body.error, /invite-only/i);
});

test('never provisions — short-circuits before any Supabase call (no env needed)', () => {
  // The test process has no SUPABASE_* env. If the handler tried to provision it
  // would throw a config error; a clean 403 proves it never touches Supabase.
  const res = fakeRes();
  auth._signupDisabled({ body: {} }, res);
  assert.strictEqual(res._status, 403);
});
