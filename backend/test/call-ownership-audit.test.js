/**
 * ⚠⚠ THE AUDIT MUST KEEP THREE STATES APART. "Stamped and matching",
 * "stamped and MISMATCHED", and "never stamped" are different facts, and 1,945
 * rows predate the column. Folding NULL into `matching` reports a clean audit
 * over rows it never checked; folding it into `mismatched` invents 1,945
 * violations. Both are the absent-vs-excluded collapse this project has paid
 * for repeatedly.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { auditCallOwnership } = require('../scripts/audit-call-ownership.js');

function fakeAdmin(conns, calls) {
  return {
    from(table) {
      if (table === 'fathom_connections') {
        return { select: async () => ({ data: conns, error: null }) };
      }
      return { select: () => ({ range: async (a) => ({ data: a === 0 ? calls : [], error: null }) }) };
    },
  };
}

const CONNS = [{ user_id: 'u1', fathom_email: 'a@x.com' }, { user_id: 'u2', fathom_email: 'b@x.com' }];

test('a mismatch is reported with both identities', async () => {
  const r = await auditCallOwnership(fakeAdmin(CONNS, [
    { id: '1', user_id: 'u1', fathom_call_id: 'c1', recorded_by: 'a@x.com' },
    { id: '2', user_id: 'u1', fathom_call_id: 'c2', recorded_by: 'b@x.com' }, // the Nathan shape
  ]));
  assert.strictEqual(r.matching, 1);
  assert.strictEqual(r.mismatched.length, 1);
  assert.strictEqual(r.mismatched[0].fathom_call_id, 'c2');
  assert.strictEqual(r.mismatched[0].owner_identity, 'a@x.com');
  assert.strictEqual(r.mismatched[0].recorded_by, 'b@x.com');
});

test('⚠ an UNSTAMPED row is neither matching nor mismatched', async () => {
  const r = await auditCallOwnership(fakeAdmin(CONNS, [
    { id: '1', user_id: 'u1', fathom_call_id: 'c1', recorded_by: null },
    { id: '2', user_id: 'u1', fathom_call_id: 'c2', recorded_by: 'a@x.com' },
  ]));
  assert.strictEqual(r.unstamped, 1, 'NULL must be counted as unchecked');
  assert.strictEqual(r.matching, 1);
  assert.strictEqual(r.mismatched.length, 0, 'NULL must NOT be reported as a violation');
  assert.strictEqual(r.stamped + r.unstamped, r.total, 'the three states must reconcile to the total');
});

test('case and whitespace do not create a false mismatch', async () => {
  const r = await auditCallOwnership(fakeAdmin(CONNS, [
    { id: '1', user_id: 'u1', fathom_call_id: 'c1', recorded_by: '  A@X.com ' },
  ]));
  assert.strictEqual(r.mismatched.length, 0);
  assert.strictEqual(r.matching, 1);
});

test('an owner with no stored identity cannot be judged', async () => {
  const r = await auditCallOwnership(fakeAdmin(
    [{ user_id: 'u1', fathom_email: null }],
    [{ id: '1', user_id: 'u1', fathom_call_id: 'c1', recorded_by: 'a@x.com' }]));
  assert.strictEqual(r.no_identity, 1);
  assert.strictEqual(r.mismatched.length, 0, 'no identity to compare against is not a violation');
});

test('⚠ the audit is READ-ONLY — it must never delete or update', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'audit-call-ownership.js'), 'utf8');
  const live = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(live.length > 800, 'strip must leave the module: ' + live.length);
  assert.ok(!/\.delete\(/.test(live), 'the audit must not delete');
  assert.ok(!/\.update\(/.test(live), 'the audit must not update');
  assert.ok(!/\.upsert\(/.test(live), 'the audit must not write');
});
