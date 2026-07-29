// Welcome-email tests (manual user creation, Resend HTTPS transport).
// Contracts under test:
//   • exact content per Justin's spec (subject "Your Scout login", plain text)
//   • RESEND_API_KEY absent = feature silently off (not_configured, no fetch)
//   • failure NEVER throws out of sendWelcomeEmail (KB/digest isolation)
//   • hard 10s bound on the HTTP call — the 2-minute hang class is dead
//   • no key/token in reasons or anything a caller might log
const test = require('node:test');
const assert = require('node:assert');
const we = require('../lib/welcome-email');

const LINK = 'https://vkprybqmryiuwbdwdlpk.supabase.co/auth/v1/verify?token=pkce_SECRETTOKEN123456&type=recovery&redirect_to=https://www.scoutsystems.io/set-password';
const ARGS = { firstName: 'Tasha', email: 'tasha@example.com', actionLink: LINK };

test('content: exact plain-text body and subject per spec (set-password link, no credential)', () => {
  const c = we._welcomeEmailContent(ARGS.firstName, ARGS.actionLink);
  assert.strictEqual(c.subject, 'Your Scout login');
  assert.strictEqual(c.text,
    'Hi Tasha,\n' +
    '\n' +
    'Your Scout account is ready. Click here to set your password and\n' +
    'get started: ' + LINK + '\n' +
    '\n' +
    "Once you're in, connect your recording source (Zoom or Fathom) so\n" +
    'Scout can start grading your calls.\n' +
    '\n' +
    "If anything isn't working, just reply to this email.\n" +
    '\n' +
    '— Justin');
  assert.ok(!/password:/i.test(c.text.replace('set your password','')), 'no credential lines in the body');
});

test('isConfigured: RESEND_API_KEY present and non-blank', () => {
  assert.strictEqual(we._isConfigured({ RESEND_API_KEY: 're_123' }), true);
  assert.strictEqual(we._isConfigured({ RESEND_API_KEY: '   ' }), false); // blank = off
  assert.strictEqual(we._isConfigured({}), false);
  // legacy SMTP vars alone no longer configure the feature
  assert.strictEqual(we._isConfigured({ WELCOME_SMTP_USER: 'a@b.c', WELCOME_SMTP_PASS: 'x' }), false);
});

test('send: not configured → {sent:false, reason:"not_configured"}, fetch never touched', async () => {
  we._setFetchForTest(async () => { throw new Error('must not be called'); });
  const save = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.deepStrictEqual(r, { sent: false, reason: 'not_configured' });
  } finally {
    if (save !== undefined) process.env.RESEND_API_KEY = save;
    we._setFetchForTest(null);
  }
});

test('send: success path POSTs the Resend payload — from/to/subject/text', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  let gotUrl = null, gotOpts = null;
  we._setFetchForTest(async (url, opts) => { gotUrl = url; gotOpts = opts; return { ok: true, status: 200, json: async () => ({ id: 'x' }) }; });
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.deepStrictEqual(r, { sent: true });
    assert.strictEqual(gotUrl, 'https://api.resend.com/emails');
    assert.strictEqual(gotOpts.method, 'POST');
    assert.strictEqual(gotOpts.headers['Authorization'], 'Bearer re_test_key');
    const body = JSON.parse(gotOpts.body);
    assert.strictEqual(body.from, 'Justin <justin@scoutsystems.io>');
    assert.strictEqual(body.to, ARGS.email);
    assert.strictEqual(body.subject, 'Your Scout login');
    assert.ok(body.text.includes('get started: ' + ARGS.actionLink));
    assert.ok(gotOpts.signal, 'timeout signal must be wired');
  } finally {
    we._setFetchForTest(null);
    delete process.env.RESEND_API_KEY;
  }
});

test('send: hard timeout bound — a hanging HTTP call resolves failed within the bound, never minutes', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  we._setTimeoutForTest(60); // 60ms bound for the test; production constant is 10s
  we._setFetchForTest((url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    // never resolves otherwise — simulates a blackholed connection
  }));
  const t0 = Date.now();
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    const elapsed = Date.now() - t0;
    assert.strictEqual(r.sent, false);
    assert.ok(elapsed < 2000, 'must resolve near the bound, got ' + elapsed + 'ms');
  } finally {
    we._setFetchForTest(null);
    we._setTimeoutForTest(null);
    delete process.env.RESEND_API_KEY;
  }
});

test('send: non-2xx API response → failed with scrubbed reason', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  we._setFetchForTest(async () => ({ ok: false, status: 422, json: async () => ({ message: 'domain not verified for re_test_key_echoed_back_1234' }) }));
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.strictEqual(r.sent, false);
    assert.ok(/422/.test(r.reason), 'reason carries the HTTP status');
    assert.ok(!r.reason.includes('re_test_key_echoed_back_1234'), 'reason must scrub echoed keys');
  } finally {
    we._setFetchForTest(null);
    delete process.env.RESEND_API_KEY;
  }
});

test('send: fetch throw is swallowed — {sent:false}, reason NEVER contains the link token', async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  we._setFetchForTest(async () => { throw new Error('network reset, request body was: ' + ARGS.actionLink); });
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.strictEqual(r.sent, false);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    assert.ok(!r.reason.includes('SECRETTOKEN'), 'reason must scrub the action-link token even if the error echoes it');
  } finally {
    we._setFetchForTest(null);
    delete process.env.RESEND_API_KEY;
  }
});
