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
const WORDMARK = 'SCOUT SYSTEMS';                                  // now an image; kept as the alt text
const SITE_TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?%$()-—·';

/** ⚠ Strip comments before matching — this codebase archives removed code in
 *  place, so a raw grep reports a shipped removal as un-shipped. Line comments
 *  FIRST: a `/*` inside a `//` line is a false opener. */
function live(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '')
            .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
            .replace(/\/\*[\s\S]*?\*\//g, '');
}
function pages() {
  return [
    ['login', fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8')],
    ['dashboard', fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8')],
  ];
}

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
 * ⚠⚠ THE PINNED DEFECT IS RESOLVED — BY REMOVAL, NOT BY REPAIR (2026-08-21).
 *
 * This file used to pin, deliberately, the fact that `archivo-expanded-700.woff2`
 * could not draw "SCOUT SYSTEMS", with the three options it was waiting on
 * written into the test. Justin's ruling retired the question entirely: the
 * wordmark is his LOGO IMAGE — the mark replaces the O, so no typeface can draw
 * it — and the font, its @font-face and the whole text lockup are gone.
 *
 * ⚠ THE EXEMPTION IS REPLACED, NOT DELETED, exactly as the old note required.
 * The RULE at the top of this file is the durable part and still has a subject
 * (Saira); what changed is that the offending file no longer exists, so the
 * assertion inverts from "this is how it is broken" to "it is gone, and nothing
 * still asks for it".
 */
test('⚠ the dead Archivo file is GONE, and no page still asks for it', () => {
  assert.ok(!fs.existsSync(ARCHIVO),
    'archivo-expanded-700.woff2 is back. It maps only SPACE and "A" and can draw '
    + 'no letter of the wordmark — if a real Archivo subset is ever wanted, give it '
    + 'a different filename and assert its coverage rather than reviving this one.');

  for (const [name, src] of pages()) {
    assert.ok(!/archivo-expanded-700\.woff2/.test(live(src)),
      name + ' still requests the deleted font file');
    assert.ok(!/font-family:\s*'Archivo Expanded'/.test(live(src)),
      name + ' still declares an @font-face for a file that does not exist');
  }
});

test('⚠ the wordmark is an IMAGE on both surfaces — so no face has to cover it', () => {
  // ⚠ ANCHORED TO THE REAL MARKUP. A coverage guard aimed at a string nothing
  // renders proves nothing, and that is doubly true now the string is gone: the
  // pages carry an <img> whose alt text is the wordmark.
  for (const [name, src] of pages()) {
    const l = live(src);
    assert.ok(/src="\/scout-wordmark\.svg"/.test(l), name + ' does not load the wordmark image');
    assert.ok(/alt="Scout Systems"/.test(l), name + ' wordmark image has no/!wrong alt text');
  }
  // and the text lockup must not creep back alongside it — one logo per screen
  const [, login] = pages()[0];
  assert.ok(!/UT SYSTEMS<\/div>/.test(live(login)), 'the text lockup is back on login');
  const [, dash] = pages()[1];
  assert.ok(!/UT SYSTEMS<\/div>/.test(live(dash)), 'the text lockup is back in the overlay');
});

test('Saira is still declared and served by BOTH pages', () => {
  // ⚠ Each page carries its OWN @font-face — they are separate documents — so a
  // page dropping the declaration cannot be caught by looking at the other one.
  for (const [name, src] of pages()) {
    assert.ok(src.includes("font-family: 'Saira'"), name + ' lost its Saira @font-face');
    assert.ok(src.includes('/fonts/saira-variable-latin.woff2'), name + ' lost the Saira file');
  }
  assert.ok(fs.existsSync(SAIRA), 'the Saira file itself is missing');
});
