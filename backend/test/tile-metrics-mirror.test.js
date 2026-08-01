// dashboard.html carries inline copies of objectionHandleRate + scoreTrend
// (browser script). Extract them and assert they behave IDENTICALLY to the
// canonical backend lib/tile-metrics.js so the mirror can't drift.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib/tile-metrics');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function extractInline() {
  const start = html.indexOf('function objectionHandleRate(needsWork) {');
  const end = html.indexOf('function tileTrendHtml(', start); // the block ends right before this
  assert.ok(start !== -1 && end > start, 'inline objectionHandleRate/scoreTrend not found');
  const src = html.slice(start, end);
  return new Function(src + '\n return { objectionHandleRate: objectionHandleRate, scoreTrend: scoreTrend };')();
}

test('inline objectionHandleRate matches the lib', () => {
  const inl = extractInline();
  const cases = [
    { detail: { buckets: [{ total: 20, handled: 8 }, { total: 11, handled: 4 }] } },
    { detail: { buckets: [] } },
    { detail: {} },
    { detail: { buckets: [{ total: 5, handled: 9 }] } },
    {},
    null,
  ];
  cases.forEach((c) => assert.deepStrictEqual(inl.objectionHandleRate(c), lib.objectionHandleRate(c), 'mismatch: ' + JSON.stringify(c)));
});

test('inline scoreTrend matches the lib', () => {
  const inl = extractInline();
  const pairs = [[66, 60], [54, 60], [60, 60], [60, null], [60, 0], [null, 60], [60, undefined]];
  pairs.forEach(([c, p]) => assert.deepStrictEqual(inl.scoreTrend(c, p), lib.scoreTrend(c, p), 'mismatch: ' + c + ',' + p));
});
