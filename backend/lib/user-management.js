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

// Delete is owner-only + zero-history: any recorded calls (fathom or session)
// block a hard delete — the history is the company's asset. Returns a reason
// string when blocked, else null.
function deleteBlockReason(callCount, sessionCount) {
  var n = (Number(callCount) || 0) + (Number(sessionCount) || 0);
  if (n > 0) {
    return 'This rep has ' + n + ' recorded call' + (n === 1 ? '' : 's') +
      ' — deactivate to free the seat; delete is only for accounts with no call history.';
  }
  return null;
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

module.exports = { canManageTarget: canManageTarget, deleteBlockReason: deleteBlockReason, deactivateBlockReason: deactivateBlockReason };
