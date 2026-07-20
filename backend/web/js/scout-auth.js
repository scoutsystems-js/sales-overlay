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

  // One refresh POST with a specific refresh token. Resolves to:
  //   { session:obj,  fatal:false } — success
  //   { session:null, fatal:true  } — token DEFINITIVELY rejected (HTTP 400/401):
  //                                   a genuine re-login is required
  //   { session:null, fatal:false } — TRANSIENT failure (network down on wake,
  //                                   5xx cold start, 429, aborted): keep the
  //                                   session, let a later attempt recover.
  // Treating the transient case as fatal is exactly what logged users out
  // overnight — the machine woke, the refresh fired before Wi-Fi was back, the
  // fetch threw, and the old code called clearSession() on that throw.
  function _doRefresh(refreshToken) {
    return _rawFetch(REFRESH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).then(function (res) {
      if (res.ok) {
        return res.json().then(function (data) {
          var sess = (data && data.session) || data;
          if (!sess || !sess.access_token) return { session: null, fatal: false };
          var cur = getSession() || {};
          var fresh = {
            access_token: sess.access_token,
            refresh_token: sess.refresh_token || refreshToken,
            expires_at: sess.expires_at,
            email: (sess.user && sess.user.email) || (data && data.user && data.user.email) || cur.email,
          };
          setSession(fresh);
          return { session: fresh, fatal: false };
        }, function () { return { session: null, fatal: false }; });
      }
      // 400/401 = the refresh token itself is invalid/expired/rotated-away → fatal.
      // Everything else (5xx, 429, 408, opaque 0) is a transient blip → non-fatal.
      return { session: null, fatal: (res.status === 400 || res.status === 401) };
    }, function () {
      // Network error (offline, DNS/TLS not up yet on wake). NEVER fatal.
      return { session: null, fatal: false };
    });
  }

  // Refresh using the freshest stored refresh token, deduplicated so concurrent
  // 401s + the proactive timer share one in-flight refresh. On a fatal rejection
  // we FIRST check whether another tab already rotated the token in localStorage
  // (the multi-tab rotation race) — if so we retry with that newer token rather
  // than nuking a session that's actually still alive. Only clears on a true fatal.
  function refreshSession() {
    if (_refreshInFlight) return _refreshInFlight;
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.resolve({ session: null, fatal: true });
    _refreshInFlight = _doRefresh(s.refresh_token).then(function (r) {
      if (r.session || !r.fatal) return r;
      var latest = getSession();
      if (latest && latest.refresh_token && latest.refresh_token !== s.refresh_token) {
        // Another tab rotated the token out from under us — retry with the newer one.
        return _doRefresh(latest.refresh_token).then(function (r2) {
          if (r2.fatal && !r2.session) clearSession();
          return r2;
        });
      }
      clearSession();
      return r;
    }).then(function (r) { _refreshInFlight = null; return r; });
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
      return refreshSession().then(function (r) {
        var fresh = r && r.session;
        if (!fresh) {
          // Only bounce to /login on a DEFINITIVE auth failure. On a transient
          // failure (network down on wake, 5xx) keep the session + return the
          // original 401; the next call / visibility-refresh recovers silently.
          if (r && r.fatal) { clearSession(); redirectToLogin(); }
          return res;
        }
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
  function maybeRefresh() {
    var s = getSession();
    if (s && s.refresh_token && shouldRefresh(s)) refreshSession();
  }
  // setInterval is SUSPENDED while the machine sleeps, so it can't be the only
  // trigger — an overnight-idle tab wakes with an expired access token and a
  // frozen timer. Also fire on the events that DO fire on wake: the tab becoming
  // visible again, the window regaining focus, and the network coming back
  // online. Every path is failure-tolerant (see refreshSession) so a wake-time
  // network blip can never log the user out.
  setInterval(maybeRefresh, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') maybeRefresh();
  });
  window.addEventListener('online', maybeRefresh);
  window.addEventListener('focus', maybeRefresh);

  // Expose a namespace for any page code that wants the corrected helpers.
  window.ScoutAuth = {
    getSession: getSession, setSession: setSession, clearSession: clearSession,
    isSessionValid: isSessionValid, shouldRefresh: shouldRefresh,
    // Returns the fresh session object (or null) for back-compat with callers
    // that awaited a session; the fatal/transient distinction stays internal.
    refreshSession: function () { return refreshSession().then(function (r) { return r && r.session; }); },
    authHeader: function () { var s = getSession(); return s && s.access_token ? { Authorization: 'Bearer ' + s.access_token } : {}; },
  };
})();
