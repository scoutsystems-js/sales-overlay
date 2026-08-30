/**
 * DOES THIS OBJECTION COUNT? — one definition, every rate surface (2026-08-30).
 *
 * ⚠⚠ THIS IS THE QUESTION `lib/objection-handled.js` DOES NOT ANSWER, AND THAT
 * IS WHY THE SIX SURFACES DISAGREED. That module centralised the NUMERATOR —
 * "is this one handled?", one definition, ten callers — and did its job. Nobody
 * centralised the DENOMINATOR, so three surfaces counted every objection moment
 * while two counted true objections only:
 *
 *     measured on one rep:  20% (35/177) LOOSE   vs   17% (26/155) STRICT
 *
 * A shared numerator with an unshared denominator LOOKS solved and is not.
 *
 * ⚠ THE STANDARD IS STRICT (Justin's ruling 2026-08-22): disqualifications and
 * logistical barriers are not coachable objections, so they do not belong in a
 * handle rate. The class is now stored ON the moment at analysis time
 * (migration 057) instead of being re-derived per surface by a model call.
 *
 * ⚠⚠ NULL FALLS BACK TO COUNTING IT, AND THAT IS A DELIBERATE CROSSOVER RULE.
 * Nothing re-analyses, so calls graded before 057 carry no class. Those moments
 * COUNT — the loose behaviour that already exists — so the number degrades in
 * the direction it already had rather than into a third thing. The population
 * corrects itself as calls turn over.
 */

var OBJECTION_CLASSES = ['true_objection', 'logistical_barrier', 'disqualification'];

// Does this moment belong in a handle-rate denominator?
// ⚠ `null` → YES. Not-yet-classified must never read as not-an-objection: that
// would silently shrink the denominator on the entire pre-057 corpus.
function countsAsObjection(row) {
  if (!row) return false;
  var c = row.objection_class;
  if (c == null || c === '') return true;
  return c === 'true_objection';
}

// The denominator, from a list of objection moments.
function strictObjections(rows) {
  return (Array.isArray(rows) ? rows : []).filter(countsAsObjection);
}

function sanitizeObjectionClass(v) {
  if (typeof v !== 'string') return null;
  var s = v.trim().toLowerCase();
  return OBJECTION_CLASSES.indexOf(s) === -1 ? null : s;
}

module.exports = {
  OBJECTION_CLASSES: OBJECTION_CLASSES,
  countsAsObjection: countsAsObjection,
  strictObjections: strictObjections,
  sanitizeObjectionClass: sanitizeObjectionClass,
};
