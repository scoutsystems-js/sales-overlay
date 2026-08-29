/**
 * ONE HOME FOR THE CONSTANTS MORE THAN ONE MODULE HAS TO AGREE ON.
 *
 * The payment-structure allowlist existed THREE times: analysis-worker (which
 * sanitises what the grader returns), routes/eod (which validates what a human
 * edits), and a CHECK constraint in migration 022. Each JS copy had its own
 * test, so a drift would have surfaced as one test failing and the other
 * passing — never as a disagreement between them.
 *
 * The sync cap was never duplicated but had no home: routes/zoom imported it
 * from routes/fathom, which is a route file depending on another route file
 * for a constant.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../lib/sales-constants');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function code(s) {
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('every JS consumer reads the shared list rather than writing its own', () => {
  [['lib/analysis-worker.js', 'VALID_PAYMENT_STRUCTURES'],
   ['routes/eod.js', 'PAYMENT_STRUCTURES']].forEach(([rel, name]) => {
    const src = code(read(rel));
    assert.ok(new RegExp(name + " = require\\('[./]*(lib/)?sales-constants'\\)\\.PAYMENT_STRUCTURES").test(src),
      rel + ' must import the shared list');
    // and must not have re-declared it inline
    assert.ok(!new RegExp(name + " = \\[").test(src), rel + ' still declares its own copy');
  });
});

test('the SQL copy cannot import, so it is pinned textually', () => {
  /* ⚠ Migration 022's CHECK is the third copy and the one that BITES: adding a
     value in JS without a migration writes a row the database rejects. */
  const sql = read('migrations/022_payment_structure_eod_summary.sql');
  C.PAYMENT_STRUCTURES.forEach(v => {
    assert.ok(sql.indexOf("'" + v + "'") !== -1,
      v + ' is allowed in JS but not by the CHECK constraint — a write would be rejected');
  });
  // and nothing in the constraint that JS does not know about
  const inSql = (sql.match(/'(paid_in_full|payment_plan|bnpl|none_stated|[a-z_]+)'/g) || [])
    .map(x => x.replace(/'/g, ''))
    .filter(x => /^(paid_in_full|payment_plan|bnpl|none_stated)$/.test(x));
  assert.ok(inSql.length >= C.PAYMENT_STRUCTURES.length, 'the constraint must cover every JS value');
});

test('the sync cap has a home, and no route imports another route for it', () => {
  assert.strictEqual(typeof C.FIRST_SYNC_ANALYZE_CAP, 'number');
  assert.ok(C.FIRST_SYNC_ANALYZE_CAP > 0);
  const zoom = code(read('routes/zoom.js'));
  assert.ok(/FIRST_SYNC_ANALYZE_CAP = require\('\.\.\/lib\/sales-constants'\)/.test(zoom),
    'zoom must take the cap from the shared module');
  assert.ok(!/FIRST_SYNC_ANALYZE_CAP = fathomRoutes\._FIRST_SYNC_ANALYZE_CAP/.test(zoom),
    'a route file must not import another route file for a constant');
  const fathom = code(read('routes/fathom.js'));
  assert.ok(/FIRST_SYNC_ANALYZE_CAP = require\('\.\.\/lib\/sales-constants'\)/.test(fathom),
    'fathom must read the same home');
});

test('both providers still share ONE cap — that is the property, not the number', () => {
  /* ⚠ The cap being SHARED is what the first-sync ruling depends on. The number
     may be tuned; two providers disagreeing about it may not. */
  const fathomRoutes = require('../routes/fathom');
  const zoomRoutes = require('../routes/zoom');
  assert.strictEqual(fathomRoutes._FIRST_SYNC_ANALYZE_CAP, C.FIRST_SYNC_ANALYZE_CAP);
  assert.strictEqual(zoomRoutes._FIRST_SYNC_ANALYZE_CAP, C.FIRST_SYNC_ANALYZE_CAP);
});
