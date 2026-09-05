// lib/kb-scope.js — THE single source of truth for knowledge_base visibility.
//
// KB Part 2, sub-stage 2a. Before this module the same four-branch rule was
// written out FOUR separate times:
//   1. the match_knowledge RPC's WHERE clause          (migrations/006 → 029)
//   2. lib/kb-visibility.js kbReadRowVisible           (now re-exports from here)
//   3. the inline JS filter in routes/kb.js /kb/search (now calls kbReadRowVisible)
//   4. the team branch of lib/selling-context.js       (now uses TEAM_KEY_COLUMN)
// Three of the four are JS and now import this module. The fourth is SQL and
// CANNOT import it — see "Keeping the SQL copy honest" below.
//
// ── The rule ──────────────────────────────────────────────────────────────
// A caller may SEE a row iff ANY of:
//   • uploaded_by IS NULL                          — seeded framework rows
//   • scope = 'global'                             — owner uploads, everyone
//   • scope = 'personal' AND uploaded_by = p_user_id
//   • scope = 'team'     AND teamKey(row) = p_admin_id
//
// scope = { p_user_id, p_admin_id } from resolveUserScope():
//   • p_user_id  — the caller's own id (their personal uploads)
//   • p_admin_id — the caller's "team key": their own id if manager/owner,
//                  else their managed_by. The id the team's material hangs off.
//
// ── Why team_owner_id exists (the 2a change) ──────────────────────────────
// The OLD team branch was `scope='team' AND uploaded_by = p_admin_id` — i.e.
// "a team row is one the MANAGER uploaded". That made promotion impossible:
// flipping a REP's entry to scope='team' left uploaded_by pointing at the rep,
// so the row became visible to NOBODY. The only way to promote was to rewrite
// uploaded_by to the manager, destroying provenance (which rep's call it came
// from) — which the Part 2 button needs for attribution.
//
// team_owner_id splits the two concerns: uploaded_by stays TRUE PROVENANCE,
// team_owner_id carries the team key. teamKeyOf() falls back to uploaded_by
// when team_owner_id is absent, so every pre-2a row keeps its exact old
// meaning and the migration is non-breaking.
//
// ── Keeping the SQL copy honest ───────────────────────────────────────────
// The match_knowledge RPC runs inside Postgres and cannot require() this file.
// Two guards, both in test/kb-scope-sql-mirror.test.js:
//   (a) KB_VISIBILITY_SQL below is the canonical clause TEXT; the test reads
//       migrations/029 off disk and asserts it contains this exact string, so
//       the migration cannot say something different from what JS believes.
//   (b) the test evaluates the SQL clause as a JS boolean expression against
//       the same row/scope fixtures the predicate suite uses, asserting the SQL
//       and the JS agree row-for-row — so the two can't drift semantically even
//       if both are edited together.
// Neither guard can prove what's DEPLOYED matches the migration file; that's
// what the live end-to-end verification in the 2a findings covers.

// The exact WHERE-clause text used by the match_knowledge RPC. Kept here (not
// in the migration alone) so JS owns the canonical wording and the mirror test
// has something to compare against. COALESCE mirrors teamKeyOf's fallback.
var KB_VISIBILITY_SQL = [
  'kb.uploaded_by IS NULL',
  "OR kb.scope = 'global'",
  "OR (kb.scope = 'personal' AND kb.uploaded_by = p_user_id)",
  "OR (kb.scope = 'team'     AND COALESCE(kb.team_owner_id, kb.uploaded_by) = p_admin_id)",
].join('\n      ');

// The column carrying a team row's owning team key. Exported so query builders
// (selling-context, the promotion route) reference it by constant rather than
// hardcoding a fifth copy of the name.
var TEAM_KEY_COLUMN = 'team_owner_id';

// Which id a team row belongs to. Explicit team_owner_id wins; legacy rows fall
// back to uploaded_by (the pre-2a implicit rule). null when neither is present.
function teamKeyOf(row) {
  if (!row) return null;
  if (row.team_owner_id !== null && row.team_owner_id !== undefined) return row.team_owner_id;
  if (row.uploaded_by !== null && row.uploaded_by !== undefined) return row.uploaded_by;
  return null;
}

// H734 — DOCTRINE IS INVISIBLE INFRASTRUCTURE (Justin, 2026-09-05): a doctrine row (category 'doctrine',
// global, no uploader — H732) is how Scout thinks, never a search result. Both visibility arms below would
// admit it, so it is refused FIRST here and by the same conjunct in the match_knowledge RPC (migration 072,
// text mirrored as KB_HIDDEN_FROM_SEARCH_SQL). The advice lanes read it by category (lib/doctrine) — untouched.
var KB_HIDDEN_FROM_SEARCH_SQL = "kb.category IS DISTINCT FROM 'doctrine'";
function hiddenFromSearch(row) { return !!row && row.category === 'doctrine'; }

// The read-scope predicate. Fail-closed: any missing input denies access.
function kbReadRowVisible(row, scope) {
  if (!row) return false;
  if (hiddenFromSearch(row)) return false;                                     // H734: the doctrine, never
  if (row.uploaded_by === null || row.uploaded_by === undefined) return true; // seeded framework — none remain (H732); the arm now admits the doctrine to the LANES only, never here
  if (row.scope === 'global') return true;                                     // owner global uploads
  if (!scope) return false;
  if (row.scope === 'personal' && row.uploaded_by === scope.p_user_id) return true;
  if (row.scope === 'team') {
    var key = teamKeyOf(row);
    // p_admin_id null (caller has no team) must never match a null team key.
    if (scope.p_admin_id && key && key === scope.p_admin_id) return true;
  }
  return false;
}

module.exports = {
  kbReadRowVisible: kbReadRowVisible,
  teamKeyOf: teamKeyOf,
  KB_VISIBILITY_SQL: KB_VISIBILITY_SQL,
  KB_HIDDEN_FROM_SEARCH_SQL: KB_HIDDEN_FROM_SEARCH_SQL, hiddenFromSearch: hiddenFromSearch,
  TEAM_KEY_COLUMN: TEAM_KEY_COLUMN,
};
