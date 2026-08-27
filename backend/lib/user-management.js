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
 * ⚠⚠⚠ THE TOMBSTONE IS GONE — SUPERSEDED BY JUSTIN'S RULING, 2026-08-26.
 * Deleting a user now deletes their calls and history too, the same blast
 * radius as deleting a company. **The earlier "calls survive a user delete"
 * design is SUPERSEDED, not a bug** — it is recorded that way in CLAUDE.md so
 * nobody reads the two and tries to restore one.
 *
 * ⚠⚠ HIS REASONING, AND IT IS WHAT MAKES THIS COHERENT RATHER THAN MERELY
 * DESTRUCTIVE: *"we have DEACTIVATE as the safeguard and it's why only admins
 * can actually delete people."* There are TWO DOORS.
 *   DEACTIVATE  the everyday action. The person is switched off, every number
 *               they produced stays, nothing breaks, fully reversible.
 *   DELETE      deliberate and destructive, and it takes their history with it.
 * **THE SAFEGUARD IS NEITHER A DIALOG NOR A RECOVERABLE COPY — it is that the
 * destructive door is behind the ADMIN role.** That is why the admin check must
 * be enforced SERVER-SIDE rather than by hiding a button, and why the
 * confirmation must still name the cost. Anyone later tempted to soften delete,
 * add an undo, or open it to managers should read this first.
 *
 * ⚠ MEASURED 2026-08-24, and it is why this works with no migration: EVERY
 * history table cascades on an `auth.users` delete — fathom_calls,
 * call_analyses, call_highlights, prospects, eod_edits, the session tables,
 * user_profiles. Proven on a throwaway: 2 calls and 2 analyses in, delete the
 * auth row, 0 out. `knowledge_base` is the one exception and is handled
 * explicitly in lib/user-purge.js.
 *
 *   'purge'   — delete the account AND everything it produced.
 *   'blocked' — still manages reps. Those reps would end up managed by a
 *               deleted person, so move them first (same rule deactivate has).
 *
 * ⚠⚠ RENAMED 'hard' -> 'purge' ON PURPOSE. 'hard' used to mean "no history, so
 * nothing to preserve"; it would now mean "destroy the history too". **A value
 * whose MEANING changes while its type does not is the silent-semantic-change
 * trap** — every existing caller keeps working and keeps producing confident
 * wrong output. Renaming forces each one to be found.
 *
 * @returns {{mode:'purge'|'blocked', reason:string|null, calls:number}}
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
  return { mode: 'purge', calls: calls, reason: null };
}

/**
 * The identity a tombstoned user is scrubbed to.
 *
 * ⚠⚠ LEGACY ONLY — NOTHING CALLS THIS ANY MORE. The tombstone was superseded on
 * 2026-08-26 (a delete now destroys the account and its history), so no NEW row
 * can be created in this shape. It is kept, not deleted, because THREE ROWS IN
 * PRODUCTION still carry this identity from before the ruling — they hold 117
 * calls between them and what to do with them is Justin's decision, not a
 * tidy-up. Delete this function once those rows are resolved.
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

/**
 * The confirmation text for deleting ONE person.
 *
 * ⚠ IT MUST NAME THE COST — who, how many calls, and that there is no undo. A
 * destructive action described in the abstract ("are you sure?") tells the
 * reader nothing they can weigh. Mirrors company-lifecycle.deleteConfirmation
 * deliberately: the two destructive actions should read in one voice.
 * ⚠ IT ALSO NAMES THE OTHER DOOR. Deactivate keeps every number and is
 * reversible, and someone about to delete may simply not want this.
 */
function deleteUserConfirmation(email, callCount) {
  var c = callCount === 1 ? '1 call' : callCount + ' calls';
  return 'Delete ' + (email || 'this user') + '?\n\n'
    + 'This permanently deletes their account and ' + c + ', along with every '
    + 'grade, highlight, objection, prospect and EOD entry belonging to them.\n\n'
    + 'This CANNOT be undone. There is no recovery.\n\n'
    + 'If you only want to switch them off, use Deactivate instead — that keeps '
    + 'all of their numbers and can be reversed.';
}

module.exports = {
  deleteUserConfirmation: deleteUserConfirmation,
  canManageTarget: canManageTarget,
  deletePlan: deletePlan,
  tombstoneIdentity: tombstoneIdentity,
  deactivateBlockReason: deactivateBlockReason,
  /* `deleteBlockReason` was REMOVED, not kept as an alias. It meant "history
     blocks the delete" and that rule is gone; an alias would let a stale caller
     go on asking a question that no longer has an answer. */
};
