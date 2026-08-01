// Call Review Context (Part 1a) — section enum + good/bad grouping (TDD).
// section = which part of the call a highlight belongs to (extractor-tagged,
// nullable). highlightGroup = the review UI's two-bucket split (What worked /
// What to fix). Pure logic — the UI (Part 1b) reuses highlightGroup.
const test = require('node:test');
const assert = require('node:assert');
const hs = require('../lib/highlight-section');

// ── section enum ─────────────────────────────────────────────────────────────
test('VALID_HIGHLIGHT_SECTIONS is exactly the five call sections', function () {
  assert.deepStrictEqual(hs.VALID_HIGHLIGHT_SECTIONS, ['intro', 'discovery', 'pitch', 'objection', 'close']);
});

test('sanitizeSectionValue accepts the five sections, case-insensitively + trimmed', function () {
  assert.strictEqual(hs.sanitizeSectionValue('discovery'), 'discovery');
  assert.strictEqual(hs.sanitizeSectionValue('  Close '), 'close');
  assert.strictEqual(hs.sanitizeSectionValue('OBJECTION'), 'objection');
});

test('sanitizeSectionValue → null for unknown / non-string / empty (nullable column)', function () {
  assert.strictEqual(hs.sanitizeSectionValue('rapport'), null); // not a section
  assert.strictEqual(hs.sanitizeSectionValue('webex'), null);
  assert.strictEqual(hs.sanitizeSectionValue(''), null);
  assert.strictEqual(hs.sanitizeSectionValue(null), null);
  assert.strictEqual(hs.sanitizeSectionValue(undefined), null);
  assert.strictEqual(hs.sanitizeSectionValue(3), null);
});

// ── good/bad grouping ────────────────────────────────────────────────────────
test('positive moment types group as "good" (What worked)', function () {
  assert.strictEqual(hs.highlightGroup({ type: 'strong_moment' }), 'good');
  assert.strictEqual(hs.highlightGroup({ type: 'rapport_moment' }), 'good');
  assert.strictEqual(hs.highlightGroup({ type: 'buying_signal' }), 'good');
});

test('closer-miss / disqualify types group as "bad" (What to fix)', function () {
  assert.strictEqual(hs.highlightGroup({ type: 'missed_opportunity' }), 'bad');
  assert.strictEqual(hs.highlightGroup({ type: 'disqualify_signal' }), 'bad');
});

test('objections split by resolution: handled = good, partial/unhandled/unknown = bad', function () {
  assert.strictEqual(hs.highlightGroup({ type: 'objection', resolution: 'handled' }), 'good');
  assert.strictEqual(hs.highlightGroup({ type: 'objection', resolution: 'partial' }), 'bad');
  assert.strictEqual(hs.highlightGroup({ type: 'objection', resolution: 'unhandled' }), 'bad');
  assert.strictEqual(hs.highlightGroup({ type: 'objection', resolution: null }), 'bad');
  assert.strictEqual(hs.highlightGroup({ type: 'objection' }), 'bad');
});

test('unrecognized / malformed → "bad" so a moment is never silently dropped', function () {
  assert.strictEqual(hs.highlightGroup({ type: 'weird' }), 'bad');
  assert.strictEqual(hs.highlightGroup({}), 'bad');
  assert.strictEqual(hs.highlightGroup(null), 'bad');
});

test('type matching is case-insensitive', function () {
  assert.strictEqual(hs.highlightGroup({ type: 'STRONG_MOMENT' }), 'good');
  assert.strictEqual(hs.highlightGroup({ type: 'Objection', resolution: 'handled' }), 'good');
});
