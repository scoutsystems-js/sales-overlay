// Shared error-handling helpers used by /proxy/* and /log/* routes.
//
// - formatUpstreamError: shapes any downstream failure (Anthropic SDK error,
//   fetch error, plain Error) into { status, body } — preserves the real HTTP
//   status + a truncated message so the client sees actionable detail.
// - isTransientError: true if an error message looks like a retryable
//   transient infrastructure hiccup (502, 503, 504, network-level errors).
// - insertWithRetry: wraps a Supabase insert with one retry on transient
//   failure + exponential backoff. Absorbs Cloudflare 502s at the edge so
//   the SessionLogger client never sees them.
//
// All three are pure-ish and testable without mounting express or making
// network calls.

// Cap the detail portion so a verbose upstream (e.g. an HTML error page)
// can't flood Railway logs or Supabase text columns. 200 chars is enough to
// see "404 model: X not_found" or "502 Bad Gateway" clearly.
var MAX_DETAIL_LEN = 200;

function formatUpstreamError(err, serviceLabel) {
  var status = (err && err.status) ? err.status : 500;
  var raw = (err && err.message) ? String(err.message) : 'unknown';
  var detail = (raw.length > 0 ? raw : 'unknown').slice(0, MAX_DETAIL_LEN);
  return {
    status: status,
    body: { error: serviceLabel + ' failed (' + status + '): ' + detail },
  };
}

// Matched against err.message — covers HTTP transient codes and the most
// common Node-level network errors. Intentionally regex-based (not strict
// status-code matching) because Supabase-via-Cloudflare 502s arrive as an
// HTML blob with no numeric status field we can rely on.
var TRANSIENT_PATTERNS = /\b(502|503|504)\b|bad gateway|gateway timeout|etimedout|econnreset|eai_again|enetunreach/i;

function isTransientError(err) {
  if (!err || !err.message) return false;
  return TRANSIENT_PATTERNS.test(String(err.message));
}

// Inserts `rows` into `table` via the supplied Supabase client, retrying
// on transient failures. Non-transient errors (4xx validation, permission,
// schema) return immediately — retrying them would just waste time.
//
// Options:
//   maxRetries   — default 1 (so one failure → one retry → final answer)
//   baseDelayMs  — default 500 (delay = baseDelayMs * 3^attempt)
async function insertWithRetry(supabaseClient, table, rows, options) {
  options = options || {};
  var maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 1;
  var baseDelayMs = typeof options.baseDelayMs === 'number' ? options.baseDelayMs : 500;
  var attempt = 0;
  while (true) {
    var result = await supabaseClient.from(table).insert(rows);
    if (!result.error) return result;
    if (attempt >= maxRetries || !isTransientError(result.error)) return result;
    if (baseDelayMs > 0) {
      var delay = baseDelayMs * Math.pow(3, attempt);
      await new Promise(function(r) { setTimeout(r, delay); });
    }
    attempt++;
  }
}

module.exports = {
  formatUpstreamError: formatUpstreamError,
  isTransientError: isTransientError,
  insertWithRetry: insertWithRetry,
  _constants: { MAX_DETAIL_LEN: MAX_DETAIL_LEN },
};
