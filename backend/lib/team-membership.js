'use strict';
/**
 * ⚠⚠ ONE DEFINITION OF "WHO IS ON THIS TEAM", because it has now been got wrong
 * NINE TIMES.
 *
 * A team is the users whose `managed_by` points at a key user, PLUS THAT USER.
 * The manager sells too — on Josh's board he is the only member with real calls —
 * and `managed_by` cannot contain him by construction, so every consumer that
 * builds the list from `managed_by` alone silently drops him.
 *
 * `9a27979` fixed that at eight endpoints by routing them through resolveTeam.
 * The daily digest was the ninth and did not get it, because resolveTeam takes an
 * Express `req` (it reads req.user and ?team=) and digest generation runs from the
 * sync cron with no request. So the reusable thing is the RULE, which lives here;
 * routes/team.js and lib/team-digest.js both consume it.
 *
 * ⚠ DO NOT re-implement either function at a call site. The tenth copy is the
 * same defect waiting to happen, and it will present as a wrong NUMBER rather
 * than an error — "quiet day · 0 calls" on a day someone worked.
 */

/** The rule: reps plus the board owner, deduped, input untouched. */
function withBoardOwner(keyId, repIds) {
  var out = (repIds || []).slice();
  if (keyId && out.indexOf(keyId) === -1) out.push(keyId);
  return out;
}

/**
 * Build {keyId: memberIds[]} from user_profiles rows, INCLUDING each manager in
 * their own list. Only users who actually have reps become keys — having a
 * manager does not make you one.
 * @param {Array<{user_id:string, managed_by:string|null}>} rows
 */
function membersByManager(rows) {
  var reps = {};
  (rows || []).forEach(function (p) {
    if (p && p.managed_by) (reps[p.managed_by] = reps[p.managed_by] || []).push(p.user_id);
  });
  var out = {};
  Object.keys(reps).forEach(function (keyId) { out[keyId] = withBoardOwner(keyId, reps[keyId]); });
  return out;
}

module.exports = { withBoardOwner: withBoardOwner, membersByManager: membersByManager };
