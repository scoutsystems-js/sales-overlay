/* Scout shared auth module — persistent web login.
 *
 * Loaded in <head> of login.html, dashboard.html, admin.html BEFORE their inline
 * scripts. Two jobs:
 *   1. A global fetch interceptor: on a same-origin API 401, silently refresh the
 *      session and RETRY the request once. Only if the refresh itself fails do we
 *      clear the session and redirect to /login. This is the fix for the old
 *      behavior where any 401 (e.g. the 1-hour access-token expiry) wiped the
 *      session — including the refresh token — and forced a full re-login.
 *   2. A proactive timer that refreshes a few minutes before expiry, so long-open
 *      tabs never hit a 401 at all.
 *
 * All state lives in localStorage['scout_session_v1'] = {access_token,
 * refresh_token, expires_at (UNIX SECONDS), email}. The interceptor uses these
 * closure functions (NOT window globals), so a page keeping its own thin
 * getSession()/authHeader() copies cannot break the refresh path.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'scout_session_v1';
  var REFRESH_ENDPOINT = '/auth/refresh';
  var LOGIN_PATH = '/login';
  // Same-origin endpoints that must NOT trigger the refresh-retry (they either
  // establish a session or would recurse).
  var AUTH_EXEMPT = { '/auth/refresh': 1, '/auth/login': 1, '/auth/signup': 1 };

  // Capture the real fetch before we override it.
  var _rawFetch = window.fetch.bind(window);

  function getSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSession(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

  // expires_at is UNIX SECONDS. (The old dashboard bug did new Date(seconds),
  // interpreting it as milliseconds — always ~1970, always "expired".)
  function msLeft(s) { return (s && s.expires_at) ? (s.expires_at * 1000 - Date.now()) : -1; }
  function isSessionValid(s) { return !!(s && s.access_token && s.expires_at) && msLeft(s) > 30 * 1000; }
  function shouldRefresh(s) { return !!(s && s.refresh_token) && msLeft(s) < 5 * 60 * 1000; } // within 5 min or expired

  var _refreshInFlight = null;
  // Refresh using the stored refresh token. Deduplicated so concurrent 401s (and
  // the proactive timer) share a single refresh. Returns the fresh session or
  // null; clears the session on a genuine failure.
  function refreshSession() {
    if (_refreshInFlight) return _refreshInFlight;
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.resolve(null);
    _refreshInFlight = (function () {
      return _rawFetch(REFRESH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      }).then(function (res) {
        if (!res.ok) { clearSession(); return null; }
        return res.json().then(function (data) {
          var sess = (data && data.session) || data;
          if (!sess || !sess.access_token) { clearSession(); return null; }
          var fresh = {
            access_token: sess.access_token,
            refresh_token: sess.refresh_token || s.refresh_token,
            expires_at: sess.expires_at,
            email: (sess.user && sess.user.email) || (data && data.user && data.user.email) || s.email,
          };
          setSession(fresh);
          return fresh;
        });
      }).catch(function () { clearSession(); return null; })
        .then(function (r) { _refreshInFlight = null; return r; });
    })();
    return _refreshInFlight;
  }

  function sameOriginApi(url) {
    try {
      var u = new URL(url, window.location.origin);
      if (u.origin !== window.location.origin) return false;
      return !AUTH_EXEMPT[u.pathname];
    } catch (e) { return false; }
  }

  function redirectToLogin() {
    if (window.location.pathname !== LOGIN_PATH) window.location.replace(LOGIN_PATH);
  }

  function withAuth(init, token) {
    var opts = Object.assign({}, init || {});
    var h = Object.assign({}, opts.headers || {});
    h.Authorization = 'Bearer ' + token;
    opts.headers = h;
    return opts;
  }

  // ── The 401 wrapper ─────────────────────────────────────────────────────────
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    return _rawFetch(input, init).then(function (res) {
      if (res.status !== 401 || !sameOriginApi(url)) return res;
      return refreshSession().then(function (fresh) {
        if (!fresh) { clearSession(); redirectToLogin(); return res; }
        // Retry ONCE with the fresh token, via _rawFetch (no re-interception).
        if (typeof input === 'string') {
          return _rawFetch(input, withAuth(init, fresh.access_token));
        }
        try {
          var headers = new Headers(input.headers);
          headers.set('Authorization', 'Bearer ' + fresh.access_token);
          return _rawFetch(new Request(input, { headers: headers }));
        } catch (e) { return res; }
      });
    });
  };

  // ── Proactive refresh: keep long-open tabs alive ────────────────────────────
  setInterval(function () {
    var s = getSession();
    if (s && s.refresh_token && shouldRefresh(s)) refreshSession();
  }, 4 * 60 * 1000);

  // Expose a namespace for any page code that wants the corrected helpers.
  window.ScoutAuth = {
    getSession: getSession, setSession: setSession, clearSession: clearSession,
    isSessionValid: isSessionValid, shouldRefresh: shouldRefresh, refreshSession: refreshSession,
    authHeader: function () { var s = getSession(); return s && s.access_token ? { Authorization: 'Bearer ' + s.access_token } : {}; },
  };
})();
