// Manual outcome tag + Close-section=100 rules (Threads 1 & 2, 2026-07-27).
// Pure logic, unit-tested independent of Express/Supabase.

var VALID_OUTCOMES = ['closed', 'follow_up', 'lost', 'no_show'];

/* ⚠⚠ TWO LISTS, AND THE GAP BETWEEN THEM IS A SAFETY PROPERTY (2026-08-30).
   TAGGABLE = what a HUMAN may set. The GRADER has its own list in
   lib/analysis-worker.js and it is deliberately NOT widened, so the model is
   STRUCTURALLY INCAPABLE of emitting 'disqualified'.
   ⚠ WHY THAT MATTERS: a DQ mark removes the call from the close rate and the
   handle rate. If the model could infer it, a model error would silently let a
   rep off — or mark them down — with nothing on screen to say so. Whether a
   prospect was ever winnable turns on things that are not in the transcript.
   A guard asserts the grader's list still excludes it. */
var TAGGABLE_OUTCOMES = VALID_OUTCOMES.concat([require('./dq-exclusion').DQ_OUTCOME]);

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


/**
 * ⚠⚠ WHO MAY MARK A CALL "NOT A SALES CALL" — A SEPARATE RULE FROM canTagOutcome,
 * AND THE DIFFERENCE IS DELIBERATE.
 *
 * canTagOutcome refuses a MANAGED REP on their own call, because setting an
 * outcome is INFLATABLE: a rep could tag everything "closed" and lift their own
 * close rate. Marking a call not-a-sales-call is the opposite shape — it REMOVES
 * a call from the rep's own numbers, so it cannot be used to flatter them, and
 * Justin ruled explicitly that a CLOSER may mark their own call.
 *
 * ⚠ Reusing canTagOutcome here would have blocked the exact use case this feature
 * was built for: Josh is a managed rep, and the venting call is his own.
 *
 *   owner          -> any call
 *   manager        -> their own calls + calls whose owner they manage
 *   any closer     -> their OWN call, managed or not
 *
 * actor: { id, role }. ownerProfile: { user_id, managed_by } of the CALL's owner.
 */
function canMarkNotSalesCall(actor, ownerProfile) {
  if (!actor || !ownerProfile) return false;
  var ownerId = ownerProfile.user_id;
  if (actor.role === 'owner') return true;
  if (actor.role === 'manager') return ownerId === actor.id || ownerProfile.managed_by === actor.id;
  return ownerId === actor.id;          // a closer may always mark their OWN call
}

/** Which role string to record, given who acted and whose call it is. */
function markRoleFor(actor, ownerProfile) {
  if (!actor || !ownerProfile) return null;
  return (ownerProfile.user_id === actor.id) ? 'closer' : 'manager';
}

module.exports = {
  VALID_OUTCOMES: VALID_OUTCOMES,
  TAGGABLE_OUTCOMES: TAGGABLE_OUTCOMES,
  effectiveCloseScore: effectiveCloseScore,
  canTagOutcome: canTagOutcome,
  canMarkNotSalesCall: canMarkNotSalesCall,
  markRoleFor: markRoleFor,
};
