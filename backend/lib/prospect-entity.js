// lib/prospect-entity.js — the PROSPECT entity + the close-rate rollup.
// PROSPECT NAMES, sub-stage 3d-1.
//
// ── THE RULING this file implements (2026-08-03) ──────────────────────────
// Close rate = `closed PROSPECTS ÷ TOTAL PROSPECTS`.
//   • Follow-up calls COLLAPSE into their prospect — "if 1 prospect takes 3
//     calls to close that SHOULDN'T count as 3 calls, it's 1 prospect getting
//     closed". Multi-call prospects never inflate the denominator.
//   • OPEN prospects COUNT in the denominator as not-closed. That single choice
//     is what removes the need for an aging rule, a "still open" bucket, or any
//     human judgement about when a dark deal died — all of which were on the
//     table and are now moot.
//   • A prospect is CLOSED if ANY of their calls closed; else the most recent
//     decided outcome; else open.
//
// ── Honest scope note ─────────────────────────────────────────────────────
// On the current corpus this entity moves the rate by ~1 point (40% per-prospect
// vs 39% per-call) because almost every prospect has exactly one call so far.
// The DENOMINATOR REDEFINITION did the work (90% → 40%); this makes the number
// correct as volume grows, and gives 3d-2's merge review something to hang off.
//
// Pure and total. No I/O, never throws.

// Normalized grouping key. Two calls resolving to the same key attach to the
// same prospect automatically (exact match only — fuzzy joins are PROPOSALS for
// human review in 3d-2, never automatic).
//
// Returns null for an unusable name. That is load-bearing: a call whose name
// could not be resolved must get NO prospect rather than joining an "Unknown"
// bucket, which would merge every unidentified prospect into one row and wreck
// both the numerator and the denominator.
function nameKey(v) {
  if (typeof v !== 'string') return null;
  var k = v
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    // Hyphens/dashes are word SEPARATORS, not removable punctuation:
    // "Mark-Anthony" must key the same as "Mark Anthony", not "markanthony".
    .replace(/[-–—]/g, ' ')
    // Apostrophes and stops are presentational: "O'Brien" ≡ "OBrien".
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return k || null;
}

// Outcomes for ONE prospect, oldest → newest, → that prospect's state.
var DECIDED = { closed: 1, lost: 1 };
function prospectOutcome(outcomes) {
  var arr = Array.isArray(outcomes) ? outcomes : [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === 'closed') return 'closed';   // ANY close wins the deal
  }
  for (var j = arr.length - 1; j >= 0; j--) {
    if (DECIDED[arr[j]]) return arr[j];         // most recent decided
  }
  return 'open';                                 // a real state, not a missing one
}

// The headline number. Returns counts alongside the percentage because the
// house rule is that rates always render with their raw counts
// ("12 of 37 prospects") — a bare percentage hides the sample size.
//
// pct is null (not 0) when there are no prospects: "no prospects yet" is not a
// 0% close rate, and rendering 0% would be a lie about performance.
function closeRate(prospects) {
  var arr = Array.isArray(prospects) ? prospects : [];
  var closed = 0;
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i] || {};
    if (prospectOutcome(p.outcomes) === 'closed') closed++;
  }
  var total = arr.length;
  return {
    closed: closed,
    total: total,
    pct: total > 0 ? Math.round((100 * closed) / total) : null,
  };
}

module.exports = {
  nameKey: nameKey,
  prospectOutcome: prospectOutcome,
  closeRate: closeRate,
};
