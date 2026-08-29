/**
 * Constants that more than one module has to agree on.
 *
 * WHY THIS EXISTS. The payment-structure allowlist was written out twice —
 * `analysis-worker` (which sanitises what the grader returns) and `routes/eod`
 * (which validates what a human edits) — plus a CHECK constraint in migration
 * 022. Three copies of one list, and the two JS copies were each pinned by
 * their own test, so a drift would have shown up as one test failing and the
 * other passing rather than as a disagreement.
 *
 * AND THE SYNC CAP WAS SHARED THE AWKWARD WAY: `routes/zoom` imported
 * `_FIRST_SYNC_ANALYZE_CAP` from `routes/fathom`. One route file importing
 * another is the coupling the hardening row was filed against — the value was
 * never duplicated, it just had no proper home.
 *
 * THE SQL COPY CANNOT IMPORT THIS, so migration 022's CHECK is pinned textually
 * by test/sales-constants.test.js — the same mirror discipline used for the KB
 * scope predicate.
 */

/**
 * How a closed deal was paid for.
 * ORDER IS NOT SIGNIFICANT, but the SET is: it is enforced by a CHECK
 * constraint, so adding a value here without a migration writes a row the
 * database will reject.
 */
var PAYMENT_STRUCTURES = ['paid_in_full', 'payment_plan', 'bnpl', 'none_stated'];

/**
 * On a FIRST sync only, auto-analyse at most this many of the backlog.
 *
 * FIRST-SYNC ONLY, and that is the whole point: without a cap, connecting an
 * account with years of history would fire hundreds of analyses on one click.
 * Capping EVERY run was tried and was wrong — a busy day or a cron-gap recovery
 * bringing more than this many NEW calls would silently leave the remainder
 * ungraded. Steady-state windows are bounded by real call volume.
 */
var FIRST_SYNC_ANALYZE_CAP = 20;

module.exports = {
  PAYMENT_STRUCTURES: PAYMENT_STRUCTURES,
  FIRST_SYNC_ANALYZE_CAP: FIRST_SYNC_ANALYZE_CAP,
};
