// createRateLimiter — in-memory sliding-window limiter for unauthenticated
// endpoints (there was nothing to reuse). Built for POST /auth/forgot-password,
// which runs TWO instances: one keyed by client IP, one by submitted email.
//
// hit(key) records an attempt when allowed and reports {allowed, remaining,
// retryAfterMs}. The clock is injectable (opts.now) so window/reset behaviour is
// deterministic under test; defaults to Date.now in production.
//
// Scope note: state is per-process. Behind a single Railway instance that is the
// whole story; if the service is ever scaled horizontally, limits become
// per-instance (acceptable for reset-abuse throttling — revisit if it matters).
function createRateLimiter(opts) {
  opts = opts || {};
  var windowMs = opts.windowMs || 60000;
  var max = opts.max || 5;
  var now = opts.now || Date.now;
  var maxKeys = opts.maxKeys || 20000; // memory backstop before a full sweep
  var hits = new Map(); // key -> ascending array of hit timestamps within the window

  function withinWindow(arr, cutoff) {
    // Drop timestamps at/older than cutoff (they've slid out of the window).
    var i = 0;
    while (i < arr.length && arr[i] <= cutoff) i++;
    return i === 0 ? arr : arr.slice(i);
  }

  // Opportunistic cleanup so keys that stopped being hit don't accumulate.
  function sweep(cutoff) {
    hits.forEach(function (arr, key) {
      var kept = withinWindow(arr, cutoff);
      if (kept.length === 0) hits.delete(key);
      else if (kept.length !== arr.length) hits.set(key, kept);
    });
  }

  function hit(key) {
    var t = now();
    var cutoff = t - windowMs;
    if (hits.size > maxKeys) sweep(cutoff);
    var arr = withinWindow(hits.get(key) || [], cutoff);
    if (arr.length >= max) {
      hits.set(key, arr);
      var retryAfterMs = arr[0] + windowMs - t; // when the oldest in-window hit expires
      return { allowed: false, remaining: 0, retryAfterMs: retryAfterMs > 0 ? retryAfterMs : 0 };
    }
    arr.push(t);
    hits.set(key, arr);
    return { allowed: true, remaining: max - arr.length, retryAfterMs: 0 };
  }

  return {
    hit: hit,
    reset: function () { hits.clear(); },
    _size: function () { return hits.size; },
  };
}

module.exports = { createRateLimiter: createRateLimiter };
