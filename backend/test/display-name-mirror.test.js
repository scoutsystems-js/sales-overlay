/**
 * ONE display-name resolver, mirrored into the page.
 *
 * ⚠ THE BUG THIS CLOSES: the module existed with exactly ONE consumer while nine
 * other call sites wrote their own `email.split('@')[0]`. The same person read
 * "Joshua Pinner" on one screen and "josh" on another — Justin: "it's hard to
 * tell what's what for the person." Nothing errored; the name was simply
 * different depending on which surface you were looking at.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/display-name');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
/**
 * ⚠⚠ LINE COMMENTS ARE STRIPPED **FIRST**, AND THE ORDER IS LOAD-BEARING.
 * Stripping block comments first treats a `/*` that appears INSIDE a `//` line
 * as a real comment opener. routes/team.js begins:
 *
 *     // /team/* — v1.4 Manager view. Gated to manager+owner...
 *                      ^^ this is not a comment opener, but a block-first
 *                         stripper reads it as one
 *
 * That file contained NO closing delimiter at all, so the lazy regex never
 * matched and this test passed — by luck, not by correctness. The first closing
 * delimiter added to team.js (a JSDoc block, 2026-08-18) instantly swallowed the
 * first 200 lines INCLUDING the display-name import, and this guard failed
 * claiming the resolver was not imported when it plainly was.
 *
 * (Writing this note also broke the file once, by quoting a closing delimiter
 * inside the block comment explaining closing delimiters. Hence the words.)
 *
 * Line-comments-first is correct in both orders of appearance and costs nothing.
 */
const strip = (raw) => raw.split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = strip(read('web/dashboard.html'));

test('precedence: stored name → Title-Cased local-part → id stub', () => {
  assert.strictEqual(D.resolveDisplayName({ first_name: 'Joshua', last_name: 'Pinner' }, 'josh@x.io', 'u1'), 'Joshua Pinner');
  assert.strictEqual(D.resolveDisplayName({ last_name: 'Pinner' }, 'josh@x.io', 'u1'), 'Pinner', 'a last name alone still wins over the handle');
  assert.strictEqual(D.resolveDisplayName(null, 'josh@scoutsystems.io', 'u1'), 'Josh');
  assert.strictEqual(D.resolveDisplayName(null, 'demo-ava@scout-demo.dev', 'u1'), 'Demo Ava');
  assert.strictEqual(D.resolveDisplayName(null, null, 'abcdef1234'), 'abcdef12');
});

test('⚠ NEVER a raw lowercase handle', () => {
  ['josh@x.io', 'demo-ava@y.io', 'ava.mitchell@y.io', 'j_smith@y.io'].forEach(function (e) {
    const out = D.resolveDisplayName(null, e, 'u');
    assert.ok(/^[A-Z]/.test(out), e + ' → ' + out + ' must not start lowercase');
    assert.ok(out.indexOf('-') === -1 && out.indexOf('_') === -1 && out.indexOf('.') === -1,
      e + ' → ' + out + ' must not keep handle punctuation');
  });
});

test("the owner's own capitalisation survives past the first letter", () => {
  // Forcing the rest lower would give "Mccarthy"; forcing it upper gives "MCCARTHY".
  assert.strictEqual(D.titleCaseHandle('mcCarthy'), 'McCarthy');
});

test('⚠ EVERY rep-naming site routes through the module — none re-rolls its own', () => {
  const SITES = ['lib/team-analytics.js', 'lib/team-needs-work.js', 'lib/team-digest.js',
                 'lib/team-synthesis.js', 'routes/team.js'];
  SITES.forEach(function (f) {
    const src = strip(read(f));
    assert.ok(/require\('\.\.?\/(lib\/)?display-name'\)/.test(src), f + ' must import the resolver');
    assert.strictEqual((src.match(/split\('@'\)\[0\]/g) || []).length, 0,
      f + ' still builds a name from a raw local-part');
  });
  // ⚠ analysis-worker is DELIBERATELY exempt: its local-part is matched against a
  // transcript display name to decide who the CLOSER is. That is an identity
  // comparison, not a label — title-casing it would break the match.
  assert.ok(/split\('@'\)\[0\]/.test(strip(read('lib/analysis-worker.js'))),
    'the speaker-identity match must keep its raw local-part');
});

test('the inline copy agrees with the module on real inputs', () => {
  const at = HTML.indexOf('function titleCaseHandle');
  assert.ok(at !== -1, 'the page must carry the mirror');
  const end = HTML.indexOf('function repName', at);
  const src = HTML.slice(at, HTML.indexOf('\n  }', end) + 4);
  assert.ok(src.length > 400 && src.length < 4000, 'slice must cover the mirror: ' + src.length);
  const fn = new Function(src + '; return { personName: personName, titleCaseHandle: titleCaseHandle };')();
  [[null, 'josh@scoutsystems.io'], [null, 'demo-ava@scout-demo.dev'],
   [{ first_name: 'Ava', last_name: 'Mitchell' }, 'demo-ava@scout-demo.dev'],
   [{ first_name: '', last_name: '' }, 'j_smith@y.io']].forEach(function (c) {
    assert.strictEqual(fn.personName(c[0], c[1], 'u1'), D.resolveDisplayName(c[0], c[1], 'u1'),
      JSON.stringify(c));
  });
  assert.strictEqual(fn.titleCaseHandle('mcCarthy'), D.titleCaseHandle('mcCarthy'));
});

// ── write-time normalisation (ruling 2026-08-17) ──────────────────────────
test('names are normalised ON THE WAY IN, not at render', () => {
  assert.strictEqual(D.normalizeName('josh'), 'Josh');
  assert.strictEqual(D.normalizeName('ava mitchell'), 'Ava Mitchell');
  assert.strictEqual(D.normalizeName('  ben   kowalski '), 'Ben Kowalski');
  assert.strictEqual(D.normalizeName(''), '');
  assert.strictEqual(D.normalizeName(null), '');
});

test("⚠ A NAME THE PERSON CAPITALISED IS LEFT EXACTLY AS TYPED", () => {
  // This is what protects the names a scheme would ruin. The escape hatch for
  // "McDonald" is that the user types it and we do not touch it.
  ['McDonald', 'de Vries', "O'Brien", 'van der Berg', 'JJ'].forEach(function (n) {
    assert.strictEqual(D.normalizeName(n), n, n + ' must survive untouched');
  });
});

test('hyphen and apostrophe parts capitalise; Mc is a STATED limitation', () => {
  assert.strictEqual(D.normalizeName('mary-jane'), 'Mary-Jane');
  assert.strictEqual(D.normalizeName("o'brien"), "O'Brien");
  // ⚠ Known wrong, and deliberately so — see the comment in lib/display-name.js.
  // Asserted so nobody "fixes" it silently and nobody is surprised by it.
  assert.strictEqual(D.normalizeName('mcdonald'), 'Mcdonald');
});

test('BOTH write points normalise — there are exactly two', () => {
  const strip2 = (rel) => strip(read(rel));
  const admin = strip2('routes/admin.js');
  assert.ok(/normalizeName\(body\.first_name\)/.test(admin), 'admin create-user must normalise');
  assert.ok(/normalizeName\(body\.last_name\)/.test(admin));
  const me = strip2('routes/me.js');
  assert.ok(/updates\.first_name = normalizeName/.test(me), 'self-edit must normalise');
  assert.ok(/updates\.last_name = normalizeName/.test(me));
});
