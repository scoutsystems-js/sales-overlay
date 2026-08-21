/**
 * THE RULE: a self-hosted @font-face file must be able to DRAW the characters
 * the page sets in that family.
 *
 * ⚠⚠ THIS GUARD EXISTS BECAUSE THE LOGIN WORDMARK AND THE WELCOME-OVERLAY TITLE
 * HAVE NEVER RENDERED IN THEIR DECLARED FACE. `archivo-expanded-700.woff2` maps
 * SPACE and "A" and nothing else; "SCOUT SYSTEMS" has no "A", so every visible
 * letter falls back to the system face. Measured three independent ways on
 * 2026-08-20 (canvas advance, DOM scrollWidth, and this file-level cmap parse)
 * and confirmed by looking at the deployed page.
 *
 * ⚠ WHY NOTHING CAUGHT IT: every check anyone had was a check on the REQUEST or
 * on the BYTES, never on the GLYPHS. `document.fonts` said 'loaded',
 * `getComputedStyle` said 'Archivo Expanded', the network said 200. All three
 * are true of a font containing no letters. See lib/woff2-coverage.js.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const { coveredCodepoints, printableAscii, missingFrom } = require('../lib/woff2-coverage');

const FONT_DIR = path.join(__dirname, '..', 'web', 'fonts');
const SAIRA = path.join(FONT_DIR, 'saira-variable-latin.woff2');
const ARCHIVO = path.join(FONT_DIR, 'archivo-expanded-700.woff2');

// The strings each face is actually asked to draw.
const WORDMARK = 'SCOUT SYSTEMS';                                  // login lockup + welcome title
const SITE_TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?%$()-—·';

test('⚠ NON-VACUITY: the parser can find characters at all', () => {
  // A parser that silently returns an empty set would make every "missing"
  // assertion below pass for the wrong reason, and a coverage guard that
  // reports total failure for every font is indistinguishable from one that
  // reports total success for every font — both are constant functions.
  const covered = coveredCodepoints(SAIRA);
  assert.ok(covered.size > 200, 'parser floor: expected >200 codepoints from Saira, got ' + covered.size);
  assert.ok(covered.has('S'.codePointAt(0)), 'parser must find a plain ASCII letter');
});

test('Saira covers everything the product sets in it', () => {
  const missing = missingFrom(SAIRA, SITE_TEXT);
  assert.deepStrictEqual(missing, [], 'Saira is missing: ' + JSON.stringify(missing));
});

test('Saira covers the wordmark too — so it is a viable wordmark face', () => {
  // Relevant to the filed "wordmark → Saira wide (wdth 125)" item: whatever else
  // that decision turns on, glyph coverage is not a blocker.
  assert.deepStrictEqual(missingFrom(SAIRA, WORDMARK), []);
});

/**
 * ⚠⚠ THIS ASSERTION PINS A KNOWN DEFECT AS PASSING, DELIBERATELY, AND IT IS NOT
 * A LICENCE. It is here so the defect is COUNTED rather than forgotten, and so
 * that ANY change to the file turns this red and forces the ruling to be made
 * rather than absorbed.
 *
 * THE RULING IT IS WAITING ON (reported 2026-08-20, not yet made):
 *   A  repair the file      — ship an Archivo Expanded 700 subset that contains
 *                             the wordmark. The lockup's k = 12.226 is already
 *                             derived FOR Archivo, so the geometry is correct
 *                             and would finally be describing the real face.
 *   B  the filed Saira item — "wordmark → Saira wide (wdth 125)", k = 10.321.
 *                             One fewer font file, and the axis is already
 *                             shipped and loading.
 *   C  keep what renders    — then DELETE the file and the @font-face, and
 *                             re-derive k for the system face. ⚠ Note this
 *                             leaves the wordmark rendering a DIFFERENT face on
 *                             every OS, which is why it is not the free option.
 *
 * ⚠ WHEN THE RULING LANDS, REPLACE THIS TEST — do not delete it. The rule at the
 * top of the file is the thing worth keeping; only the exemption is temporary.
 */
test('⚠ KNOWN DEFECT, PINNED: the Archivo file cannot draw the wordmark', () => {
  const missing = missingFrom(ARCHIVO, WORDMARK);
  assert.deepStrictEqual(
    missing.join(''), 'SCOUTYEM',
    'The Archivo coverage changed. If the file was repaired, this test has done its job — '
    + 'remove the exemption and assert full coverage. Missing now: ' + JSON.stringify(missing)
  );

  // The positive form of the same fact, so a reader sees the scale of it.
  assert.strictEqual(printableAscii(ARCHIVO), ' A',
    'Archivo printable coverage is expected to be exactly space and "A"');
});

test('the wordmark string is the one the pages actually render', () => {
  // ⚠ A coverage guard aimed at the wrong string proves nothing. Anchor it to
  // the real markup — both surfaces build "SCOUT SYSTEMS" with the O replaced by
  // an inline SVG, so the LETTERS in the DOM are "SC" + "UT SYSTEMS".
  const login = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');
  const dash = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.ok(login.includes('>SC<span class="brand-o"'), 'login lockup markup changed');
  assert.ok(login.includes('UT SYSTEMS</div>'), 'login lockup tail changed');
  assert.ok(dash.includes('UT SYSTEMS</div>'), 'welcome title tail changed');

  // every letter the markup contains must be in the string this test checks
  for (const ch of 'SCUTSYSTEMS') {
    assert.ok(WORDMARK.includes(ch), 'wordmark test string is missing ' + ch);
  }
});

test('both self-hosted faces are declared by BOTH pages that use them', () => {
  // ⚠ The welcome overlay carries its own @font-face because it is a different
  // document from login.html. If one page drops a declaration the other keeps
  // working, so this cannot be caught by looking at either page alone.
  const login = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');
  const dash = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  for (const [name, src] of [['login', login], ['dashboard', dash]]) {
    assert.ok(src.includes("font-family: 'Saira'"), name + ' lost its Saira @font-face');
    assert.ok(src.includes("font-family: 'Archivo Expanded'"), name + ' lost its Archivo @font-face');
    assert.ok(src.includes('/fonts/saira-variable-latin.woff2'), name + ' lost the Saira file');
    assert.ok(src.includes('/fonts/archivo-expanded-700.woff2'), name + ' lost the Archivo file');
  }
});
