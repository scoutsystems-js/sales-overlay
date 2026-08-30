// Part 1b: gradeCardHtml render assembly. Extracts the real dashboard function
// and runs it with stubs, so each branch's OUTPUT is exercised (not just the
// sectionBreakdown decision, which lib + mirror tests already cover):
//  - highlights mode → renders the demoted notes summary + only non-empty groups
//  - notes mode (fallback) → renders the notes prose, no group labels
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// Build gradeCardHtml with injected stubs for its free variables.
function makeGradeCard(breakdownReturn, expanded) {
  const start = html.indexOf('function gradeCardHtml(');
  const end = html.indexOf('function toggleGradeCard(', start);
  assert.ok(start !== -1 && end > start, 'gradeCardHtml not found');
  const src = html.slice(start, end);
  /* ⚠ gradeCardHtml now calls discoveryCoverageHtml/discoveryCoverage (the six
     discovery items, surface ①). These tests EXECUTE the real function, so the
     new dependency has to be injected — that they failed when it appeared is the
     harness doing its job, not a reason to weaken it. */
  const factory = new Function(
    'escapeHtml', 'highlightEntryHtml', 'sectionBreakdown', 'REVIEW_SECTION_LABELS', 'state',
    'discoveryCoverageHtml', 'discoveryCoverage',
    src + '\n return gradeCardHtml;'
  );
  return factory(
    (s) => String(s),
    (h) => '[HL:' + h.type + ']',
    () => breakdownReturn,
    { discovery: 'Discovery' },
    { expandedGradeCards: { discovery: expanded } },
    () => '',      // no six-item block in these fixtures
    () => null
  );
}

const ANALYSIS = { discovery_grade: 'C', discovery_score: 60, discovery_notes: 'Discovery ran late.' };

test('highlights mode → demoted summary + both group labels + highlight rows', () => {
  const fn = makeGradeCard({ mode: 'highlights', good: [{ type: 'strong_moment' }], bad: [{ type: 'missed_opportunity' }] }, true);
  const out = fn('discovery', ANALYSIS, [], null);
  assert.ok(out.includes('review-section-summary'), 'notes demoted to a summary line');
  assert.ok(out.includes('Discovery ran late.'), 'notes text preserved, not lost');
  assert.ok(out.includes('What worked') && out.includes('What to fix'), 'both group labels present');
  assert.ok(out.includes('[HL:strong_moment]') && out.includes('[HL:missed_opportunity]'), 'rows reuse highlightEntryHtml');
  assert.ok(!out.includes('review-grade-notes'), 'the fallback prose block is NOT used in highlights mode');
});

test('one group empty → only the present group renders (no empty column)', () => {
  const fn = makeGradeCard({ mode: 'highlights', good: [{ type: 'buying_signal' }], bad: [] }, true);
  const out = fn('discovery', ANALYSIS, [], null);
  assert.ok(out.includes('What worked'), 'non-empty group renders');
  assert.ok(!out.includes('What to fix'), 'empty group is skipped entirely');
});

test('notes fallback mode → notes prose, NO group labels (the common case)', () => {
  const fn = makeGradeCard({ mode: 'notes', good: [], bad: [] }, true);
  const out = fn('discovery', ANALYSIS, [], null);
  assert.ok(out.includes('review-grade-notes'), 'fallback renders the notes prose block');
  assert.ok(out.includes('Discovery ran late.'), 'notes text shown');
  assert.ok(!out.includes('What worked') && !out.includes('What to fix'), 'no group headers in fallback');
  assert.ok(!out.includes('review-section-summary'), 'no demoted-summary duplication in fallback');
});

test('collapsed card renders no body at all', () => {
  const fn = makeGradeCard({ mode: 'notes', good: [], bad: [] }, false);
  const out = fn('discovery', ANALYSIS, [], null);
  assert.ok(!out.includes('review-grade-body'), 'collapsed → no expansion body');
});
