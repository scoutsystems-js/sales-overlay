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

/* ⚠⚠ CONVERTED 2026-09-01, AND THE DIRECTION IS THE WHOLE POINT. This asserted
   an EQUIVALENCE — a view is offered IF AND ONLY IF the data supports it — which
   was right while the offer was data-only. The offer is now data capability
   INTERSECTED with render capability, so it may legitimately be NARROWER: five
   metrics have per-rep data and no per-rep card.
   ⚠ THE SUBJECT SURVIVES AND IS THE HALF THAT MATTERS: the offer must never
   EXCEED what the data supports. That is the honesty rule, and it is still an
   absolute. What was dropped is the reverse implication, which now has its own
   test below — a view is offered only if something can DRAW it. */
test('⚠ the offer never EXCEEDS the data — a trend needs history, a breakdown needs categories', () => {
  C.catalog().forEach((m) => {
    if (!m.available) return;
    if (m.views.indexOf(C.VIEWS.TREND) !== -1) assert.ok(m.history, m.key + ': trend without history');
    if (m.views.indexOf(C.VIEWS.BREAKDOWN) !== -1) assert.ok(m.categories, m.key + ': breakdown without categories');
    if (m.views.indexOf(C.VIEWS.BY_REP) !== -1) assert.ok(m.perRep, m.key + ': by_rep without per-rep values');
    if (m.views.indexOf(C.VIEWS.GAUGE) !== -1) assert.ok(typeof m.target === 'number', m.key + ': gauge without a target');
  });
  // sanity, or the four conditionals above pass over an empty list
  const offered = C.catalog().filter((m) => m.views.length);
  assert.ok(offered.length >= 5, 'offered metrics: ' + offered.length);
  assert.ok(offered.some((m) => m.views.indexOf(C.VIEWS.TREND) !== -1), 'at least one trend is offered');
});

test('⚠⚠ a view is offered ONLY if something can DRAW it', () => {
  C.catalog().forEach((m) => {
    m.views.forEach((v) => assert.ok(C._canRender(v, m.key),
      m.key + '/' + v + ' is offered and nothing renders it — that is a card that '
      + 'shows nothing, or worse, another metric\'s numbers'));
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

test('⚠⚠ THE REP CARD IS A PERSON, NOT A METRIC — it offers exactly the card view (2026-09-02)', () => {
  const m = C.byKey('rep_card');
  assert.ok(m && m.person === true, 'rep_card is a person entry');
  assert.deepStrictEqual(m.views, ['rep_card'], 'a person offers the card and nothing else — derived from `person`, not listed');
  assert.strictEqual(m.group, 'people');
  const people = C.grouped().filter((g) => g.key === 'people')[0];
  assert.ok(people && people.metrics.some((x) => x.key === 'rep_card' && x.person === true), 'the picker is told it is a person');
  assert.deepStrictEqual(C._RENDERABLE.rep_card, ['rep_card']);
});
