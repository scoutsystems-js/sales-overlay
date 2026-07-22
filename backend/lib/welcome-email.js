// Welcome email on manual user creation (owner console). Google Workspace
// SMTP via nodemailer — sent as justin@scoutsystems.io (WELCOME_SMTP_USER).
//
// Contracts (Justin's ruling, 2026-07-23):
//   • Failure NEVER fails or blocks creation — sendWelcomeEmail never throws;
//     it returns {sent:true} | {sent:false, reason} (KB/digest isolation rule).
//   • Missing/blank env vars = feature silently OFF: {sent:false,
//     reason:'not_configured'}, no transport built, no crash, no config error.
//   • The set-password action link appears in the email body ONLY. Never
//     logged here — not in errors, not in reasons (reasons are scrubbed in
//     case an upstream error echoes message content). Same discipline as the
//     create route's temp password.
//   • Transport is a lazy singleton, verified ONCE (init() at server startup
//     when configured), never rebuilt per send.
//
// Env (Railway Variables): WELCOME_SMTP_USER, WELCOME_SMTP_PASS,
// WELCOME_FROM_NAME (optional display name; defaults to "Justin").

const nodemailer = require('nodemailer');

function isConfigured(env) {
  var e = env || process.env;
  return !!(e.WELCOME_SMTP_USER && String(e.WELCOME_SMTP_USER).trim()
         && e.WELCOME_SMTP_PASS && String(e.WELCOME_SMTP_PASS).trim());
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

var _transport = null;
var _testTransport = null;
function getTransport() {
  if (_testTransport) return _testTransport;
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.WELCOME_SMTP_USER, pass: process.env.WELCOME_SMTP_PASS },
  });
  return _transport;
}

// Startup hook (index.js): verify the transport once when configured, so a bad
// app password surfaces in the boot log instead of on the first creation.
// Non-fatal either way — the send path degrades per contract regardless.
function init() {
  if (!isConfigured()) {
    console.log('[welcome-email] not configured (WELCOME_SMTP_USER/PASS unset) — feature off');
    return;
  }
  getTransport().verify().then(function () {
    console.log('[welcome-email] SMTP transport verified as ' + process.env.WELCOME_SMTP_USER);
  }).catch(function (err) {
    console.error('[welcome-email] SMTP verify failed (sends will report failed until fixed): ' + scrub(err && err.message));
  });
}

// Defensive: strip anything that looks like a long credential-ish token from
// upstream error text before it can reach a reason string or log line.
function scrub(msg) {
  return String(msg || 'unknown').replace(/[A-Za-z0-9!@#$%^&*+=]{12,}/g, '[scrubbed]').slice(0, 200);
}

// Never throws. {sent:true} | {sent:false, reason}
async function sendWelcomeEmail(args) {
  try {
    if (!isConfigured()) return { sent: false, reason: 'not_configured' };
    var content = welcomeEmailContent(args.firstName, args.actionLink);
    var fromName = (process.env.WELCOME_FROM_NAME && String(process.env.WELCOME_FROM_NAME).trim()) || 'Justin';
    await getTransport().sendMail({
      from: '"' + fromName + '" <' + process.env.WELCOME_SMTP_USER + '>',
      to: args.email,
      subject: content.subject,
      text: content.text,
    });
    return { sent: true };
  } catch (err) {
    var reason = scrub(err && err.message);
    console.error('[welcome-email] send failed for ' + (args && args.email) + ': ' + reason);
    return { sent: false, reason: reason };
  }
}

module.exports = {
  sendWelcomeEmail: sendWelcomeEmail,
  isConfigured: isConfigured,
  init: init,
  // test surface
  _welcomeEmailContent: welcomeEmailContent,
  _isConfigured: isConfigured,
  _setTransportForTest: function (t) { _testTransport = t; _transport = null; },
};
