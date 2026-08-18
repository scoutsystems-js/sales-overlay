/**
 * ⚠⚠ ONE COLOUR FAMILY, BY CONSTRUCTION — Justin's constraint on the gauges
 * (2026-08-18): "whatever sharpness/shade treatment that green gets, apply the
 * SAME treatment to yellow and red so all three read as one family." Three
 * separately hand-picked dim shades is what made the previous dials cartoony.
 *
 * The enforcement is structural rather than aesthetic: every gauge shade is
 * rgba(var(--<band>-rgb), α) at a SHARED alpha, so the bands cannot drift apart
 * unless someone edits all three together and this test notices.
 *
 * ⚠ AND THIS IS THE SECOND TIME THE CHANNEL FORM HAS BEEN NEEDED. rgba() cannot
 * read a hex custom property, so before --accent-rgb existed all 23 accent tints
 * were hard-coded copies of the OLD blue that did not move when --accent did —
 * and a hex-only grep reported the change as complete. Same failure, same fix.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

function hexOf(token) {
  const m = LIVE.match(new RegExp('--' + token + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token not found: --' + token);
  return m[1].toLowerCase();
}
function rgbOf(token) {
  const m = LIVE.match(new RegExp('--' + token + '-rgb:\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)'));
  assert.ok(m, 'channel token not found: --' + token + '-rgb');
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const BANDS = ['good', 'mid', 'bad'];

test('each band\'s channel triple is the SAME COLOUR as its hex token', () => {
  BANDS.forEach(function (b) {
    assert.deepStrictEqual(rgbOf(b), hexToRgb(hexOf(b)),
      '--' + b + '-rgb has drifted from --' + b + ' — every dim gauge shade is now the wrong hue');
  });
});

test('⚠ the gauge green is EXACTLY the Scout accent, not an approximation', () => {
  assert.strictEqual(hexOf('good'), hexOf('accent'));
  assert.deepStrictEqual(rgbOf('good'), rgbOf('accent'));
});

test('⚠⚠ all three bands get the SAME treatment at the SAME alpha', () => {
  // The family property: for each gauge shade, the three bands must appear with
  // an identical alpha. A hand-tuned "just the yellow" value fails here.
  [
    { role: 'unlit segment', re: /\.avg-seg-off-([a-z]+)\s*\{\s*stroke:\s*rgba\(var\(--\1-rgb\),\s*([\d.]+)\)/g },
    { role: 'inner echo',    re: /\.avg-echo-([a-z]+)\s*\{\s*stroke:\s*rgba\(var\(--\1-rgb\),\s*([\d.]+)\)/g },
    // The glow added when the levels were raised — it is a shade role like any
    // other and must not become "just the green gets a halo".
    { role: 'lit glow',      re: /\.avg-seg-on-([a-z]+)\s*\{[^}]*drop-shadow\(0 0 5px rgba\(var\(--\1-rgb\),\s*([\d.]+)\)\)/g },
  ].forEach(function (shade) {
    const found = {};
    let m;
    while ((m = shade.re.exec(LIVE)) !== null) found[m[1]] = m[2];
    assert.deepStrictEqual(Object.keys(found).sort(), BANDS.slice().sort(),
      shade.role + ': every band must define this shade, got ' + JSON.stringify(found));
    const alphas = BANDS.map(function (b) { return found[b]; });
    assert.strictEqual(new Set(alphas).size, 1,
      shade.role + ': the three bands use DIFFERENT alphas ' + JSON.stringify(found)
      + ' — that is the hand-picked-shade drift this rule exists to prevent');
  });
});

test('the LIT segment is the band token itself — full strength, no approximation', () => {
  BANDS.forEach(function (b) {
    assert.ok(new RegExp('\\.avg-seg-on-' + b + '\\s*\\{\\s*stroke:\\s*var\\(--' + b + '\\)').test(LIVE),
      '.avg-seg-on-' + b + ' must use var(--' + b + ') directly');
  });
});

test('⚠ the gauges use SEMANTIC colours only — the categorical ramp stays out', () => {
  const at = LIVE.indexOf('.avg-section');
  const end = LIVE.indexOf('.team-controls-row', at);
  assert.ok(at > 0 && end > at, 'gauge CSS block not found');
  const css = LIVE.slice(at, end);
  assert.ok(css.length > 800, 'CSS slice suspicious: ' + css.length);
  // The rep line ramp, which must never appear on this panel.
  ['#22d3ee', '#a78bfa', '#f472b6', '#60a5fa', '#2dd4bf', '#c4b5fd', '#67e8f9', '--purple', '--orange']
    .forEach(function (c) {
      assert.strictEqual(css.indexOf(c), -1,
        'categorical colour ' + c + ' appears in the gauge CSS — semantic only');
    });
});

test('⚠ NON-VACUITY — the family check catches a hand-tuned single band', () => {
  // ⚠ ANCHOR: derived from the LIVE value rather than hard-coded, so raising the
  // shared alpha (0.28 → 0.52 on 2026-08-18) cannot silently empty this check.
  // A literal here is exactly the stale-anchor trap recorded three times over.
  const cur = LIVE.match(/\.avg-echo-mid\s*\{\s*stroke:\s*rgba\(var\(--mid-rgb\),\s*([\d.]+)\)/);
  assert.ok(cur, 'non-vacuity anchor is stale — the .avg-echo-mid rule was renamed');
  const broken = LIVE.replace(cur[0], cur[0].replace(cur[1], String(Number(cur[1]) + 0.16)));
  assert.notStrictEqual(broken, LIVE, 'the replace must actually change something');
  const re = /\.avg-echo-([a-z]+)\s*\{\s*stroke:\s*rgba\(var\(--\1-rgb\),\s*([\d.]+)\)/g;
  const found = {}; let m;
  while ((m = re.exec(broken)) !== null) found[m[1]] = m[2];
  assert.strictEqual(new Set(BANDS.map((b) => found[b])).size, 2,
    'the check must see a single band drifting, or it proves nothing');
});
