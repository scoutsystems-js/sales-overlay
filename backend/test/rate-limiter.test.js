// createRateLimiter — the abuse guard behind the unauthenticated
// POST /auth/forgot-password (per-IP and per-email). Sliding window; the clock is
// injectable so the window/reset behaviour is deterministic in tests.
const test = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../lib/rate-limiter');

function fakeClock(start) {
  var t = start || 1000;
  var fn = function () { return t; };
  fn.advance = function (ms) { t += ms; };
  return fn;
}

test('allows up to max hits within the window, denies the next', () => {
  var now = fakeClock();
  var rl = createRateLimiter({ windowMs: 60000, max: 3, now: now });
  assert.strictEqual(rl.hit('k').allowed, true);
  assert.strictEqual(rl.hit('k').allowed, true);
  assert.strictEqual(rl.hit('k').allowed, true);
  var fourth = rl.hit('k');
  assert.strictEqual(fourth.allowed, false);
  assert.strictEqual(fourth.remaining, 0);
  assert.ok(fourth.retryAfterMs > 0, 'denied hit reports a positive retryAfterMs');
});

test('remaining counts down from max', () => {
  var now = fakeClock();
  var rl = createRateLimiter({ windowMs: 1000, max: 2, now: now });
  assert.strictEqual(rl.hit('k').remaining, 1);
  assert.strictEqual(rl.hit('k').remaining, 0);
});

test('window slides — hits expire and capacity returns', () => {
  var now = fakeClock();
  var rl = createRateLimiter({ windowMs: 1000, max: 2, now: now });
  rl.hit('k'); rl.hit('k');
  assert.strictEqual(rl.hit('k').allowed, false); // full
  now.advance(1001);                              // whole window elapses
  assert.strictEqual(rl.hit('k').allowed, true);  // capacity restored
});

test('partial slide frees exactly one slot', () => {
  var now = fakeClock();
  var rl = createRateLimiter({ windowMs: 1000, max: 2, now: now });
  rl.hit('k');            // t=1000
  now.advance(600);
  rl.hit('k');            // t=1600 — now full
  assert.strictEqual(rl.hit('k').allowed, false);
  now.advance(401);       // t=2001 — first hit (1000) now outside [1001, 2001]
  assert.strictEqual(rl.hit('k').allowed, true);  // one slot freed
  assert.strictEqual(rl.hit('k').allowed, false); // and immediately full again
});

test('keys are independent (per-IP vs per-email do not interfere)', () => {
  var now = fakeClock();
  var rl = createRateLimiter({ windowMs: 60000, max: 1, now: now });
  assert.strictEqual(rl.hit('ip:1.2.3.4').allowed, true);
  assert.strictEqual(rl.hit('ip:1.2.3.4').allowed, false);
  assert.strictEqual(rl.hit('email:a@b.com').allowed, true); // different key unaffected
});

test('defaults to Date.now when no clock injected (smoke)', () => {
  var rl = createRateLimiter({ windowMs: 60000, max: 1 });
  assert.strictEqual(rl.hit('k').allowed, true);
  assert.strictEqual(rl.hit('k').allowed, false);
});
