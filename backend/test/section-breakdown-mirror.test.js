// Part 1b: dashboard.html renders the section breakdown with INLINE copies of
// highlightGroup + sectionBreakdown (browser script, no module import). This test
// extracts those inline functions from the HTML and asserts they behave IDENTICALLY
// to the canonical backend lib/highlight-section.js — so the mirror can't drift.
// (Same brittle-by-design textual-extraction pattern as review-one-thing.test.js.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib/highlight-section');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function extractInline() {
  // Grab from `var HL_GOOD_TYPES` up to the stable comment boundary that follows
  // sectionBreakdown (avoids brace-counting through the object literals).
  const start = html.indexOf('var HL_GOOD_TYPES');
  assert.ok(start !== -1, 'dashboard.html must define the inline HL_GOOD_TYPES/highlightGroup/sectionBreakdown');
  const end = html.indexOf('// ─── Section 2: Section Grades', start);
  assert.ok(end !== -1 && end > start, 'section-breakdown block boundary not found');
  const src = html.slice(start, end);
  return new Function(src + '\n return { highlightGroup: highlightGroup, sectionBreakdown: sectionBreakdown };')();
}

const CASES = [
  { type: 'strong_moment' }, { type: 'rapport_moment' }, { type: 'buying_signal' },
  { type: 'missed_opportunity' }, { type: 'disqualify_signal' },
  { type: 'objection', resolution: 'handled' }, { type: 'objection', resolution: 'partial' },
  { type: 'objection', resolution: 'unhandled' }, { type: 'objection' },
  { type: 'STRONG_MOMENT' }, { type: 'weird' }, {},
];

test('inline highlightGroup matches the lib for every case', () => {
  const inline = extractInline();
  CASES.forEach((c) => {
    assert.strictEqual(inline.highlightGroup(c), lib.highlightGroup(c), 'mismatch for ' + JSON.stringify(c));
  });
});

test('inline sectionBreakdown matches the lib (mode + group sizes)', () => {
  const inline = extractInline();
  const HL = [
    { section: 'discovery', type: 'strong_moment' },
    { section: 'discovery', type: 'objection', resolution: 'unhandled' },
    { section: 'close', type: 'buying_signal' },
    { section: null, type: 'rapport_moment' },
  ];
  ['intro', 'discovery', 'pitch', 'objection', 'close'].forEach((k) => {
    const a = inline.sectionBreakdown(HL, k);
    const b = lib.sectionBreakdown(HL, k);
    assert.strictEqual(a.mode, b.mode, 'mode mismatch for ' + k);
    assert.strictEqual(a.good.length, b.good.length, 'good mismatch for ' + k);
    assert.strictEqual(a.bad.length, b.bad.length, 'bad mismatch for ' + k);
  });
  // empty / missing → notes in both
  assert.strictEqual(inline.sectionBreakdown([], 'discovery').mode, lib.sectionBreakdown([], 'discovery').mode);
});
