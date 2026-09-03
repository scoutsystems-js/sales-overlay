/**
 * "Sweet spot 35–45 min" LEAVES the call-time dial (Justin, 2026-09-03; H704):
 * "average call time is just an observed data point — no recommendations needed",
 * and it overlapped the gauge. THE BAND STAYS — it colours the reading and drives
 * the ranked views; it just stops being narrated under a dial. Same class as the
 * dial sub-lines already removed: text beneath a dial competes with the dial.
 * The other two dials' "Target N%" captions are REPORTED, not removed — Justin rules.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const A = require('../lib/team-averages');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

test('no dial carries a caption (H704, H706); the call-time band stays', () => {
  assert.strictEqual(A.METRICS.calltime.targetCaption, null, 'no sentence under the call-time dial');
  assert.deepStrictEqual(A.METRICS.calltime.band.good, [35, 45], 'the band stays — it still colours the reading');
  /* ⚠ AMENDED 2026-09-03 (H706): Justin ruled the other two captions OFF as well — the dials are clean. */
  assert.strictEqual(A.METRICS.closing.targetCaption, null, 'no caption under the closing dial');
  assert.strictEqual(A.METRICS.objections.targetCaption, null, 'no caption under the objection dial');
});

test('avgCardHtml (EXECUTED) renders no caption element for a null caption, and never invents a "Target N min" fallback', () => {
  const src = [fnBody(LIVE, 'avgCardHtml')].join('\n');
  const fn = new Function('escapeHtml', 'avgBand', 'avgGaugeSvg', src + '\nreturn avgCardHtml;')(
    (s) => String(s), () => 'good', () => '<svg></svg>');
  const min = fn({ key: 'calltime', label: 'Avg Call Time', value: 41, target: 40, scale: 60, unit: 'min', total: 12, enough: true, target_caption: null, sweet_spot: { good: [35, 45], ok: [20, 60] } });
  assert.ok(!/avg-target-cap/.test(min), 'no caption element at all: ' + min);
  assert.ok(!/Target 40 min|Sweet spot/.test(min), 'no fallback sentence');
  assert.ok(/41<span class="avg-value-unit">min/.test(min) && /across 12 calls/.test(min), 'the reading and its count stay');
  const empty = fn({ key: 'calltime', label: 'Avg Call Time', unit: 'min', enough: false, reason: '2 calls', target_caption: null });
  assert.ok(!/avg-target-cap/.test(empty), 'the empty dial has no caption either');
  const closing = fn({ key: 'closing', label: 'Closing Rate', value: 24, target: 40, scale: 60, unit: '%', numerator: 12, total: 50, unit_name: 'prospect', numerator_name: 'closed', enough: true, target_caption: null });
  assert.ok(!/avg-target-cap/.test(closing) && /12 of 50 prospects closed/.test(closing), 'the closing dial: no caption, the count line stays (H706)');
});
