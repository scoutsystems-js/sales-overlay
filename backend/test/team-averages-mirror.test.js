/**
 * The inline dashboard copies of the team-averages maths must not drift from
 * lib/team-averages.js. Same discipline as the section-breakdown, tile-metrics
 * and (retired) rep-gauges mirrors.
 *
 * ⚠⚠ THIS PINS GEOMETRY, NOT JUST THRESHOLDS — the lesson from the last gauge
 * rebuild. A module on a 240° sweep rendering against a 180° face places the
 * needle where the colours mean something else, WITH NO ERROR AND NO FAILING
 * TEST. Anything that changes what is DRAWN is pinned here: sweep, segment
 * count, segment gap, every target and every scale. "It's only styling" is not
 * an exemption — the lit-segment count IS the claim the dial makes.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../lib/team-averages');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// Comments stripped: this codebase archives replaced code in place, so the OLD
// gauge constants still exist verbatim in a /* */ block a few lines above the
// new ones. Matching the raw file would read the retired values.
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

function liveNumber(name) {
  const m = LIVE.match(new RegExp('var\\s+' + name + '\\s*=\\s*(-?[\\d.]+)'));
  assert.ok(m, 'inline constant not found (renamed or removed?): ' + name);
  return parseFloat(m[1]);
}

test('⚠ GEOMETRY is mirrored — sweep, segment count and gap', () => {
  assert.strictEqual(liveNumber('AVG_SWEEP_DEG'), A.SWEEP_DEG);
  assert.strictEqual(liveNumber('AVG_SEGMENT_COUNT'), A.SEGMENT_COUNT);
  assert.strictEqual(liveNumber('AVG_SEGMENT_GAP'), A.SEGMENT_GAP_DEG);
});

test('the render reads targets and scales from the SERVER, not from a second copy', () => {
  // The strongest possible mirror: there is nothing to drift, because the inline
  // render never restates the numbers. If someone reintroduces a hard-coded
  // target in the browser, this fails.
  ['25', '35', '60', '50', '90', '100'].forEach(function () { /* see below */ });
  const forbidden = [
    /var\s+AVG_[A-Z_]*TARGET/, /var\s+AVG_[A-Z_]*SCALE/,
    /AVG_CLOSING_TARGET/, /AVG_OBJECTION_TARGET/, /AVG_CALLTIME_TARGET/,
  ];
  forbidden.forEach(function (re) {
    assert.ok(!re.test(LIVE),
      'a target/scale was hard-coded in the browser: ' + re + ' — they must come from /team/averages '
      + 'so the dial cannot disagree with the number the server pooled');
  });
  // and the values themselves live in the module
  assert.strictEqual(A.METRICS.closing.target, 25);
  assert.strictEqual(A.METRICS.objections.target, 35);
  assert.strictEqual(A.METRICS.calltime.target, 60);
  assert.strictEqual(A.METRICS.calltime.scale, 90);
});

test('the inline band split matches the module', () => {
  // avgBand hard-codes 0.6; if MID_BAND_FRACTION ever moves, this catches it.
  assert.strictEqual(A.MID_BAND_FRACTION, 0.6);
  const m = LIVE.match(/function avgBand\([\s\S]{0,320}?\n  \}/);
  assert.ok(m, 'avgBand not found in the live source');
  assert.ok(m[0].indexOf('target * 0.6') !== -1,
    'inline avgBand no longer uses 0.6 — it must match MID_BAND_FRACTION');
});

test('the inline lit-count matches the module across the whole scale', () => {
  const at = LIVE.indexOf('function avgLitCount');
  assert.ok(at > 0, 'avgLitCount not found');
  const end = LIVE.indexOf('\n  }', at);
  const src = LIVE.slice(at, end + 4);
  assert.ok(src.length > 150 && src.length < 900, 'slice suspicious: ' + src.length);

  // Rebuild the inline function in isolation and compare it to the module at
  // every whole value of each metric's scale, plus the edge cases.
  const inline = new Function(
    'AVG_SEGMENT_COUNT',
    'function avgFraction(value, scale){var v=(typeof value==="number"&&isFinite(value))?value:0;'
    + 'var s=(scale>0)?scale:100;return Math.max(0,Math.min(1,v/s));}\n'
    + src + '\nreturn avgLitCount;')(A.SEGMENT_COUNT);

  A.METRIC_ORDER.forEach(function (key) {
    const scale = A.METRICS[key].scale;
    for (let v = 0; v <= scale + 5; v += 0.5) {
      assert.strictEqual(inline(v, scale), A.litCount(v, scale),
        key + ' lit-count drift at value ' + v);
    }
  });
  [null, undefined, NaN, -3, 'x'].forEach(function (v) {
    assert.strictEqual(inline(v, 100), A.litCount(v, 100), 'drift on ' + String(v));
  });
});

test('⚠ NON-VACUITY — the lit-count comparison catches a deliberately wrong render', () => {
  // A 40-segment module against a 39-segment render is the exact silent failure
  // this file exists for: no error, a plausible dial, a wrong claim.
  let differed = false;
  for (let v = 1; v <= 100; v += 1) {
    const wrong = Math.max(1, Math.min(39, Math.round((v / 100) * 39)));
    if (wrong !== A.litCount(v, 100)) { differed = true; break; }
  }
  assert.ok(differed, 'the comparison must be able to see a segment-count change');
});
