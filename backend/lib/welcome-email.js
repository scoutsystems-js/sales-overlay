// Welcome email on manual user creation (owner console). Resend HTTPS API via
// native fetch — Railway blocks outbound SMTP on this plan tier (root cause of
// the 2026-07-23 two-minute console hangs), so email goes over HTTPS like every
// other outbound integration in this backend.
//
// Contracts (Justin's rulings, 2026-07-23):
//   • Failure NEVER fails or blocks creation — sendWelcomeEmail never throws;
//     it returns {sent:true} | {sent:false, reason} (KB/digest isolation rule).
//   • HARD 10-SECOND BOUND on the HTTP call (AbortController). Timeout or any
//     failure → 'failed'; the console shows the temp-password fallback. The
//     console can never wait longer than the bound.
//   • RESEND_API_KEY present = configured; absent/blank = feature silently OFF
//     ({sent:false, reason:'not_configured'}, no fetch, no crash). The old
//     WELCOME_SMTP_* vars are gone.
//   • The set-password action link appears in the email body ONLY. Never
//     logged — not in errors, not in reasons (scrubbed in case an upstream
//     error echoes request content). The API key never appears anywhere.
//
// Env (Railway Variables): RESEND_API_KEY. Sender is a constant — the domain
// is verified in Resend, replies land in Justin's real inbox.

const RESEND_URL = 'https://api.resend.com/emails';
const WELCOME_FROM = 'Justin <justin@scoutsystems.io>';
const SEND_TIMEOUT_MS = 10000;

var _testFetch = null;
var _testTimeoutMs = null;

function isConfigured(env) {
  var e = env || process.env;
  return !!(e.RESEND_API_KEY && String(e.RESEND_API_KEY).trim());
}

// Exact content per spec — plain text, subject "Your Scout login". The link
// is the Supabase recovery action link (set-password flow); no credential
// ever appears in the body.
function welcomeEmailContent(firstName, actionLink) {
  return {
    subject: 'Your Scout login',
    text: 'Hi ' + firstName + ',\n'
      + '\n'
      + 'Your Scout account is ready. Click here to set your password and\n'
      + 'get started: ' + actionLink + '\n'
      + '\n'
      + "Once you're in, you'll connect your Fathom account so Scout can\n"
      + 'start grading your calls.\n'
      + '\n'
      + "If anything isn't working, just reply to this email.\n"
      + '\n'
      + '— Justin',
  };
}

// Startup hook (index.js): configuration visibility in the boot log. No
// network at boot — the send path is bounded and self-reporting.
function init() {
  if (!isConfigured()) {
    console.log('[welcome-email] not configured (RESEND_API_KEY unset) — feature off');
    return;
  }
  console.log('[welcome-email] Resend transport configured — sending as ' + WELCOME_FROM);
}

// Defensive: strip anything that looks like a long credential-ish token from
// upstream error text before it can reach a reason string or log line.
function scrub(msg) {
  return String(msg || 'unknown').replace(/[A-Za-z0-9!@#$%^&*+=_-]{12,}/g, '[scrubbed]').slice(0, 200);
}

// Never throws. {sent:true} | {sent:false, reason}. Hard-bounded at
// SEND_TIMEOUT_MS — a blackholed connection resolves 'failed' at the bound,
// never at some transport default measured in minutes.
async function sendWelcomeEmail(args) {
  var timer = null;
  try {
    if (!isConfigured()) return { sent: false, reason: 'not_configured' };
    var content = welcomeEmailContent(args.firstName, args.actionLink);
    var doFetch = _testFetch || fetch;
    var bound = _testTimeoutMs || SEND_TIMEOUT_MS;
    var ac = new AbortController();
    timer = setTimeout(function () { ac.abort(); }, bound);
    var resp = await doFetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: WELCOME_FROM, to: args.email, subject: content.subject, text: content.text }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      var detail = '';
      try { var b = await resp.json(); detail = (b && b.message) ? ' — ' + scrub(b.message) : ''; } catch (e) { /* body optional */ }
      var reason = 'Resend HTTP ' + resp.status + detail;
      console.error('[welcome-email] send failed for ' + (args && args.email) + ': ' + reason);
      return { sent: false, reason: reason };
    }
    return { sent: true };
  } catch (err) {
    var why = (err && err.name === 'AbortError') || /abort/i.test((err && err.message) || '')
      ? 'timed out after ' + ((_testTimeoutMs || SEND_TIMEOUT_MS) / 1000) + 's'
      : scrub(err && err.message);
    console.error('[welcome-email] send failed for ' + (args && args.email) + ': ' + why);
    return { sent: false, reason: why };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  sendWelcomeEmail: sendWelcomeEmail,
  isConfigured: isConfigured,
  init: init,
  // test surface
  _welcomeEmailContent: welcomeEmailContent,
  _isConfigured: isConfigured,
  _setFetchForTest: function (f) { _testFetch = f; },
  _setTimeoutForTest: function (ms) { _testTimeoutMs = ms; },
};
