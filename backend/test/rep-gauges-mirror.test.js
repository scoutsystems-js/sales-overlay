/**
 * The gauge panel exists TWICE — `lib/rep-gauges.js` (the definition) and an
 * inline copy in dashboard.html (the render, since the page has no module
 * system). Same pattern as tile-metrics-mirror and section-breakdown-mirror.
 *
 * ⚠ THE DRIFT THIS CATCHES IS SILENT. If the inline target says 50 and the lib
 * says 35, the dial's BANDS come from one and any server-side reasoning from the
 * other — and both render without error. The panel would simply be wrong about
 * which reps are failing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/rep-gauges');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

function inlineConst(name) {
  const m = LIVE.match(new RegExp('var\\s+' + name + '\\s*=\\s*([0-9.]+)'));
  assert.ok(m, name + ' must be defined inline in dashboard.html');
  return parseFloat(m[1]);
}

test('every ruled number matches the module — one target, not two', () => {
  assert.strictEqual(inlineConst('GAUGE_OBJECTION_TARGET_PCT'), G.OBJECTION_TARGET_PCT);
  assert.strictEqual(inlineConst('GAUGE_OBJECTION_SCALE_MAX'), G.OBJECTION_SCALE_MAX);
  assert.strictEqual(inlineConst('GAUGE_CLOSING_TARGET_PCT'), G.CLOSING_TARGET_PCT);
  assert.strictEqual(inlineConst('GAUGE_CLOSING_SCALE_MAX'), G.CLOSING_SCALE_MAX);
  assert.strictEqual(inlineConst('GAUGE_MID_BAND_FRACTION'), G.MID_BAND_FRACTION);
  assert.strictEqual(inlineConst('GAUGE_MIN_OBJECTIONS'), G.MIN_OBJECTIONS);
  assert.strictEqual(inlineConst('GAUGE_MIN_PROSPECTS'), G.MIN_PROSPECTS);
});

test('the inline band + totals agree with the module on real shapes', () => {
  // ⚠ EXECUTE the inline copy rather than eyeballing it — the question is what
  // it COMPUTES, not what it looks like.
  const at = LIVE.indexOf('var GAUGE_OBJECTION_TARGET_PCT');
  const end = LIVE.indexOf('function gaugeMeasure');
  // +4 to INCLUDE the closing '\n  }' — slicing up to it cuts the last function's
  // brace off and the extracted source fails to parse. Same slice-boundary family
  // as the fromIndex rule: assert the length so a bad slice fails loudly.
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', end) + 4);
  assert.ok(src.length > 800 && src.length < 12000, 'slice must cover the panel maths: ' + src.length);
  const fn = new Function('escapeHtml', 'state', src +
    '; return { gaugeBand: gaugeBand, gaugeAngle: gaugeAngle, repGaugeTotals: repGaugeTotals };')(
    (x) => x, { teamGaugeMetric: 'objections' });

  [[0, 50], [29.9, 50], [30, 50], [49.9, 50], [50, 50], [72, 50], [15, 25], [25, 25]]
    .forEach(function (c) {
      assert.strictEqual(fn.gaugeBand(c[0], c[1]), G.band(c[0], c[1]), 'band(' + c.join(',') + ')');
    });
  [[0, 100], [50, 100], [100, 100], [25, 50], [120, 100], [-5, 100]].forEach(function (c) {
    assert.strictEqual(fn.gaugeAngle(c[0], c[1]), G.needleAngle(c[0], c[1]), 'angle(' + c.join(',') + ')');
  });

  const series = { reps: [
    { user_id: 'a', name: 'Ava',
      handle: [{ handled: 3, total: 6 }, { handled: 1, total: 4 }],
      close: [{ closed: 2, total: 4 }, { closed: 0, total: 3 }] },
    { user_id: 'b', name: 'Ben',
      handle: [{ handled: 0, total: 2 }], close: [{ closed: 1, total: 1 }] },
  ] };
  const inline = fn.repGaugeTotals(series);
  const lib = G.repGaugeTotals(series);
  inline.forEach(function (r, i) {
    ['objections', 'prospects'].forEach(function (k) {
      assert.strictEqual(r[k].rate, lib[i][k].rate, r.name + '.' + k + '.rate');
      assert.strictEqual(r[k].total, lib[i][k].total, r.name + '.' + k + '.total');
      assert.strictEqual(r[k].enough, lib[i][k].enough, r.name + '.' + k + '.enough');
      assert.strictEqual(r[k].reason, lib[i][k].reason, r.name + '.' + k + '.reason');
    });
  });
});

test('⚠ NON-VACUITY — a drifted target is actually caught', () => {
  // ⚠ Drift to a value the target is NOT. Hard-coding a number here means the
  // test silently stops testing the moment the real target becomes that number —
  // which is exactly what happened when the target moved 50 → 35.
  const DRIFTED = G.OBJECTION_TARGET_PCT + 7;
  const broken = LIVE.replace('var GAUGE_OBJECTION_TARGET_PCT = ' + G.OBJECTION_TARGET_PCT,
    'var GAUGE_OBJECTION_TARGET_PCT = ' + DRIFTED);
  const m = broken.match(/var\s+GAUGE_OBJECTION_TARGET_PCT\s*=\s*([0-9.]+)/);
  assert.strictEqual(parseFloat(m[1]), DRIFTED);
  assert.notStrictEqual(parseFloat(m[1]), G.OBJECTION_TARGET_PCT,
    'the matcher must see a drifted value, or this suite proves nothing');
});
