'use strict';
/* ⚠⚠ FIX #7 — THE RULED OBJECTION SET HAS ONE SOURCE. Sweep block 6 (H671) found
   the four stored categories typed by hand in seven lib files, the order already
   differing in one, and two of them feeding a model prompt — a category added by
   ruling would have reached the extractor and never the Performance Summary or
   Team Recommendations, with nothing failing. Every lib file now requires
   lib/objection-categories.js; the dashboard keeps its inline mirror (a browser
   cannot require) and objection-labels-mirror.test.js pins that one. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const cats = require('../lib/objection-categories');
const FILES = ['lib/objection-synthesis.js', 'lib/rep-series.js', 'lib/team-synthesis.js', 'lib/performance-synthesis.js', 'lib/session-analytics.js', 'lib/team-objections.js', 'lib/analysis-worker.js'];
const LITERAL = /\[\s*'(?:fear|timing|partner|logistical)'\s*,\s*'(?:fear|timing|partner|logistical)'\s*,\s*'(?:fear|timing|partner|logistical)'\s*,\s*'(?:fear|timing|partner|logistical)'\s*\]/;
test('the canonical stored order is the ruling', () => {
  assert.deepStrictEqual(cats.STORED_OBJECTION_CATEGORIES, ['fear', 'timing', 'partner', 'logistical']);
});
FILES.forEach(function (f) {
  test('⚠ ' + f + ' requires the canonical set and carries NO literal copy (stripped source)', () => {
    const src = stripComments(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    assert.ok(/require\('\.\/objection-categories'\)\.STORED_OBJECTION_CATEGORIES/.test(src), f + ' must take the set from the module');
    assert.ok(!LITERAL.test(src), f + ' must not type the four categories by hand — that is how the order drifted');
  });
});
test('⚠⚠ EXECUTED: the two modules that export their set export the canonical array itself, in the ruled order', () => {
  assert.deepStrictEqual(require('../lib/rep-series').OBJECTION_CATEGORIES, cats.STORED_OBJECTION_CATEGORIES);
  assert.deepStrictEqual(require('../lib/team-objections').OBJECTION_CATEGORIES, cats.STORED_OBJECTION_CATEGORIES);
  assert.strictEqual(require('../lib/rep-series').OBJECTION_CATEGORIES, cats.STORED_OBJECTION_CATEGORIES, 'the same array, not an equal copy');
});
test('⚠ the two prompt lanes whose category line changed order carry a NEW lane version (a prompt change is a cache bump, H442)', () => {
  const perf = fs.readFileSync(path.join(__dirname, '..', 'lib', 'performance-synthesis.js'), 'utf8');
  const recs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  assert.ok(/SYNTH_RULE_VERSION = 'v(5|6|\d\d)-/.test(perf), 'v5 carried the category-order change; later bumps (v6 H728) stand on it');
  assert.ok(/RECS_LANE_VERSION = 'v(8|9|1\d)-/.test(recs), 'v8 carried the category-order change; later bumps (v9–v11) stand on it');
});
