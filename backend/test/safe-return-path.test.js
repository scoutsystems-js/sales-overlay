// Tests for safeReturnPath — the open-redirect guard behind the /connect ->
// /login?return=... flow. Security-critical: a crafted `return` value must NEVER
// send a user to an off-site or scheme-based URL after login. Anything that isn't
// a plain same-origin absolute path falls back to the caller's default.
//
// This is the CANONICAL copy of the logic. The identical function is inlined into
// login.html + connect.html (static pages can't require() a Node module); keep the
// three in sync — this test is the contract they all satisfy.
const test = require('node:test');
const assert = require('node:assert');
const safeReturnPath = require('../lib/safe-return-path');

const FALLBACK = '/dashboard';

test('accepts a plain same-origin absolute path', () => {
  assert.strictEqual(safeReturnPath('/dashboard', FALLBACK), '/dashboard');
  assert.strictEqual(safeReturnPath('/eod', FALLBACK), '/eod');
});

test('preserves an internal hash fragment (the #connect target)', () => {
  assert.strictEqual(safeReturnPath('/dashboard#connect', FALLBACK), '/dashboard#connect');
  assert.strictEqual(safeReturnPath('/dashboard?user=x#account', FALLBACK), '/dashboard?user=x#account');
});

test('rejects protocol-relative URLs (//host and /\\host)', () => {
  assert.strictEqual(safeReturnPath('//evil.com', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('/\\evil.com', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('/\/evil.com', FALLBACK), FALLBACK); // '/' + '/'
});

test('rejects absolute URLs with a scheme', () => {
  assert.strictEqual(safeReturnPath('https://evil.com', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('http://evil.com/path', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('javascript:alert(1)', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('data:text/html,x', FALLBACK), FALLBACK);
});

test('rejects paths that do not start with a single slash', () => {
  assert.strictEqual(safeReturnPath('dashboard', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('./dashboard', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('../etc', FALLBACK), FALLBACK);
});

test('rejects control chars / whitespace (newline, tab, space, NUL)', () => {
  assert.strictEqual(safeReturnPath('/dash\nboard', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('/dash board', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('/dash\tboard', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('/dash\x00board', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('\t//evil.com', FALLBACK), FALLBACK);
});

test('falls back on empty / missing / non-string input', () => {
  assert.strictEqual(safeReturnPath('', FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath(null, FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath(undefined, FALLBACK), FALLBACK);
  assert.strictEqual(safeReturnPath('/', FALLBACK), FALLBACK); // bare root is pointless — use fallback
  assert.strictEqual(safeReturnPath(42, FALLBACK), FALLBACK);
});
