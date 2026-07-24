// Serialized single-flight token refresh (sub-stage 2 design ruling): Zoom's
// single-use rotating refresh tokens mean two concurrent refreshes for the
// same connection BRICK it. getValidAccessToken must (a) join an in-flight
// refresh instead of starting a second, and (b) double-check the row inside
// the critical section so a just-completed refresh isn't repeated.
const test = require('node:test');
const assert = require('node:assert');
const cc = require('../lib/call-connections');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const tick = () => new Promise(r => setTimeout(r, 20));

// Fake admin over a single mutable row; supports getConnection's
// select().eq().eq().maybeSingle() and update().eq().eq().
function fakeAdmin(row) {
  return {
    from() {
      return {
        select() { return { eq() { return { eq() { return { maybeSingle: async () => ({ data: row ? Object.assign({}, row) : null, error: null }) }; } }; } }; },
        update(patch) { if (row) Object.assign(row, patch); return { eq() { return { eq: async () => ({ error: null }) }; } }; },
      };
    },
  };
}

test('single-flight: concurrent refreshes fire the refresher exactly ONCE', async () => {
  const row = { user_id: 'u1', provider: 'zoom', access_token: 'OLD', refresh_token: 'R0', expires_at: PAST };
  let calls = 0;
  cc._setRefresher('zoom', async () => { calls++; await tick(); return { access_token: 'NEW' + calls, refresh_token: 'R' + calls, expires_in: 3600 }; });
  const admin = fakeAdmin(row);
  try {
    const [a, b, c] = await Promise.all([
      cc.getValidAccessToken(admin, 'u1', 'zoom'),
      cc.getValidAccessToken(admin, 'u1', 'zoom'),
      cc.getValidAccessToken(admin, 'u1', 'zoom'),
    ]);
    assert.strictEqual(calls, 1, 'refresher must be called once, not per concurrent caller');
    assert.strictEqual(a, 'NEW1'); assert.strictEqual(b, 'NEW1'); assert.strictEqual(c, 'NEW1');
    assert.strictEqual(row.access_token, 'NEW1', 'rotation persisted');
    assert.strictEqual(row.refresh_token, 'R1', 'rotated refresh_token persisted');
  } finally { cc._setRefresher('zoom', null); }
});

test('no refresh when the token is still fresh', async () => {
  const row = { user_id: 'u2', provider: 'zoom', access_token: 'FRESH', refresh_token: 'R', expires_at: FUTURE };
  cc._setRefresher('zoom', async () => { throw new Error('must not refresh a fresh token'); });
  try {
    const at = await cc.getValidAccessToken(fakeAdmin(row), 'u2', 'zoom');
    assert.strictEqual(at, 'FRESH');
  } finally { cc._setRefresher('zoom', null); }
});

test('double-check: a stale passed-in conn does NOT re-refresh when the row is already fresh', async () => {
  const row = { user_id: 'u3', provider: 'zoom', access_token: 'ALREADY_FRESH', refresh_token: 'R', expires_at: FUTURE };
  const staleConn = { user_id: 'u3', provider: 'zoom', access_token: 'OLD', refresh_token: 'R', expires_at: PAST };
  cc._setRefresher('zoom', async () => { throw new Error('must not refresh — row already fresh'); });
  try {
    const at = await cc.getValidAccessToken(fakeAdmin(row), 'u3', 'zoom', staleConn);
    assert.strictEqual(at, 'ALREADY_FRESH', 'must use the row the critical section re-read, not the stale conn');
  } finally { cc._setRefresher('zoom', null); }
});

test('in-flight entry clears after completion — a later stale call refreshes again', async () => {
  const row = { user_id: 'u4', provider: 'zoom', access_token: 'OLD', refresh_token: 'R0', expires_at: PAST };
  let calls = 0;
  cc._setRefresher('zoom', async () => { calls++; return { access_token: 'A' + calls, refresh_token: 'R' + calls, expires_in: 3600 }; });
  const admin = fakeAdmin(row);
  try {
    await cc.getValidAccessToken(admin, 'u4', 'zoom');
    row.expires_at = PAST; // force stale again for a second, separate call
    await cc.getValidAccessToken(admin, 'u4', 'zoom');
    assert.strictEqual(calls, 2, 'sequential stale calls each refresh (single-flight is per-in-flight, not a permanent cache)');
  } finally { cc._setRefresher('zoom', null); }
});
