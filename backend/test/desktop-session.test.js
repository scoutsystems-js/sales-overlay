/**
 * DESKTOP PERSISTENT-LOGIN PARITY — the three approved additions.
 *
 * ⚠⚠ THE DEFECT: `ensureFreshToken` cleared the stored session on ANY non-OK
 * response and on ANY thrown error, so a Wi-Fi blip, a 500 or a laptop waking
 * mid-request logged the user out. The web app fixed exactly this in July
 * (scout-auth.js); the desktop app never inherited it.
 *
 * ⚠ The Electron app cannot be driven from this harness, so the RISKY part is
 * extracted into src/lib/session-refresh.js as pure functions and tested here.
 * What is left in main/index.js is wiring, asserted structurally below.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SR = require('../../src/lib/session-refresh');
const ROOT = path.join(__dirname, '..', '..');
function code(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ── what may clear a login ────────────────────────────────────────────── */

test('⚠⚠ ONLY a definitive auth failure clears the session', () => {
  assert.strictEqual(SR.shouldClearSession(400), true, '400 is a rejected grant');
  assert.strictEqual(SR.shouldClearSession(401), true, '401 is a rejected grant');
});

test('⚠⚠ TRANSIENT failures must NOT clear it — this is the whole bug', () => {
  [500, 502, 503, 504, 429, 408, 0].forEach(s => {
    assert.strictEqual(SR.shouldClearSession(s), false, 'HTTP ' + s + ' must keep the session');
  });
  /* A thrown network error carries no status at all. */
  assert.strictEqual(SR.shouldClearSession(null), false);
  assert.strictEqual(SR.shouldClearSession(undefined), false);
});

test('an invalid_grant body IS definitive even without a 400', () => {
  /* GoTrue sometimes returns it with another status; the body is unambiguous. */
  assert.strictEqual(SR.shouldClearSession(500, '{"error":"invalid_grant"}'), true);
  assert.strictEqual(SR.shouldClearSession(500, 'refresh_token_not_found'), true);
  assert.strictEqual(SR.shouldClearSession(500, 'that token was already used'), true);
  assert.strictEqual(SR.shouldClearSession(500, 'upstream timeout'), false, 'ordinary 5xx text stays transient');
});

/* ── the proactive timer ───────────────────────────────────────────────── */

test('⚠ expires_at is UNIX SECONDS, not milliseconds', () => {
  /* Getting this backwards is silent: ms-as-seconds puts every expiry far in
     the future and never refreshes; seconds-as-ms puts it in 1970 and refreshes
     on every tick. */
  const now = 1_700_000_000_000;
  const inTwoMin = (now + 2 * 60 * 1000) / 1000;
  const inAnHour = (now + 60 * 60 * 1000) / 1000;
  assert.strictEqual(SR.needsProactiveRefresh(inTwoMin, now, SR.PROACTIVE_MARGIN_MS), true);
  assert.strictEqual(SR.needsProactiveRefresh(inAnHour, now, SR.PROACTIVE_MARGIN_MS), false);
});

test('an unknown expiry does NOT trigger a refresh — the 401 path owns that', () => {
  [null, undefined, 0, -1, NaN, 'soon'].forEach(v => {
    assert.strictEqual(SR.needsProactiveRefresh(v, Date.now(), SR.PROACTIVE_MARGIN_MS), false,
      String(v) + ' must not trigger');
  });
});

test('the interval is SHORTER than the margin, or a session can expire between ticks', () => {
  assert.ok(SR.PROACTIVE_INTERVAL_MS < SR.PROACTIVE_MARGIN_MS,
    'a 4-minute tick against a 5-minute margin leaves no gap');
});

/* ── the wiring ────────────────────────────────────────────────────────── */

test('main/index.js uses the shared decision and no longer clears on any failure', () => {
  const src = code('src/main/index.js');
  assert.ok(/shouldClearSession\(res\.status, body\)/.test(src), 'the refresh must consult it');
  /* the catch used to clear unconditionally */
  assert.ok(!/Refresh error[\s\S]{0,80}clearSessionFromDisk\(\)/.test(src),
    'a network error must no longer clear the session');
  assert.ok(/startProactiveTokenRefresh\(\)/.test(src), 'the timer must be started');
  assert.ok(/needsProactiveRefresh\(session\.expires_at/.test(src), 'and use the shared predicate');
});

test('⚠ the proxy retries a 401 exactly ONCE', () => {
  const src = code('src/lib/proxy-client.js');
  assert.ok(/res\.status === 401 && !isRetry/.test(src), 'the first 401 must retry');
  assert.ok(/if \(res\.status === 401\) throw/.test(src), 'the second must surface');
  /* Bounded: if a freshly refreshed token is still refused, the session really
     is gone and retrying again only delays saying so. */
  assert.ok(/_attempt\(method, path, body, true\)/.test(src), 'the retry must be marked as such');
});
