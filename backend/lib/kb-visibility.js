// kbReadRowVisible(row, scope) — the single read-scope predicate for the
// knowledge_base. Decides whether a caller may SEE a row. Used by /kb/search and
// the read-only /kb/list (managed reps get read-only access to their team's KB).
//
// scope = { p_user_id, p_admin_id } from resolveUserScope():
//   • p_user_id  — the caller's own user id (their personal uploads).
//   • p_admin_id — the caller's "team key": a manager/owner's own id; a managed
//                  rep's manager id (managed_by). This is the id under which the
//                  team's `scope:'team'` content was uploaded.
//
// Visible iff: seeded framework (uploaded_by null) OR owner-global OR own-personal
// OR own-team (scope 'team' AND uploaded_by === p_admin_id). Everything else —
// crucially another team's uploads — is NOT visible.
function kbReadRowVisible(row, scope) {
  if (!row) return false;
  if (row.uploaded_by === null || row.uploaded_by === undefined) return true; // seeded/global framework
  if (row.scope === 'global') return true;                                     // owner global uploads
  if (row.scope === 'personal' && scope && row.uploaded_by === scope.p_user_id) return true;
  if (row.scope === 'team' && scope && scope.p_admin_id && row.uploaded_by === scope.p_admin_id) return true;
  return false;
}

module.exports = { kbReadRowVisible: kbReadRowVisible };
