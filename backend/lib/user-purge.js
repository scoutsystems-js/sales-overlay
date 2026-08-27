/* PURGE — remove a set of users AND everything they produced.
 *
 * ⚠⚠ ONE IMPLEMENTATION, TWO CALLERS: DELETE /admin/companies/:head_id and
 * DELETE /admin/users/:user_id. The company route had this inline; a single-user
 * delete now has the SAME blast radius (Justin's ruling 2026-08-26), and writing
 * a second copy would let the two drift on exactly the operation where drift is
 * unrecoverable.
 *
 * ⚠⚠ ORDER IS LOAD-BEARING, NOT STYLE:
 *   1  knowledge_base has NO foreign key to auth.users, so its rows SURVIVE the
 *      cascade. Delete them FIRST — deleting the users first orphans them beyond
 *      the reach of this scope, permanently, with nothing to find them by.
 *   2  `profiles` (vestigial, from an old starter template) has a NO ACTION
 *      foreign key that BLOCKS the auth delete outright.
 *   3  the auth row. Everything else cascades from here — fathom_calls,
 *      call_analyses, call_highlights, prospects, eod_edits, call_sessions,
 *      session_logs, session_objections, connections, synthesis cache,
 *      user_profiles. Verified against the live schema, not assumed.
 *
 * ⚠ GLOBAL KB ROWS ARE KEPT DELIBERATELY. `KB_SCOPES_TO_DELETE` is personal +
 * team; a global row is shared material other people are still graded against,
 * and removing it would change how everyone else's calls are scored.
 */
var KB_SCOPES_TO_DELETE = require('./company-lifecycle').KB_SCOPES_TO_DELETE;

async function purgeUsers(admin, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { deleted: [], failed: [], kb_rows_deleted: 0 };
  }

  // 1 · KB rows that would otherwise survive — personal + team only.
  var kbDel = await admin.from('knowledge_base').delete()
    .in('uploaded_by', ids).in('scope', KB_SCOPES_TO_DELETE).select('id');
  if (kbDel.error) throw new Error('kb delete failed: ' + kbDel.error.message);

  // 2 · the vestigial profiles row, whose NO ACTION FK would block the delete.
  await admin.from('profiles').delete().in('id', ids);

  // 3 · the auth users. Everything else cascades.
  // ⚠ PER USER, AND FAILURES ARE COLLECTED RATHER THAN THROWN. One account
  // failing must not abandon the rest half-deleted with no report of which.
  var deleted = [], failed = [];
  for (var i = 0; i < ids.length; i++) {
    var d = await admin.auth.admin.deleteUser(ids[i]);
    if (d.error) { failed.push({ user_id: ids[i], error: d.error.message }); continue; }
    deleted.push(ids[i]);
  }

  return { deleted: deleted, failed: failed, kb_rows_deleted: (kbDel.data || []).length };
}

module.exports = { purgeUsers: purgeUsers, KB_SCOPES_TO_DELETE: KB_SCOPES_TO_DELETE };
