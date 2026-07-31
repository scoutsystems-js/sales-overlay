// provisionUser(deps, opts) — atomic create-user orchestration over injected deps
// so the two-system (Supabase auth + user_profiles) create either FULLY succeeds
// or leaves NOTHING NEW behind (ruling 2026-07-31). Also handles the orphan case:
// a prior failed create can leave an auth row with no profile, which makes a
// genuinely-fresh email fail with "already registered" — we RECLAIM that orphan
// (reset its password + create the profile) rather than fail or stack another one.
//
// deps (all async):
//   createAuthUser(email, password)        -> { id } | { error }
//   findAuthUserByEmail(email)             -> { id } | null
//   profileExists(userId)                  -> boolean
//   setPassword(userId, password)          -> { error? }
//   insertProfile(userId, fields)          -> { error? }   fields: {role, managed_by, firstName, lastName}
//   deleteAuthUser(userId)                 -> { error? }
//
// opts: { email, role, managedBy, firstName, lastName, password }
// returns: { ok:true, user_id, reclaimed } | { error, code, orphanId? }
async function provisionUser(deps, opts) {
  var created = await deps.createAuthUser(opts.email, opts.password);
  var userId;
  var reclaimed = false;

  if (created && created.error) {
    // Create failed. If an auth row already exists for this email, it's either a
    // real duplicate (has a profile) or an orphan (no profile) we can reclaim.
    var existing = await deps.findAuthUserByEmail(opts.email);
    if (!existing || !existing.id) {
      return { error: created.error, code: 'create_failed' };
    }
    var has = await deps.profileExists(existing.id);
    if (has) {
      return { error: 'A user with this email already exists.', code: 'duplicate' };
    }
    // Orphan: adopt it. Reset the password so the fresh temp-password / invite link
    // works, then fall through to create the profile.
    var pw = await deps.setPassword(existing.id, opts.password);
    if (pw && pw.error) {
      return { error: 'Found a stale account for this email but could not reset it: ' + pw.error, code: 'orphan_reclaim_failed' };
    }
    userId = existing.id;
    reclaimed = true;
  } else {
    userId = created.id;
  }

  var ins = await deps.insertProfile(userId, {
    role: opts.role, managed_by: opts.managedBy, firstName: opts.firstName, lastName: opts.lastName,
  });
  if (ins && ins.error) {
    // Roll back ONLY a freshly-created auth user — never delete a pre-existing
    // (reclaimed) row we didn't create. A fresh create must leave nothing behind.
    if (!reclaimed) {
      var del = await deps.deleteAuthUser(userId);
      if (del && del.error) {
        return { error: 'Could not create the user and the rollback failed — orphan auth user ' + userId + ' remains. Clean it up before retrying.', code: 'rollback_failed', orphanId: userId };
      }
    }
    return { error: 'Could not create the user profile — no account was created.', code: 'profile_failed' };
  }

  return { ok: true, user_id: userId, reclaimed: reclaimed };
}

module.exports = provisionUser;
