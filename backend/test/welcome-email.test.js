// Welcome-email tests (manual user creation). Contracts under test:
//   • exact content per Justin's spec (subject "Your Scout login", plain text)
//   • env-absent = feature silently off (not_configured, no attempt, no crash)
//   • failure NEVER throws out of sendWelcomeEmail (KB/digest isolation)
//   • the temp password appears in the email body ONLY — never in reasons,
//     errors, or anything a caller might log
const test = require('node:test');
const assert = require('node:assert');
const we = require('../lib/welcome-email');

const ARGS = { firstName: 'Tasha', email: 'tasha@example.com', tempPassword: 'Zz9SECRETzz9aA1!' };

test('content: exact plain-text body and subject per spec', () => {
  const c = we._welcomeEmailContent(ARGS.firstName, ARGS.email, ARGS.tempPassword);
  assert.strictEqual(c.subject, 'Your Scout login');
  assert.strictEqual(c.text,
    'Hi Tasha,\n' +
    '\n' +
    'Your Scout account is ready. Log in here: https://scoutsystems.io\n' +
    '\n' +
    'Email: tasha@example.com\n' +
    'Temporary password: Zz9SECRETzz9aA1!\n' +
    '\n' +
    'Please change your password after your first login. If anything\n' +
    "isn't working, just reply to this email.\n" +
    '\n' +
    '— Justin');
});

test('isConfigured: both SMTP vars required; FROM_NAME optional', () => {
  assert.strictEqual(we._isConfigured({ WELCOME_SMTP_USER: 'a@b.c', WELCOME_SMTP_PASS: 'x' }), true);
  assert.strictEqual(we._isConfigured({ WELCOME_SMTP_USER: 'a@b.c' }), false);
  assert.strictEqual(we._isConfigured({ WELCOME_SMTP_PASS: 'x' }), false);
  assert.strictEqual(we._isConfigured({ WELCOME_SMTP_USER: '  ', WELCOME_SMTP_PASS: 'x' }), false); // blank = off
  assert.strictEqual(we._isConfigured({}), false);
});

test('send: not configured → {sent:false, reason:"not_configured"}, transport never touched', async () => {
  we._setTransportForTest({ sendMail: async () => { throw new Error('must not be called'); } });
  const saveU = process.env.WELCOME_SMTP_USER, saveP = process.env.WELCOME_SMTP_PASS;
  delete process.env.WELCOME_SMTP_USER; delete process.env.WELCOME_SMTP_PASS;
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.deepStrictEqual(r, { sent: false, reason: 'not_configured' });
  } finally {
    if (saveU !== undefined) process.env.WELCOME_SMTP_USER = saveU;
    if (saveP !== undefined) process.env.WELCOME_SMTP_PASS = saveP;
    we._setTransportForTest(null);
  }
});

test('send: success path passes from/to/subject/text to the transport', async () => {
  process.env.WELCOME_SMTP_USER = 'justin@scoutsystems.io';
  process.env.WELCOME_SMTP_PASS = 'app-pass';
  process.env.WELCOME_FROM_NAME = 'Justin Schmidt';
  let got = null;
  we._setTransportForTest({ sendMail: async (opts) => { got = opts; return { messageId: 'x' }; } });
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.deepStrictEqual(r, { sent: true });
    assert.strictEqual(got.from, '"Justin Schmidt" <justin@scoutsystems.io>');
    assert.strictEqual(got.to, ARGS.email);
    assert.strictEqual(got.subject, 'Your Scout login');
    assert.ok(got.text.includes('Temporary password: ' + ARGS.tempPassword));
  } finally {
    we._setTransportForTest(null);
    delete process.env.WELCOME_SMTP_USER; delete process.env.WELCOME_SMTP_PASS; delete process.env.WELCOME_FROM_NAME;
  }
});

test('send: transport throw is swallowed — {sent:false}, reason NEVER contains the password', async () => {
  process.env.WELCOME_SMTP_USER = 'justin@scoutsystems.io';
  process.env.WELCOME_SMTP_PASS = 'app-pass';
  we._setTransportForTest({ sendMail: async () => { throw new Error('SMTP 535 auth rejected for ' + ARGS.tempPassword); } });
  try {
    const r = await we.sendWelcomeEmail(ARGS);
    assert.strictEqual(r.sent, false);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    assert.ok(!r.reason.includes(ARGS.tempPassword), 'reason must scrub the temp password even if the transport echoes it');
  } finally {
    we._setTransportForTest(null);
    delete process.env.WELCOME_SMTP_USER; delete process.env.WELCOME_SMTP_PASS;
  }
});
