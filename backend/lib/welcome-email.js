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

// Account-takeover safeguard (User Management, 2026-07-27): when a rep's login
// email is changed by an admin/manager, the OLD address is notified — what
// changed + who did it — so a hijack is visible to the prior owner of the inbox.
// Same Resend transport, same 10s bound + scrub discipline. Best-effort: never
// throws to the caller (the email change already happened).
function emailChangeNoticeContent(newEmail, actorEmail) {
  return {
    subject: 'Your Scout login email was changed',
    text: 'Hi,\n\nThe login email on your Scout account was just changed to ' + newEmail + ' by ' + (actorEmail || 'an administrator') + '.\n\n' +
      'If you made this change or expected it, no action is needed. If you did NOT expect this, contact your administrator immediately — this message was sent to your previous email address as a security precaution.\n\n— Scout',
  };
}
async function sendEmailChangeNotice(args) {
  var timer = null;
  try {
    if (!isConfigured()) return { sent: false, reason: 'not_configured' };
    if (!args || !args.oldEmail) return { sent: false, reason: 'no_old_email' };
    var content = emailChangeNoticeContent(args.newEmail, args.actorEmail);
    var doFetch = _testFetch || fetch;
    var bound = _testTimeoutMs || SEND_TIMEOUT_MS;
    var ac = new AbortController();
    timer = setTimeout(function () { ac.abort(); }, bound);
    var resp = await doFetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: WELCOME_FROM, to: args.oldEmail, subject: content.subject, text: content.text }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      var detail = '';
      try { var b = await resp.json(); detail = (b && b.message) ? ' — ' + scrub(b.message) : ''; } catch (e) { /* optional */ }
      var reason = 'Resend HTTP ' + resp.status + detail;
      console.error('[email-change-notice] send failed for ' + scrub(args.oldEmail) + ': ' + reason);
      return { sent: false, reason: reason };
    }
    return { sent: true };
  } catch (err) {
    var why = (err && err.name === 'AbortError') || /abort/i.test((err && err.message) || '')
      ? 'timed out' : scrub(err && err.message);
    console.error('[email-change-notice] send failed: ' + why);
    return { sent: false, reason: why };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Self-service password reset (FD-1). Same Resend transport + 10s bound + scrub
// discipline. Source-agnostic copy (never Fathom-only), and states plainly that
// an unrequested email is safe to ignore — the link is single-use and expires.
function passwordResetEmailContent(actionLink) {
  return {
    subject: 'Reset your Scout password',
    text: 'Hi,\n'
      + '\n'
      + 'We got a request to reset the password on your Scout account. Click\n'
      + 'here to choose a new one: ' + actionLink + '\n'
      + '\n'
      + "This link is single-use and expires soon. If you didn't request a\n"
      + 'reset, you can safely ignore this email — your password stays the same.\n'
      + '\n'
      + '— Justin',
  };
}
// Never throws. {sent:true} | {sent:false, reason}. Same hard 10s bound.
async function sendPasswordResetEmail(args) {
  var timer = null;
  try {
    if (!isConfigured()) return { sent: false, reason: 'not_configured' };
    if (!args || !args.email || !args.actionLink) return { sent: false, reason: 'missing_args' };
    var content = passwordResetEmailContent(args.actionLink);
    var doFetch = _testFetch || fetch;
    var bound = _testTimeoutMs || SEND_TIMEOUT_MS;
    var ac = new AbortController();
    timer = setTimeout(function () { ac.abort(); }, bound);
    var resp = await doFetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: WELCOME_FROM, to: args.email, subject: content.subject, text: content.text }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      var detail = '';
      try { var b = await resp.json(); detail = (b && b.message) ? ' — ' + scrub(b.message) : ''; } catch (e) { /* optional */ }
      var reason = 'Resend HTTP ' + resp.status + detail;
      console.error('[password-reset-email] send failed for ' + (args && args.email) + ': ' + reason);
      return { sent: false, reason: reason };
    }
    return { sent: true };
  } catch (err) {
    var why = (err && err.name === 'AbortError') || /abort/i.test((err && err.message) || '')
      ? 'timed out' : scrub(err && err.message);
    console.error('[password-reset-email] send failed: ' + why);
    return { sent: false, reason: why };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  sendWelcomeEmail: sendWelcomeEmail,
  sendEmailChangeNotice: sendEmailChangeNotice,
  sendPasswordResetEmail: sendPasswordResetEmail,
  isConfigured: isConfigured,
  init: init,
  _emailChangeNoticeContent: emailChangeNoticeContent,
  // test surface
  _welcomeEmailContent: welcomeEmailContent,
  _passwordResetEmailContent: passwordResetEmailContent,
  _isConfigured: isConfigured,
  _setFetchForTest: function (f) { _testFetch = f; },
  _setTimeoutForTest: function (ms) { _testTimeoutMs = ms; },
};
