'use strict';
/**
 * Desktop session-refresh decisions, extracted so they can be TESTED.
 *
 * The Electron app cannot be driven from the test harness, so the risky part of
 * the persistent-login work is pulled out as pure functions and covered from
 * backend/test. What remains in main/index.js is wiring.
 *
 * ⚠⚠ THE DEFECT THIS FIXES: `ensureFreshToken` cleared the stored session on
 * ANY non-OK response from /auth/refresh, and on any thrown error. So a Wi-Fi
 * blip, a 500, or a laptop waking up mid-request logged the user out and sent
 * them back to the login window. The web app fixed exactly this in July
 * (scout-auth.js); the desktop app never inherited it.
 *
 * THE RULE, matching the web: clear ONLY on a definitive auth failure. A
 * refresh token is rejected with 400 or 401 — everything else (network error,
 * timeout, 5xx, 429) is transient and the session must SURVIVE so the next
 * launch or the next call can retry.
 */

/** Supabase/GoTrue reject a bad refresh token with these. Nothing else is definitive. */
var AUTH_FAILURE_STATUSES = [400, 401];

/**
 * Should the stored session be cleared and the login window reopened?
 *
 * @param {number|null} status  HTTP status, or null/undefined for a thrown error
 * @param {string} [body]       response body, if read
 *
 * ⚠ FAILS SAFE TOWARD KEEPING THE SESSION. Being wrong by keeping it costs one
 * failed request that retries; being wrong by clearing it costs the user their
 * login for no reason — which is the bug being fixed.
 */
function shouldClearSession(status, body) {
  if (typeof status === 'number' && AUTH_FAILURE_STATUSES.indexOf(status) !== -1) return true;
  /* GoTrue sometimes returns invalid_grant with a non-400 status. If the body
     says the grant itself is bad, that IS definitive. */
  if (typeof body === 'string' && /invalid_grant|refresh_token_not_found|already used/i.test(body)) return true;
  return false;
}

/**
 * Is this session close enough to expiry to refresh it PROACTIVELY?
 *
 * ⚠ `expires_at` is UNIX SECONDS in the stored session, not milliseconds — the
 * web side had to learn this too. Treating it as ms puts every expiry in 1970
 * and refreshes constantly; treating ms as s puts it far in the future and
 * never refreshes at all.
 */
function needsProactiveRefresh(expiresAt, nowMs, marginMs) {
  var exp = Number(expiresAt);
  if (!isFinite(exp) || exp <= 0) return false;          // unknown expiry → leave it to the 401 path
  var now = (typeof nowMs === 'number') ? nowMs : Date.now();
  var margin = (typeof marginMs === 'number' && marginMs >= 0) ? marginMs : 5 * 60 * 1000;
  return (exp * 1000) - now <= margin;
}

module.exports = {
  shouldClearSession: shouldClearSession,
  needsProactiveRefresh: needsProactiveRefresh,
  AUTH_FAILURE_STATUSES: AUTH_FAILURE_STATUSES,
  PROACTIVE_MARGIN_MS: 5 * 60 * 1000,
  PROACTIVE_INTERVAL_MS: 4 * 60 * 1000,
};
