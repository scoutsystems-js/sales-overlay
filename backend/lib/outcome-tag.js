// Manual outcome tag + Close-section=100 rules (Threads 1 & 2, 2026-07-27).
// Pure logic, unit-tested independent of Express/Supabase.

var VALID_OUTCOMES = ['closed', 'follow_up', 'lost', 'no_show'];

// The DISPLAYED close score (Thread 2): 100 when the EFFECTIVE outcome is
// 'closed', else the grader's earned score. `earned` is call_analyses
// .close_score_earned; fall back to the current close_score for any pre-027 row
// that somehow lacks an earned value.
function effectiveCloseScore(outcome, earned, currentClose) {
  if (outcome === 'closed') return 100;
  var e = (earned == null) ? currentClose : earned;
  return (typeof e === 'number') ? e : (e == null ? null : Number(e));
}

// Who may set a call's outcome tag (Thread 1 permissions, Justin's ruling):
//   owner          → any call
//   manager        → their own calls + calls whose owner they manage
//   unmanaged user → their OWN calls only
//   managed rep    → NOT their own (can't inflate their own close rate)
// actor: { id, role }. ownerProfile: { user_id, managed_by } of the CALL's owner.
function canTagOutcome(actor, ownerProfile) {
  if (!actor || !ownerProfile) return false;
  var ownerId = ownerProfile.user_id;
  if (actor.role === 'owner') return true;
  if (actor.role === 'manager') return ownerId === actor.id || ownerProfile.managed_by === actor.id;
  // plain user: only their OWN call, and only if they are unmanaged.
  return ownerId === actor.id && !ownerProfile.managed_by;
}

module.exports = {
  VALID_OUTCOMES: VALID_OUTCOMES,
  effectiveCloseScore: effectiveCloseScore,
  canTagOutcome: canTagOutcome,
};
