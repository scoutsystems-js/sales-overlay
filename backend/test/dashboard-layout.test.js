'use strict';
/**
 * ⚠⚠ THE LAYOUT RESOLVER'S GUARDS. Two properties carry the whole design and
 * neither is visible in a diff: the DEFAULT IS NEVER STORED, and an unknown
 * metric is DROPPED FROM THE RENDER AND LEFT IN THE ROW.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/dashboard-layout');
const { byKey } = require('../lib/widget-catalog');

test('⚠⚠ a manager with NO stored layout gets the code default', () => {
  [null, undefined, []].forEach((empty) => {
    const r = L.resolveLayout(empty);
    assert.ok(r.cards.length > 0, 'the default must render something');
    assert.strictEqual(r.isDefault, true,
      'the caller must be able to tell "never customised" from "customised to look like the default"');
  });
});

test('⚠⚠ THE DEFAULT IS NEVER MATERIALISED — it exists only in code', () => {
  /* The moment a default board is written out per manager, adding a widget
     stops reaching anyone who already has one — silently and permanently, which
     is the exact defect store-the-deviation exists to prevent. */
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dashboard-layout.js'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  assert.ok(!/insert\(|upsert\(/.test(lib), 'the resolver must never write');
  const at = route.indexOf("router.get('/dashboard'");
  assert.ok(at > 0, 'the dashboard route was not found');
  const fn = route.slice(at, route.indexOf('\n});', at));
  assert.ok(fn.length > 400 && fn.length < 3000, 'slice must cover the route: ' + fn.length);
  assert.ok(!/insert\(|upsert\(|update\(/.test(fn),
    'the READ path must not write a default row — that is how the deviation rule dies');
});

test('⚠⚠ an unknown metric is DROPPED FROM THE RENDER and NAMED', () => {
  /* Not hypothetical: `reps_active` and `close_rate` were both removed in one
     week. A board naming either must degrade, and must SAY so — a board that
     quietly shrinks is indistinguishable from a manager mis-remembering. */
  const r = L.resolveLayout([
    { metric: 'close_rate', view: 'gauge' },
    { metric: 'reps_active', view: 'number' },
    { metric: 'avg_score', view: 'by_rep' },
  ]);
  assert.strictEqual(r.cards.length, 1, 'only the surviving card renders');
  assert.deepStrictEqual(r.dropped.map((d) => d.metric).sort(), ['close_rate', 'reps_active']);
  assert.strictEqual(r.isDefault, false, 'a stored board is not the default even when most of it is gone');
});

test('⚠⚠ THE STORED ROW IS NEVER PRUNED — resolve does not mutate its input', () => {
  /* A metric can come back — a lane restored, a column re-added — and a read
     path that prunes storage makes that unrecoverable. */
  const stored = [{ metric: 'close_rate', view: 'gauge' }, { metric: 'avg_score', view: 'number' }];
  const copy = JSON.parse(JSON.stringify(stored));
  L.resolveLayout(stored);
  assert.deepStrictEqual(stored, copy, 'the caller\'s array must come back untouched');
});

test('⚠ a stored view the metric no longer supports falls back to `number`, and says so', () => {
  const r = L.resolveLayout([{ metric: 'avg_score', view: 'gauge' }]);
  assert.strictEqual(byKey('avg_score').target, null, 'the premise: avg_score has no target');
  assert.strictEqual(r.cards[0].view, 'number', 'a gauge with nothing to point at falls back');
  assert.strictEqual(r.cards[0].requestedView, 'gauge',
    'and the card must be able to say it changed, or it silently differs from what was chosen');
});

test('⚠ a supported view is kept, and requestedView stays null', () => {
  const r = L.resolveLayout([{ metric: 'closing_rate', view: 'gauge' }]);
  assert.strictEqual(r.cards[0].view, 'gauge');
  assert.strictEqual(r.cards[0].requestedView, null, 'nothing changed, so nothing is claimed');
});

test('⚠ spans are clamped, never trusted', () => {
  const r = L.resolveLayout([{ metric: 'prospects', view: 'number', w: 99, h: 0 }]);
  assert.strictEqual(r.cards[0].w, 4, 'a span wider than the grid would break the row');
  assert.strictEqual(r.cards[0].h, 1, 'and a zero height would render nothing');
});

test('⚠ the default carries only metrics the catalog still offers', () => {
  /* A default naming a retired metric would drop cards for EVERY manager who
     never customised — the widest possible blast radius. */
  L.DEFAULT_LAYOUT.forEach((c) => {
    const m = byKey(c.metric);
    assert.ok(m && m.available, c.metric + ' is in the default but not offerable');
    assert.ok(m.views.indexOf(c.view) !== -1,
      c.metric + ' defaults to a ' + c.view + ' it cannot support');
  });
});
