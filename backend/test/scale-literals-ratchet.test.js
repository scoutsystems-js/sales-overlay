'use strict';
/**
 * ⚠⚠ WEIGHTS AND RADII ARE TOKENS, NEVER LITERALS (Justin's rulings, 2026-09-03, H689).
 * The 600 nav weight and the 700 family came down to the scale's three; the seven
 * radii collapsed to the three ruled tokens; pills (99/999px) and circles (50%)
 * are shapes and stay. This ratchets every literal in the dashboard's stylesheet
 * AND its render strings, the confirm/prompt dialog's CSS string, and the shared
 * stylesheet at ZERO — a `font-weight: 600` or a `border-radius: 6px` anywhere in
 * them fails the suite. `--radius-md`, a token that never existed, is asserted gone.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./helpers/strip-comments');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const SOURCES = { 'dashboard.html': stripComments(read('dashboard.html')), 'js/scout-modal.js': stripComments(read('js/scout-modal.js')), 'css/style.css': stripComments(read('css/style.css')) };

test('⚠⚠ no literal font-weight above 300 anywhere — only the three tokens (the @font-face range is the one non-declaration)', () => {
  for (const [f, src] of Object.entries(SOURCES)) {
    const lit = [...src.matchAll(/font-weight:\s*(\d{3}|bold|bolder)\s*[;'"}]/g)].map((m) => m[0]);
    assert.deepStrictEqual(lit, [], f + ' literal weights: ' + lit.join(', '));
    assert.ok(/font-weight:\s*var\(--fw-/.test(src), f + ' floor: the tokens are used');
  }
});

test('⚠⚠ no literal px radius anywhere except pills and zero — only the three tokens', () => {
  for (const [f, src] of Object.entries(SOURCES)) {
    const lit = [...src.matchAll(/border-radius:\s*([^;'"}]+)[;'"}]/g)].map((m) => m[1].trim())
      .filter((v) => !/^var\(/.test(v) && /\d+px/.test(v) && !/^(999|99)px$/.test(v) && !/^0(px)?$/.test(v));   /* a var() with a px fallback is a token, not a literal */
    assert.deepStrictEqual(lit, [], f + ' literal radii: ' + lit.join(' | '));
  }
  assert.ok(!/--radius-md/.test(SOURCES['dashboard.html']), 'the token that never existed is gone');
  const pills = (SOURCES['dashboard.html'].match(/border-radius:\s*(999|99)px/g) || []).length;
  assert.ok(pills >= 5, 'floor: the pills are still pills (' + pills + ')');
});
