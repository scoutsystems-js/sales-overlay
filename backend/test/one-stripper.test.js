'use strict';
/* ⚠⚠ ONE STRIPPER (fix #5, H682). Sweep block 5 found 112 private comment-strippers
   in this suite: 99 swallowed code after a slash-star inside a string, 15 had the
   block-first ordering defect that hid 42 lines of the dashboard (the ?user= pivot
   restore and the role check) from eleven tests, 3 cut every "://". The shared
   helper is now string-aware and every converted test requires it. This guard:
     1. EXECUTES the shared stripper against the five killers — a `//` inside a
        string, an apostrophe in prose, a slash-star inside a line comment, a
        slash-star inside a string, a star-slash inside a string — and against the
        live dashboard (the region behind `/admin/*` must be visible);
     2. pins that every test file requiring the helper carries NO private form;
     3. ratchets the count of files still carrying a private form — it may fall,
        never rise. A 125th copy fails here. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const KILLERS = [
  ['K1 a // inside a string', "var u = 'http://x.y/z'; // trailing\nvar k = 1;", ["var u = 'http://x.y/z';", 'var k = 1;']],
  ['K2 an apostrophe in prose before code', "// don't strip the next line\nvar a = 1;\n/* it's a block */\nvar b = 'http://h'; var c = 2;", ['var a = 1;', "var b = 'http://h';", 'var c = 2;']],
  ['K3 a slash-star inside a LINE comment (the /admin/* shape)', "// a line with /* inside\nvar c = 3;\nvar d = 4; /* real block */\nvar e = 5;", ['var c = 3;', 'var d = 4;', 'var e = 5;']],
  ['K4 a slash-star inside a STRING', "var g = \"/* not a comment\";\nvar h = 6;\n/* real */\nvar i = 7;", ['var g = "/* not a comment";', 'var h = 6;', 'var i = 7;']],
  ['K5 a star-slash inside a string', "var s = 'a */ b'; /* c */\nvar t = 8;", ["var s = 'a */ b';", 'var t = 8;']],
];
KILLERS.forEach(([name, src, keep]) => {
  test('⚠⚠ EXECUTED: the shared stripper loses no code on ' + name, () => {
    const out = stripComments(src);
    keep.forEach((line) => assert.ok(out.indexOf(line) !== -1, 'lost: ' + line));
  });
});
test('⚠ EXECUTED: the trailing option drops a comment after code but keeps a // inside a string, and blankComments keeps every offset', () => {
  assert.strictEqual(stripComments("var u = 'http://x'; // t\nvar k = 1;", { trailing: true }), "var u = 'http://x'; \nvar k = 1;");
  const { blankComments } = require('./helpers/strip-comments');
  const src = "var a = 1; /* gone */\n// gone too\nvar b = 'http://y';";
  const b = blankComments(src);
  assert.strictEqual(b.length, src.length, 'same length'); assert.strictEqual(b.indexOf("var b = 'http://y';"), src.indexOf("var b = 'http://y';"), 'same offset');
  assert.ok(!/gone/.test(b));
});
test('⚠⚠ EXECUTED on the live dashboard: the 42 lines behind `/admin/*` are visible, and the script still parses', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const out = stripComments(raw);
  assert.ok(out.indexOf("var target = params.get('user');") !== -1, 'the ?user= pivot restore must survive stripping');
  assert.ok(/state\.me\.role === 'manager' \|\| state\.me\.role === 'admin' \|\| state\.me\.role === 'owner'/.test(out), 'the role check must survive stripping');
  const js = [...out.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n;\n');
  new Function(js.replace(/^\s*'use strict';/m, '')); /* throws on a syntax error — a stripper that cut mid-string would leave one */
});
const PRIVATE = [/replace\(\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/, /\^\\s\*\\\/\\\/.*filter\(/, /indexOf\('\/\/'\) !== 0/, /replace\(\/\\\/\\\/\.\*\/g/, /replace\(\/\\\/\\\/\[\^\\n\]\*\/g/, /replace\(\/\\\/\\\/\.\*\$\/gm/];
function hasPrivateForm(src) { const code = src.replace(/^\s*\/\/.*$/gm, ''); return PRIVATE.some((re) => re.test(code)); }
const FILES = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f !== 'one-stripper.test.js');
const RATCHET = 112;  // 123 on 2026-09-02 after the stopped mechanical run (H682); the eleven blind files were hand-converted the same day (H684); lower it as more land
test('⚠ the count of test files carrying a private stripper may FALL, never rise (ratchet ' + RATCHET + ')', () => {
  const left = FILES.filter((f) => hasPrivateForm(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.ok(left.length <= RATCHET, 'a new private stripper appeared: ' + left.length + ' > ' + RATCHET + ' — ' + left.join(', '));
});
const BOTH_RATCHET = 0;   // files that require the helper AND still carry a private form on 2026-09-02; lower it as they are hand-converted
test('⚠ files carrying BOTH the shared helper and a private form may fall, never rise (ratchet ' + BOTH_RATCHET + ')', () => {
  const both = FILES.filter((f) => { const s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return /require\(['"]\.\/helpers\/strip-comments['"]\)/.test(s) && hasPrivateForm(s); });
  assert.ok(both.length <= BOTH_RATCHET, 'a private stripper appeared beside the shared one: ' + both.length + ' > ' + BOTH_RATCHET + ' — ' + both.join(', '));
});
