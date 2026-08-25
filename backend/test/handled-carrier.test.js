/**
 * ⚠ THE SHARED-CARRIER GUARD for "handled" (ruling 2026-08-17).
 *
 * "handled" is read by fifteen places and they do NOT all mean the same thing:
 *
 *   TEN ask "what is the RATE?"        → must credit objections on closed calls
 *   FIVE ask "was this a GOOD MOMENT?" → must NOT, ever
 *
 * The failure this guards is silent and specific: one surface adopting the other
 * group's answer produces two different handle rates on ONE screen, or files weak
 * handling under "what worked". Neither throws. Both are only visible to someone
 * adding up numbers on the page.
 *
 * These are TEXTUAL checks against the source. That is deliberate — the question
 * is "does this call site use the shared predicate or a local literal?", which is
 * a property of the code, not of any one function's return value.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  const raw = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // ⚠ Strip comments FIRST. This codebase archives replaced code in place, so a
  // literal survives in a /* */ block long after the live code stopped using it
  // — and matching the archive would answer the wrong question in both
  // directions.
  return raw.split('\n')
    .filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// ── the ten that must credit a closed call ────────────────────────────────
const RATE_LANES = [
  ['lib/rep-series.js', 'the two manager line graphs + the gauge panel'],
  ['lib/team-analytics.js', 'obj_handle_rate → team glance box, rep cards, WHY prose, per-category buckets'],
  ['lib/team-needs-work.js', 'team AND personal What Needs Work'],
  ['lib/session-analytics.js', 'the Objections view'],
  ['lib/performance-synthesis.js', 'performance synthesis prompt'],
  ['lib/team-synthesis.js', 'team synthesis prompt'],
  ['lib/objection-synthesis.js', 'objection synthesis prompt'],
];

RATE_LANES.forEach(function (lane) {
  test('RATE LANE uses the shared predicate: ' + lane[0] + ' (' + lane[1] + ')', () => {
    const src = read(lane[0]);
    assert.ok(/require\('\.\/objection-handled'\)/.test(src),
      lane[0] + ' must import the shared predicate rather than testing the string itself');
  });
});

test("⚠ NO RATE LANE STILL COMPARES resolution TO 'handled' BY HAND", () => {
  // objection-synthesis is the ONE exception and it is deliberate: it counts with
  // the predicate but picks its EXAMPLES on the moment's own resolution, because
  // an example is evidence of good handling shown to a closer.
  const exempt = {
    // Counts with the predicate; picks its EXAMPLES on the moment's own
    // resolution, because an example is evidence of good handling.
    'lib/objection-synthesis.js': 1,
    // Classifies the moment's OWN resolution for the on-screen breakdown
    // (handled · partial · unhandled). The RATE beside it uses the predicate —
    // that is exactly why the `credited` bucket had to be added, so the two
    // reconcile instead of quietly disagreeing.
    'lib/session-analytics.js': 1,
    // ⚠ THIS FILE IS IN BOTH LISTS, and that is not a mistake. It computes an
    // objection RATE for its prompt (predicate) *and* picks highlight-of-the-week
    // candidates (moment's own resolution). One file, both questions — which is
    // precisely why the distinction has to be enforced per CALL SITE rather than
    // per file.
    'lib/team-synthesis.js': 1,
  };
  RATE_LANES.forEach(function (lane) {
    const hits = (read(lane[0]).match(/resolution\s*===\s*'handled'/g) || []).length;
    const allowed = exempt[lane[0]] || 0;
    assert.strictEqual(hits, allowed,
      lane[0] + ' has ' + hits + ' hand-rolled handled checks, expected ' + allowed
      + '. A local literal here is how two handle rates end up on one screen.');
  });
});

// ── the five that must NOT ────────────────────────────────────────────────
const MOMENT_LANES = [
  ['lib/highlight-section.js', "good/bad grouping of a moment"],
  ['lib/section-breakdown.js', 'the "what worked" lane'],
  ['lib/team-synthesis.js', 'highlight-of-the-week candidates'],
  ['lib/analysis-worker.js', 'the mig-012 write-time boolean'],
];

MOMENT_LANES.forEach(function (lane) {
  test('MOMENT LANE keeps the strict resolution: ' + lane[0] + ' (' + lane[1] + ')', () => {
    const src = read(lane[0]);
    assert.ok(/resolution\s*(===|!==)\s*'handled'/.test(src),
      lane[0] + ' must still judge the MOMENT, not the call. A moment inside a '
      + 'closed call is not automatically a good moment.');
  });
});

test('the reason each moment lane is exempt is written NEXT TO IT, not only here', () => {
  // A rule recorded only in a test file is a rule the next person edits past.
  MOMENT_LANES.forEach(function (lane) {
    const raw = fs.readFileSync(path.join(__dirname, '..', lane[0]), 'utf8');
    assert.ok(/DELIBERATELY NOT the shared isHandled/.test(raw),
      lane[0] + ' must carry the comment explaining why it does not credit closed calls');
  });
});

// ── the money math is gone and must stay gone ─────────────────────────────
test('⚠ THE MONEY MATH IS REMOVED — and it CANNOT come back while this ruling holds', () => {
  const src = read('lib/team-needs-work.js');
  ['computeLinkage(', 'extraCash', 'extraDeals', 'MIN_DEALS_FOR_CASH', 'cash_collected']
    .forEach(function (dead) {
      assert.ok(src.indexOf(dead) === -1, dead + ' is still live in team-needs-work');
    });
  // The reason is not stylistic: the counterfactual multiplied
  // P(closed|handled) − P(closed|not handled), and under this ruling the
  // not-handled group cannot contain a closed call, so that term is 0.0% BY
  // CONSTRUCTION. Measured live: delta 46.6 → 67.6, inflating every dollar
  // figure ~45% while still reading as a measurement.
  const html = read('web/dashboard.html');
  assert.ok(html.indexOf('nw-chip-cash') === -1, 'the +$X at-stake chip must be gone');
  assert.ok(html.indexOf('How this is estimated') === -1, 'the estimate panel must be gone');
});

test('the Objections view shows CREDITED so its counts reconcile with its rate', () => {
  const html = read('web/dashboard.html');
  assert.ok(/credited \(call closed\)/.test(html), 'the fourth count must be labelled');
  assert.ok(/m\.handled \+ \(m\.credited \|\| 0\) \+ m\.partial \+ m\.unhandled/.test(html),
    'the denominator on screen must include all four buckets');
  const lib = read('lib/session-analytics.js');
  assert.ok(/credited: 0/.test(lib), 'the metrics shape must carry the fourth count');
});
