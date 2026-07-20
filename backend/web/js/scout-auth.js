/* Scout shared auth module — persistent web login.
 *
 * Loaded in <head> of login.html, dashboard.html, admin.html BEFORE their inline
 * scripts. Two jobs:
 *   1. A global fetch interceptor: on a same-origin API 401, silently refresh the
 *      session and RETRY the request once. Only if the refresh itself fails do we
 *      clear the session and redirect to /login. This is the fix for the old
 *      behavior where any 401 (e.g. the 1-hour access-token expiry) wiped the
 *      session — including the refresh token — and forced a full re-login.
 *   2. A proactive timer (+ visibility/focus/online wake triggers) that refreshes
 *      a few minutes before expiry, so long-open tabs never hit a 401 at all.
 *
 * Refreshes are (a) tolerant of transient failures — only a definitive 400/401
 * clears the session — and (b) serialized ACROSS tabs via a lock, so two tabs
 * waking together can't both replay the same rotating refresh token and trip
 * Supabase's compromised-token detection (which revokes the whole family). See
 * the "Cross-tab refresh coordination" block for the full rationale.
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

  // ── Cross-tab refresh coordination ──────────────────────────────────────────
  // Supabase config (verified from the dashboard): refresh-token rotation ON,
  // compromised-token (reuse) detection ON, reuse interval ~10s; single-session
  // OFF, time-box + inactivity never. That combination makes TWO tabs the killer:
  // both wake overnight, both fire a refresh with the SAME stored token; if the
  // second one lands OUTSIDE the 10s reuse window it looks like a replayed token
  // and Supabase revokes the WHOLE family — logging every tab out. The per-tab
  // single-flight guard can't stop this. So we serialize refreshes ACROSS tabs
  // with a lock (Web Locks API, else a localStorage lock with stale-takeover),
  // and every waiter re-reads localStorage first — only ONE network refresh
  // happens per rotation, and losers adopt the freshly-stored token.
  var LOCK_NAME = 'scout-auth-refresh';
  var LS_LOCK_KEY = 'scout_auth_lock_v1';
  var LS_LOCK_TTL = 8000;    // a refresh should take < 8s; an older lock is stale → take over
  var LS_LOCK_WAIT = 9000;   // a loser waits up to ~9s, then proceeds (the critical section re-reads tokens)

  // Lightweight, always-on instrumentation so an overnight failure (if any
  // remains) is diagnosable from the morning console (grep "[scout-auth").
  function _log(msg, s) {
    try {
      console.info('[scout-auth ' + new Date().toISOString() + '] ' + msg
        + (s && s.expires_at ? ' (exp ' + new Date(s.expires_at * 1000).toISOString() + ')' : ''));
    } catch (e) {}
  }

  // localStorage lock. Resolves to the owned lock id, or null if we gave up
  // waiting (then we proceed anyway — the critical section re-reads tokens and
  // typically finds another tab already refreshed). Stale locks (older than
  // LS_LOCK_TTL, e.g. a tab that died mid-refresh) are taken over.
  function _acquireLsLock() {
    var myId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    var deadline = Date.now() + LS_LOCK_WAIT;
    return new Promise(function (resolve) {
      (function attempt() {
        var now = Date.now();
        var cur = null;
        try { cur = JSON.parse(localStorage.getItem(LS_LOCK_KEY) || 'null'); } catch (e) {}
        var held = cur && (now - cur.ts) < LS_LOCK_TTL;
        if (!held) {
          try { localStorage.setItem(LS_LOCK_KEY, JSON.stringify({ id: myId, ts: now })); } catch (e) {}
          var back = null;
          try { back = JSON.parse(localStorage.getItem(LS_LOCK_KEY) || 'null'); } catch (e) {}
          if (back && back.id === myId) { resolve(myId); return; }   // won the write race
        }
        if (now >= deadline) { resolve(null); return; }
        setTimeout(attempt, 120 + Math.floor(Math.random() * 120));
      })();
    });
  }
  function _releaseLsLock(id) {
    try {
      var cur = JSON.parse(localStorage.getItem(LS_LOCK_KEY) || 'null');
      if (cur && cur.id === id) localStorage.removeItem(LS_LOCK_KEY);
    } catch (e) {}
  }

  // Run fn() while holding the cross-tab refresh lock. Prefers the Web Locks API
  // (auto-releases if the tab dies mid-refresh, and truly queues waiters); falls
  // back to the localStorage lock where Web Locks is unavailable.
  function _withCrossTabLock(fn) {
    if (window.navigator && navigator.locks && navigator.locks.request) {
      return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, function () {
        return Promise.resolve().then(fn);
      });
    }
    return _acquireLsLock().then(function (id) {
      return Promise.resolve().then(fn).then(
        function (r) { _releaseLsLock(id); return r; },
        function (e) { _releaseLsLock(id); throw e; }
      );
    });
  }

  // Refresh, coordinated across tabs. Deduped per-tab via _refreshInFlight;
  // serialized across tabs via _withCrossTabLock. `staleToken` (optional) is the
  // access token that just 401'd — if localStorage now holds a different one,
  // another tab already refreshed and we adopt it with NO network call (so we
  // never replay an already-rotated refresh token). On a true fatal we retry once
  // with any concurrently-rotated token before clearing.
  function refreshSession(staleToken) {
    if (_refreshInFlight) return _refreshInFlight;
    _refreshInFlight = _withCrossTabLock(function () {
      var s = getSession();
      if (!s || !s.refresh_token) return { session: null, fatal: true };
      // Did another tab refresh while we waited for the lock? Two skip cases:
      //   • 401 path (staleToken set): skip ONLY if the stored access token has
      //     since changed (another tab rotated) — otherwise the server rejected
      //     THIS token and we must refresh, even if the clock still says valid.
      //   • proactive/wake path (no staleToken): skip if the token is already
      //     valid and not near expiry (another tab, or we, already refreshed).
      var superseded = staleToken && s.access_token && s.access_token !== staleToken && isSessionValid(s);
      var proactiveFresh = !staleToken && isSessionValid(s) && !shouldRefresh(s);
      if (superseded || proactiveFresh) {
        _log('skip refresh — token already fresh from another tab', s);
        return { session: s, fatal: false };
      }
      _log('refresh start', s);
      return _doRefresh(s.refresh_token).then(function (r) {
        if (r.session) { _log('refresh ok', r.session); return r; }
        if (!r.fatal) { _log('refresh transient — session kept'); return r; }
        var latest = getSession();
        if (latest && latest.refresh_token && latest.refresh_token !== s.refresh_token) {
          _log('refresh fatal but token rotated elsewhere — retrying with newer token');
          return _doRefresh(latest.refresh_token).then(function (r2) {
            if (r2.session) { _log('refresh ok (2nd token)', r2.session); }
            else if (r2.fatal) { clearSession(); _log('refresh fatal — cleared'); }
            return r2;
          });
        }
        clearSession();
        _log('refresh fatal — cleared');
        return r;
      });
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

  // Re-issue the original request with a fresh token, via _rawFetch (no
  // re-interception). Returns the fallback `res` if a Request rebuild throws.
  function _retryWith(input, init, res, token) {
    if (typeof input === 'string') return _rawFetch(input, withAuth(init, token));
    try {
      var headers = new Headers(input.headers);
      headers.set('Authorization', 'Bearer ' + token);
      return _rawFetch(new Request(input, { headers: headers }));
    } catch (e) { return res; }
  }

  // ── The 401 wrapper ─────────────────────────────────────────────────────────
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    return _rawFetch(input, init).then(function (res) {
      if (res.status !== 401 || !sameOriginApi(url)) return res;
      // The access token in play when this 401 came back. If another tab has
      // since rotated it, refreshSession() detects the mismatch and adopts the
      // new token instead of firing a redundant, race-prone refresh.
      var stale = (getSession() || {}).access_token || null;
      return refreshSession(stale).then(function (r) {
        var fresh = r && r.session;
        if (fresh) return _retryWith(input, init, res, fresh.access_token);
        if (r && r.fatal) {
          // Final cross-tab re-read before giving up — another tab may have
          // established a valid session between our refresh and now.
          var last = getSession();
          if (isSessionValid(last)) {
            _log('recovered at redirect gate — valid session from another tab', last);
            return _retryWith(input, init, res, last.access_token);
          }
          clearSession(); redirectToLogin();
        }
        // Transient failure: keep the session, surface the 401; a later call or
        // the visibility/online refresh recovers silently.
        return res;
      });
    });
  };

  // ── Proactive refresh: keep long-open tabs alive ────────────────────────────
  function maybeRefresh(reason) {
    var s = getSession();
    if (s && s.refresh_token && shouldRefresh(s)) {
      _log('proactive refresh (' + (reason || 'timer') + ')', s);
      refreshSession();
    }
  }
  // setInterval is SUSPENDED while the machine sleeps, so it can't be the only
  // trigger — an overnight-idle tab wakes with an expired access token and a
  // frozen timer. Also fire on the events that DO fire on wake: the tab becoming
  // visible again, the window regaining focus, and the network coming back
  // online. Every path is failure-tolerant + cross-tab-serialized, so a wake-time
  // network blip or a two-tab wake can never log the user out.
  setInterval(function () { maybeRefresh('timer'); }, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') maybeRefresh('visible');
  });
  window.addEventListener('online', function () { maybeRefresh('online'); });
  window.addEventListener('focus', function () { maybeRefresh('focus'); });

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
