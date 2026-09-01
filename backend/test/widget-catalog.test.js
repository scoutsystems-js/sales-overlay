'use strict';
/**
 * ⚠⚠ THE CATALOG'S GUARDS. The table IS the honesty rule, so these assert the
 * DERIVATION rather than the current answers — a pinned list of views is how a
 * catalog comes to offer a gauge for a metric that has no target.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/widget-catalog');

test('⚠⚠ a gauge is offered ONLY where a target exists — the honesty rule', () => {
  C.catalog().forEach((m) => {
    const hasGauge = m.views.indexOf(C.VIEWS.GAUGE) !== -1;
    assert.strictEqual(hasGauge, typeof m.target === 'number',
      m.key + ': a gauge needs a target and a target needs a gauge (target=' + m.target + ')');
  });
});

test('⚠ a trend needs history, a breakdown needs categories, a by-rep needs per-rep', () => {
  C.catalog().forEach((m) => {
    if (!m.available) return;
    assert.strictEqual(m.views.indexOf(C.VIEWS.TREND) !== -1, !!m.history, m.key + ': trend/history');
    assert.strictEqual(m.views.indexOf(C.VIEWS.BREAKDOWN) !== -1, !!m.categories, m.key + ': breakdown/categories');
    assert.strictEqual(m.views.indexOf(C.VIEWS.BY_REP) !== -1, !!m.perRep, m.key + ': by_rep/perRep');
  });
});

test('⚠⚠ an unavailable metric offers NOTHING — not a number, not anything', () => {
  /* A catalog offering a metric it cannot compute is the worst possible first
     impression. Three are unavailable today and each says why in `measured`. */
  const off = C.catalog().filter((m) => !m.available);
  assert.ok(off.length >= 3, 'expected the known-unavailable rows, found ' + off.length);
  off.forEach((m) => {
    assert.deepStrictEqual(m.views, [], m.key + ' is unavailable and must offer no views');
    assert.ok(m.measured && m.measured.length > 30, m.key + ' must say WHY it is unavailable');
  });
});

test('⚠⚠ CASH COLLECTED IS ABSENT BY STANDING RULING', () => {
  /* Justin, 2026-08-25: "we don't track cash collected at all, it's too finicky
     right now. The only time it's needed is on the EOD report." It is still
     extracted and still drives EOD — a DISPLAY ruling, not a data one. A catalog
     that offered every column would quietly overturn it. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'widget-catalog.js'), 'utf8');
  const live = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/cash/i.test(live), 'cash must not appear in the live catalog');
  assert.strictEqual(C.byKey('cash_collected'), null, 'and must not be a metric');
  // ⚠ non-vacuity: the guard must be able to SEE a cash metric if one appears
  assert.ok(/cash/i.test(src), 'the ruling itself is documented in the comments');
});

test('every row carries its MEASUREMENT, not a claim', () => {
  /* ⚠ The list Justin was given came from a sketch. Every row here was measured
     against the live database, and the count is recorded so the next reader can
     see why a metric is offerable rather than trusting the flag. */
  C.catalog().forEach((m) => {
    assert.ok(m.measured && /\d/.test(m.measured),
      m.key + ' must record the count it was judged on');
  });
});

test('⚠ the inverted target says so — a ceiling is not a floor', () => {
  const t = C.byKey('avg_call_time');
  assert.strictEqual(t.targetDirection, 'lower_is_better',
    '60 minutes is a MAX. A gauge that reads it as a floor told a manager the '
    + 'team was failing at a 46-minute average.');
  C.catalog().forEach((m) => {
    if (typeof m.target === 'number' && m.key !== 'avg_call_time') {
      assert.ok(m.targetDirection === undefined || m.targetDirection === 'higher_is_better',
        m.key + ': an unstated direction defaults to higher-is-better');
    }
  });
});
