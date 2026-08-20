/**
 * KNOWLEDGE BASE — "data points collected today" (2026-08-20).
 *
 * ⚠⚠ WHAT A "DATA POINT" IS — THE CHOICE, MADE EXPLICIT.
 * The KB holds THREE distinct populations, and only one of them is something
 * Scout COLLECTS. Measured on live data 2026-08-20:
 *
 *   auto-harvested call moments   321 rows   learned_pattern / call_moment
 *                                            / auto_closed_call        <- COUNTED
 *   user uploads                  583 rows   user_upload / winning_call
 *                                            (a human uploading a document)
 *   seeded frameworks             170 rows   objection_framework, call_stage,
 *                                            discovery_technique, closing_tactic,
 *                                            buying_signal, discovery, objection,
 *                                            methodology, rapport  (static, seeded once)
 *
 * This counter counts the FIRST only. A seeded framework was never "collected";
 * a user upload was collected by the USER and already has its own feedback in
 * the upload UI. What this number is for is: what did Scout learn from calls
 * today, on its own.
 * ⚠ THE 17 `auto_extracted` ROWS ARE DELIBERATELY EXCLUDED — they come from the
 * older adaptive-learning path, which no longer runs. Including them would make
 * the number un-reproducible from any current code path.
 * ⚠ IF JUSTIN WANTS UPLOADS COUNTED TOO, that is a different number and should
 * be a second line, not a wider definition of this one — merging them would mean
 * a rep's count jumps when they upload a PDF, which is not "Scout learned".
 *
 * ⚠ PER-USER, NOT ACCOUNT-WIDE. Standing ruling: features are per-person. A rep
 * sees their own count; there is no account total on this surface.
 *
 * ⚠⚠ "TODAY" IS THE DIGEST'S ET DAY, RE-EXPORTED RATHER THAN REDEFINED.
 * lib/team-digest owns the America/New_York convention and its comment says
 * "one ET convention platform-wide" — routes/eod.js already reuses it. A second
 * definition would put two defensible answers about when a day starts on one
 * screen, which is the failure that rule exists to prevent.
 */
'use strict';

const digest = require('./team-digest');

// ⚠ RE-EXPORTED, NOT REIMPLEMENTED. The test asserts these are the SAME function
// objects as the digest's, so a copy-paste divergence fails loudly.
const etDateOf = digest.etDateOf;
const dayBoundsUtc = digest.etDayBoundsUtc;

const COUNTER_SCOPE = 'per_user';

/** The row shape this counter counts. Mirrors what Phase 7b writes. */
const HARVEST_MATCH = Object.freeze({
  category: 'learned_pattern',
  metaCategory: 'call_moment',
  metaSource: 'auto_closed_call',
});

const STATES = ['collected', 'unexplained_zero', 'none_eligible', 'no_calls'];

/**
 * ⚠⚠ ZERO IS A MEASUREMENT; ABSENCE IS NOT. Four states, because "0" on its own
 * cannot tell a rep whether nothing happened or something broke.
 *
 * HOW EACH IS DETECTED FROM STORED DATA:
 *   no_calls          analysedToday === 0   — nothing was analysed, so there was
 *                     nothing to harvest FROM. Not a zero about harvesting.
 *   none_eligible     analysed > 0, closed === 0 — harvest gates on
 *                     outcome='closed' (KB ruling 4), so a day of open calls
 *                     legitimately yields nothing. Explainable, not a fault.
 *   unexplained_zero  closed > 0, harvested === 0 — see the warning below.
 *   collected         harvested > 0.
 *
 * ⚠⚠ THE STATE I CANNOT FULLY RESOLVE, SAID PLAINLY RATHER THAN COLLAPSED:
 * `unexplained_zero` is AMBIGUOUS and the data cannot settle it. Phase 7b is
 * fire-and-forget with a SWALLOWED catch — nothing anywhere records that a
 * harvest was ATTEMPTED. So "a closed call was analysed and no rows appeared"
 * is either (a) the call genuinely had no good-group, section-tagged moments,
 * or (b) the harvest threw and was swallowed. Both produce exactly zero rows.
 * ⚠ Rendering that as a plain "0" would report a possible failure as good news,
 * so it is flagged instead. Closing the ambiguity needs an attempt record
 * (a harvest_runs row, or a counter on call_analyses) — that is a schema
 * change, deliberately not made here.
 */
function buildCounter(input) {
  const analysed = Math.max(0, Number((input && input.analysedToday) || 0));
  const closed = Math.max(0, Number((input && input.closedToday) || 0));
  const harvested = Math.max(0, Number((input && input.harvested) || 0));

  if (harvested > 0) {
    return {
      state: 'collected',
      headline: String(harvested),
      label: harvested === 1 ? 'Data Point Collected Today' : 'Data Points Collected Today',
      detail: 'From ' + closed + ' closed ' + (closed === 1 ? 'call' : 'calls')
              + ' of ' + analysed + ' analysed today.',
      needsAttention: false,
    };
  }
  if (analysed === 0) {
    return {
      state: 'no_calls',
      headline: '—',                       // ⚠ NOT "0": nothing was measured
      label: 'No Calls Analysed Today',
      detail: 'Scout collects from calls as they are analysed. Nothing has come in yet today.',
      needsAttention: false,
    };
  }
  if (closed === 0) {
    return {
      state: 'none_eligible',
      headline: '0',                       // a real zero, and it is explainable
      label: 'Data Points Collected Today',
      detail: analysed + ' ' + (analysed === 1 ? 'call' : 'calls') + ' analysed, none closed yet — '
              + 'Scout only collects from calls that close.',
      needsAttention: false,
    };
  }
  return {
    state: 'unexplained_zero',
    headline: '—',                         // ⚠ NOT "0" — see the block comment
    label: 'Nothing Collected Today',
    detail: closed + ' closed ' + (closed === 1 ? 'call' : 'calls') + ' analysed but nothing was '
            + 'collected. This could not be confirmed either way — worth a check.',
    needsAttention: true,
  };
}

module.exports = {
  COUNTER_SCOPE,
  HARVEST_MATCH,
  STATES,
  etDateOf,
  dayBoundsUtc,
  buildCounter,
};
