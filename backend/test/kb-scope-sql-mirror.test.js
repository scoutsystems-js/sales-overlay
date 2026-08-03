// The match_knowledge RPC runs inside Postgres and CANNOT require() lib/kb-scope.js,
// so the visibility rule necessarily exists twice: once in JS, once in SQL. This is
// the guard that keeps the SQL copy honest — same pattern as
// section-breakdown-mirror.test.js and tile-metrics-mirror.test.js.
//
// Two independent checks:
//   (a) TEXTUAL — migrations/029 must contain KB_VISIBILITY_SQL verbatim, so the
//       migration cannot quietly say something different from what JS believes.
//   (b) SEMANTIC — the SQL clause is transpiled to a JS boolean expression and
//       evaluated against the SAME fixtures as the predicate suite, asserting the
//       SQL and the JS agree row-for-row. Catches a drift where both were edited
//       but to different meanings.
//
// What this CANNOT prove: that the function actually DEPLOYED to Supabase matches
// this file. Only running the migration proves that — covered by the live
// end-to-end verification in the 2a findings.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { kbReadRowVisible, KB_VISIBILITY_SQL } = require('../lib/kb-scope');

const MIGRATION = path.join(__dirname, '..', 'migrations', '029_kb_team_owner.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');

test('(a) migration 029 contains the canonical visibility clause verbatim', () => {
  assert.ok(
    sql.includes(KB_VISIBILITY_SQL),
    'migrations/029_kb_team_owner.sql no longer contains KB_VISIBILITY_SQL from lib/kb-scope.js.\n' +
    'The RPC and the JS predicate have drifted. Expected to find:\n\n' + KB_VISIBILITY_SQL
  );
});

test('(a2) the OLD uploaded_by-keyed team branch is gone from the RPC', () => {
  // The pre-2a rule. If this survives, promotion is silently broken again.
  assert.ok(
    !/scope\s*=\s*'team'\s+AND\s+kb\.uploaded_by\s*=\s*p_admin_id/.test(sql),
    'migration 029 still keys the team branch on uploaded_by — promoted rows would be visible to nobody'
  );
});

// ── (b) semantic equivalence ─────────────────────────────────────────────
// Transpile the SQL clause into an equivalent JS expression. Deliberately a
// small, total translation of the exact constructs used in the clause — if
// someone adds SQL this can't express, the transpile throws rather than
// silently passing.
function sqlClauseToJs(clause) {
  const allowed = /^[\sA-Za-z0-9_.'()=,]*$/;
  assert.ok(allowed.test(clause), 'SQL clause uses constructs the mirror test cannot transpile: ' + clause);
  return clause
    .replace(/COALESCE\(([^,]+),\s*([^)]+)\)/g, '(($1) ?? ($2))')
    .replace(/\bIS NULL\b/g, '=== null')
    .replace(/\bOR\b/g, '||')
    .replace(/\bAND\b/g, '&&')
    .replace(/([^=!<>])=([^=])/g, '$1===$2')
    .replace(/kb\.(\w+)/g, 'row.$1')
    .replace(/'/g, '"');
}

function evalSql(row, scope) {
  const js = sqlClauseToJs(KB_VISIBILITY_SQL);
  // SQL sees SQL NULL for a missing column; normalize undefined → null so the
  // comparison semantics match what Postgres would actually do.
  const r = {
    uploaded_by:   row.uploaded_by   === undefined ? null : row.uploaded_by,
    scope:         row.scope         === undefined ? null : row.scope,
    team_owner_id: row.team_owner_id === undefined ? null : row.team_owner_id,
  };
  const fn = new Function('row', 'p_user_id', 'p_admin_id', 'return !!(' + js + ');');
  return fn(r, scope.p_user_id ?? null, scope.p_admin_id ?? null);
}

const rep = { p_user_id: 'rep-1', p_admin_id: 'mgr-1' };
const solo = { p_user_id: 'u-1', p_admin_id: null };

const FIXTURES = [
  // [row, scope, label]
  [{ uploaded_by: null, scope: null }, rep, 'seeded'],
  [{ uploaded_by: 'owner-9', scope: 'global' }, rep, 'global'],
  [{ uploaded_by: 'rep-1', scope: 'personal' }, rep, 'own personal'],
  [{ uploaded_by: 'other', scope: 'personal' }, rep, "another's personal"],
  [{ uploaded_by: 'mgr-1', scope: 'team' }, rep, 'legacy team row (own team)'],
  [{ uploaded_by: 'mgr-2', scope: 'team' }, rep, 'legacy team row (other team)'],
  [{ uploaded_by: 'rep-1', team_owner_id: 'mgr-1', scope: 'team' }, rep, 'PROMOTED row, own team'],
  [{ uploaded_by: 'rep-1', team_owner_id: 'mgr-2', scope: 'team' }, rep, 'promoted row, other team'],
  [{ uploaded_by: 'mgr-1', team_owner_id: 'mgr-2', scope: 'team' }, rep, 'team_owner_id overrides uploaded_by'],
  [{ uploaded_by: 'mgr-1', scope: 'team' }, solo, 'team row, caller has no team'],
  [{ uploaded_by: 'x', scope: 'global' }, solo, 'global, caller has no team'],
  [{ uploaded_by: 'mgr-1', scope: 'weird' }, rep, 'unknown scope'],
  [{ uploaded_by: 'mgr-1' }, rep, 'no scope'],
];

test('(b) the SQL clause and the JS predicate agree on every fixture', () => {
  for (const [row, scope, label] of FIXTURES) {
    assert.strictEqual(
      evalSql(row, scope),
      kbReadRowVisible(row, scope),
      'SQL/JS disagree on: ' + label + ' → ' + JSON.stringify(row)
    );
  }
});

test('(b2) the promoted-row fixture is genuinely visible (guards a vacuous pass)', () => {
  // If both implementations were broken the same way, (b) would pass on all-false.
  // Pin the one case 2a exists to enable.
  const promoted = { uploaded_by: 'rep-1', team_owner_id: 'mgr-1', scope: 'team' };
  assert.strictEqual(kbReadRowVisible(promoted, rep), true);
  assert.strictEqual(evalSql(promoted, rep), true);
});
