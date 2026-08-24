// User Management (2026-07-27) — pure guard logic, extracted so the permission /
// gate rules are unit-tested independent of Express + Supabase. The route
// handlers in routes/admin.js do the DB work and call these to decide.

// Can `actor` (role + id) manage `target`? Owner = anyone. Manager = only their
// own reps (target.managed_by === actor id). Anyone else = no.
function canManageTarget(actorRole, actorId, target) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'manager') return !!(target && target.managed_by === actorId);
  return false;
}

/**
 * What deleting this user should actually DO.
 *
 * ⚠⚠ RENAMED FROM `deleteBlockReason` (2026-08-24) BECAUSE ITS MEANING
 * INVERTED. That function returned "recorded calls block the delete"; under
 * Justin's ruling ("make it possible to delete people even if they have calls")
 * history no longer blocks anything. A boolean-ish guard whose sense flips while
 * its type stays the same is the silent-semantic-change trap: every existing
 * caller would keep compiling and keep producing confident wrong output.
 * Renaming forces each one to be found and re-read.
 *
 * ⚠⚠ AND WHY THERE ARE TWO MODES RATHER THAN ONE. Measured on production
 * 2026-08-24: EVERY history table cascades on an `auth.users` delete —
 * fathom_calls, call_analyses, call_highlights, prospects, eod_edits, the
 * session tables, user_profiles. Proven on a throwaway user: 2 calls and 2
 * analyses in, delete the auth row, 0 out. So a hard delete does not orphan a
 * user's history, it DESTROYS it — which would rewrite close rate, cash and
 * rankings for every period that person worked.
 *
 *   'hard'      — no history at all. Nothing to preserve, so remove the row.
 *   'tombstone' — has history. Keep the auth row so every foreign key survives,
 *                 scrub the identity, and drop them from the roster. This is the
 *                 "tombstone user row" option, and it needs no migration.
 *   'blocked'   — still manages reps. Those reps would end up managed by a
 *                 deleted person, so move them first (same rule deactivate has).
 *
 * @returns {{mode:'hard'|'tombstone'|'blocked', reason:string|null, calls:number}}
 */
function deletePlan(opts) {
  opts = opts || {};
  var calls = (Number(opts.callCount) || 0) + (Number(opts.sessionCount) || 0);
  var reps = Number(opts.repCount) || 0;
  if (reps > 0) {
    return { mode: 'blocked', calls: calls,
      reason: 'This user manages ' + reps + ' rep' + (reps === 1 ? '' : 's') +
        ' — move ' + (reps === 1 ? 'that rep' : 'them') + ' to another manager first, then delete.' };
  }
  if (calls > 0) return { mode: 'tombstone', calls: calls, reason: null };
  return { mode: 'hard', calls: 0, reason: null };
}

/**
 * The identity a tombstoned user is scrubbed to.
 *
 * ⚠ DETERMINISTIC AND DERIVED FROM THE ID, so two deleted people never collide
 * on one email and never render as the same person. `resolveDisplayName` reads
 * first/last before falling back to the email, so this is what a manager sees:
 * "Deleted user (a1b2c3d4)" — not blank, not "undefined", and not somebody else.
 *
 * ⚠ `.invalid` is the RFC 2606 reserved TLD: it can never be registered, so a
 * scrubbed address cannot become a real mailbox belonging to a stranger.
 */
function tombstoneIdentity(userId) {
  var short = String(userId || '').replace(/-/g, '').slice(0, 8) || 'unknown';
  return {
    email: 'deleted-' + short + '@deleted.invalid',
    first_name: 'Deleted',
    last_name: 'user (' + short + ')',
  };
}

// Deactivation guards: not yourself, not an owner, and not a manager who still
// has reps (they'd be orphaned — move the reps first). Returns a reason string
// when blocked, else null.
function deactivateBlockReason(opts) {
  opts = opts || {};
  if (opts.actorId && opts.targetId && opts.actorId === opts.targetId) {
    return 'You can’t deactivate your own account.';
  }
  if (opts.targetRole === 'owner') {
    return 'Owners can’t be deactivated.';
  }
  var reps = Number(opts.repCount) || 0;
  if (reps > 0) {
    return 'This user manages ' + reps + ' rep' + (reps === 1 ? '' : 's') +
      ' — move ' + (reps === 1 ? 'that rep' : 'them') + ' to another manager first, then deactivate.';
  }
  return null;
}

module.exports = {
  canManageTarget: canManageTarget,
  deletePlan: deletePlan,
  tombstoneIdentity: tombstoneIdentity,
  deactivateBlockReason: deactivateBlockReason,
  /* `deleteBlockReason` was REMOVED, not kept as an alias. It meant "history
     blocks the delete" and that rule is gone; an alias would let a stale caller
     go on asking a question that no longer has an answer. */
};
