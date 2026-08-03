// lib/kb-visibility.js — SUPERSEDED by lib/kb-scope.js (KB Part 2, sub-stage 2a).
//
// This module used to hold its own copy of the read-scope predicate. 2a collapsed
// the four duplicated copies (this one, the match_knowledge RPC, the inline filter
// in routes/kb.js /kb/search, and the team branch of lib/selling-context.js) into
// lib/kb-scope.js.
//
// Kept as a re-export shim so existing importers keep working unchanged and the
// contract suite test/kb-visibility.test.js still exercises the REAL predicate.
// New code should require('./kb-scope') directly.
//
// The original implementation is preserved below, commented in place. Note its team
// branch keyed on `uploaded_by === scope.p_admin_id` — that is precisely the rule
// that made promotion impossible (a rep's promoted row would have been visible to
// nobody, because visibility demanded uploaded_by BE the manager). See the header
// of lib/kb-scope.js for the full reasoning.

var kbScope = require('./kb-scope');

// ── ORIGINAL IMPLEMENTATION (superseded 2026-08-03 by lib/kb-scope.js) ──────
// // kbReadRowVisible(row, scope) — the single read-scope predicate for the
// // knowledge_base. Decides whether a caller may SEE a row. Used by /kb/search and
// // the read-only /kb/list (managed reps get read-only access to their team's KB).
// //
// // scope = { p_user_id, p_admin_id } from resolveUserScope():
// //   • p_user_id  — the caller's own user id (their personal uploads).
// //   • p_admin_id — the caller's "team key": a manager/owner's own id; a managed
// //                  rep's manager id (managed_by). This is the id under which the
// //                  team's `scope:'team'` content was uploaded.
// //
// // Visible iff: seeded framework (uploaded_by null) OR owner-global OR own-personal
// // OR own-team (scope 'team' AND uploaded_by === p_admin_id). Everything else —
// // crucially another team's uploads — is NOT visible.
// function kbReadRowVisible(row, scope) {
//   if (!row) return false;
//   if (row.uploaded_by === null || row.uploaded_by === undefined) return true; // seeded/global framework
//   if (row.scope === 'global') return true;                                     // owner global uploads
//   if (row.scope === 'personal' && scope && row.uploaded_by === scope.p_user_id) return true;
//   if (row.scope === 'team' && scope && scope.p_admin_id && row.uploaded_by === scope.p_admin_id) return true;
//   return false;
// }

module.exports = { kbReadRowVisible: kbScope.kbReadRowVisible };
