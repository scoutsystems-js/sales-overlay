/**
 * (e) — the three colour jobs must not borrow each other's hues.
 *
 *   SEMANTIC     --good / --mid / --bad   "this is good / a warning / bad"
 *   INTERACTIVE  --accent                 "you can click this"
 *   CATEGORICAL  REP_LINE_COLORS          "this is rep number four"
 *
 * The failure this guards is not a crash, it is a MISREAD: a rep line drawn in
 * the warning colour says the rep is failing, and a rep line drawn in the accent
 * says the line is clickable. Both look completely fine on screen.
 *
 * Ruling 2026-08-17 (Justin): green means clickable and nothing else, so the
 * ramp leads with cyan. Amber and rose were dropped for the mirror reason.
 *
 * ⚠ Comments are stripped before matching — this codebase archives replaced code
 * in place, so an archived block would otherwise answer for the live one.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

// ⚠ Slice with an explicit fromIndex and assert the length. Without fromIndex
// the end marker resolves to its FIRST occurrence in the file, the slice runs
// backwards, and every assertion below would run against an empty string.
function sliceRamp(src) {
  const at = src.indexOf('var REP_LINE_COLORS');
  assert.ok(at !== -1, 'REP_LINE_COLORS must exist in the served markup');
  const end = src.indexOf('];', at);
  assert.ok(end > at, 'ramp array must terminate after its declaration');
  const s = src.slice(at, end);
  assert.ok(s.length > 60 && s.length < 2000, 'slice must cover the array: ' + s.length);
  return s;
}

function hexes(s) { return (s.match(/#[0-9a-f]{6}/gi) || []).map((h) => h.toLowerCase()); }

function tokenValue(name) {
  const m = LIVE.match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})', 'i'));
  assert.ok(m, '--' + name + ' must be defined as a hex token');
  return m[1].toLowerCase();
}

const RAMP = hexes(sliceRamp(LIVE));

test('the ramp borrows NO semantic or interactive hue', () => {
  const reserved = {
    '--accent (means clickable)': tokenValue('accent'),
    '--good (means good)': tokenValue('good'),
    '--mid (means warning)': tokenValue('mid'),
    '--bad (means bad)': tokenValue('bad'),
  };
  Object.keys(reserved).forEach(function (label) {
    assert.strictEqual(
      RAMP.indexOf(reserved[label]), -1,
      'rep line colours must not include ' + reserved[label] + ' — that is ' + label
      + '. A rep drawn in it reads as a status rather than an identity.'
    );
  });
});

test('cyan leads, per the 2026-08-17 ruling', () => {
  assert.strictEqual(RAMP[0], '#22d3ee', 'first rep line must be cyan, not the accent green');
});

test('seven distinguishable hues — the consumer cycles, so a short list repeats a colour', () => {
  assert.strictEqual(RAMP.length, 7, 'seven reps need seven lines: ' + RAMP.join(','));
  assert.strictEqual(new Set(RAMP).size, 7, 'duplicate hue in the ramp: ' + RAMP.join(','));
  assert.ok(/REP_LINE_COLORS\[\s*i\s*%\s*REP_LINE_COLORS\.length\s*\]/.test(LIVE),
    'the consumer must cycle — this test asserts 7 BECAUSE it cycles');
});

test('the retired blue accent is gone from the live path — HEX **AND** rgba()', () => {
  // ⚠ THE HEX SCAN ALONE SHIPPED A DEFECT (2026-08-17). The (e) commit checked
  // for #5b9eff and found none, while the SAME blue survived as its channel
  // triple in 23 rgba() tints — several of them backgrounds sitting directly
  // under `color: var(--accent)`, i.e. green text on a blue chip, live in
  // production. A colour has more than one spelling; check every spelling.
  assert.strictEqual((LIVE.match(/#5b9eff/gi) || []).length, 0,
    '#5b9eff was the old --accent; every use must inherit var(--accent) now');
  assert.strictEqual((LIVE.match(/91\s*,\s*158\s*,\s*255/g) || []).length, 0,
    'rgba(91,158,255,…) is the old accent in channel form — use rgba(var(--accent-rgb), …)');
});

test('--accent-rgb is the SAME colour as --accent, in channels', () => {
  // rgba() cannot read a hex token, so the tints need the channels separately.
  // Two spellings of one colour can drift; this is what stops them.
  const hex = tokenValue('accent');
  const m = LIVE.match(/--accent-rgb:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  assert.ok(m, '--accent-rgb must be defined so tints can inherit the accent');
  const asHex = '#' + [m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  assert.strictEqual(asHex, hex,
    '--accent-rgb ' + m.slice(1, 4).join(',') + ' is ' + asHex + ' but --accent is ' + hex);
});

test('every soft tint inherits the accent rather than restating it', () => {
  const tints = (LIVE.match(/rgba\(\s*var\(--accent-rgb\)/g) || []).length;
  assert.ok(tints >= 20, 'expected the accent tints to inherit; found ' + tints);
});

test('⚠ NON-VACUITY — the guard fires when a reserved hue is put back in the ramp', () => {
  const broken = LIVE.replace("'#22d3ee',  // cyan", "'#4ade80',\n    '#22d3ee',  // cyan");
  const bad = hexes(sliceRamp(broken));
  assert.ok(bad.indexOf(tokenValue('accent')) !== -1,
    'the accent must be detectable in the ramp once reintroduced, or this suite proves nothing');
  assert.notStrictEqual(bad[0], '#22d3ee', 'and the leads-with-cyan check must move too');
});
