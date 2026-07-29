// safeReturnPath(raw, fallback) — open-redirect guard for post-login redirects.
//
// Returns `raw` ONLY when it is a plain same-origin absolute path (starts with a
// single "/", carries no scheme, host, or control characters). Anything else —
// off-site URLs, protocol-relative "//host", "/\host", schemes, whitespace/control
// tricks, non-strings, or the bare "/" root — returns `fallback`.
//
// CANONICAL COPY. The identical function is inlined into backend/web/login.html and
// backend/web/connect.html (static pages cannot require() this module). Keep all
// three in step; backend/test/safe-return-path.test.js is the contract.
function safeReturnPath(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  if (raw.length < 2) return fallback;                  // '' or bare '/' — nothing useful to return to
  if (raw.charAt(0) !== '/') return fallback;           // must be an absolute same-origin path
  if (raw.charAt(1) === '/' || raw.charAt(1) === '\\') return fallback; // '//host' or '/\host' -> off-site
  // Reject any control char or whitespace (NUL/tab/newline/space, code point <= 0x20)
  // that could smuggle a scheme or split the URL. charCodeAt loop keeps this file ASCII-only.
  for (var i = 0; i < raw.length; i++) { if (raw.charCodeAt(i) <= 0x20) return fallback; }
  return raw;
}

module.exports = safeReturnPath;
