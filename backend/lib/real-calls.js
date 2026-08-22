/**
 * WHAT COUNTS AS A REAL CALL — the one place that decides.
 *
 * ⚠⚠ THIS EXISTS BECAUSE A PER-CLOSER VIEW BUILT NAIVELY SHOWS FOUR CLOSERS
 * WHERE THERE IS ONE. The three demo reps carry COPIES of Josh's calls under
 * different `user_id`s and different `fathom_call_id`s, so they survive
 * DISTINCT, GROUP BY user_id and every per-rep aggregate. On a per-closer
 * objection grid that is not cosmetic — it is Josh being compared against
 * himself three times, presented as a team.
 *
 * ⚠⚠ THE SIGNAL IS THE ID PREFIX, AND FOR `demo-` ROWS IT IS THE ONLY SIGNAL
 * THERE IS. Stated plainly rather than dressed up, because the honest version
 * is what tells the next person how much to trust it. Measured 2026-08-22:
 *
 *     class   calls   recording_url   prompt_version
 *     real     420    420 (100%)      genuine grader versions v10-v26
 *     seed     102      0 (0%)        'seed-2026-08-16'  (a sentinel)
 *     demo      33     33 (100%)      v4 / v5 / v8       (genuine, COPIED)
 *
 * SEED rows are separable by real data properties — a null recording_url, and a
 * prompt_version that is not a grader version. DEMO rows are not separable by
 * anything: they carry a real recording_url and a real prompt version because
 * they are byte-level copies of Josh's real analyses. Nothing in the row says
 * "synthetic" except the id we gave it.
 *
 * ⚠ SO WHY NOT USE `recording_url IS NULL` FOR SEED AND THE PREFIX FOR DEMO?
 * Because two mechanisms for one concept is two things to keep in sync, and
 * because that property is a COINCIDENCE OF TODAY'S DATA, not a guarantee — a
 * genuine call that failed to sync a recording_url would be silently discarded
 * as synthetic. A criterion is not a constant. One rule, and it is the prefix.
 *
 * ⚠ THE DURABLE FIX, FILED NOT BUILT: a real `is_synthetic boolean` column on
 * `fathom_calls`, written at insert time by the seeding scripts. Then this
 * module reads a property instead of parsing a name, and a seed row that
 * forgets the prefix stops being invisible. Until then the prefixes ARE the
 * contract — `CLAUDE.md` records them as deliberately disjoint, and the seeding
 * scripts set them on purpose.
 */

'use strict';

/**
 * ⚠ `demo-rv-` (the Zoom security reviewer's seeded rows) is covered by
 * `demo-` and needs no entry of its own. Adding one would imply the two are
 * independent and invite someone to remove the wrong one.
 */
const SYNTHETIC_ID_PREFIXES = ['seed-', 'demo-'];

/** True when this provider-side call id was minted by a seeding script. */
function isSyntheticCallId(fathomCallId) {
  if (typeof fathomCallId !== 'string') return false;
  for (var i = 0; i < SYNTHETIC_ID_PREFIXES.length; i++) {
    if (fathomCallId.indexOf(SYNTHETIC_ID_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/** True when a `fathom_calls` row represents a call a real person actually had. */
function isRealCall(row) {
  return !!row && !isSyntheticCallId(row.fathom_call_id);
}

/**
 * Drop synthetic rows from a `fathom_calls` result set.
 *
 * ⚠ FILTERED IN JS RATHER THAN IN THE QUERY, DELIBERATELY. A `.not(col,'like',…)`
 * pair would be a SECOND expression of the rule that no test can see, and the
 * two would drift. Volumes here are in the hundreds; the cost is nothing and
 * the guarantee is that what ships is exactly what the test pins.
 */
function realCallsOnly(rows) {
  return (rows || []).filter(isRealCall);
}

module.exports = {
  SYNTHETIC_ID_PREFIXES: SYNTHETIC_ID_PREFIXES,
  isSyntheticCallId: isSyntheticCallId,
  isRealCall: isRealCall,
  realCallsOnly: realCallsOnly,
};
