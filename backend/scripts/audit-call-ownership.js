#!/usr/bin/env node
/**
 * ⚠⚠ THE AUDIT THE NATHAN INCIDENT NEEDED AND DID NOT HAVE.
 *
 * On 2026-08-31, 41 of one closer's calls were ingested into another closer's
 * account. It was found because a human happened to look — `fathom_calls`
 * carried no record of which identity had fetched a row, so no query could say
 * "these calls do not belong to this user".
 *
 * Migration 058 stamps `recorded_by`. This is the invariant it makes checkable:
 *
 *     for every call:  recorded_by == the owner's current fathom_email
 *
 * ⚠ THREE STATES, KEPT APART ON PURPOSE. "Stamped and matching", "stamped and
 * MISMATCHED", and "never stamped" are different facts. Folding NULL in with
 * either one would either invent a violation or report a clean audit over rows
 * it never actually checked — and 1,945 rows predate the column.
 *
 * ⚠ READ-ONLY. It reports; it never repairs. A repair path is a separate,
 * explicit, confirmed admin action — and deleting calls on disconnect stays
 * rejected, because it is the destructive behaviour the preserve-history ruling
 * prevents and would fire on every ordinary disconnect.
 *
 * Usage:  node scripts/audit-call-ownership.js
 */
'use strict';

const PAGE = 1000;

async function auditCallOwnership(admin) {
  const conns = await admin.from('fathom_connections').select('user_id, fathom_email');
  if (conns.error) throw new Error('connections: ' + conns.error.message);
  const identity = {};
  (conns.data || []).forEach(c => { identity[c.user_id] = c.fathom_email || null; });

  let page = 0, rows = [];
  for (;;) {
    const r = await admin.from('fathom_calls')
      .select('id, user_id, fathom_call_id, recorded_by, call_date')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) throw new Error('calls: ' + r.error.message);
    if (!r.data || !r.data.length) break;
    rows = rows.concat(r.data);
    if (r.data.length < PAGE) break;
    page++;
  }

  const out = { total: rows.length, stamped: 0, unstamped: 0, matching: 0, mismatched: [], no_identity: 0 };
  const norm = e => String(e || '').trim().toLowerCase();
  rows.forEach(r => {
    if (!r.recorded_by) { out.unstamped++; return; }
    out.stamped++;
    const want = identity[r.user_id];
    if (!want) { out.no_identity++; return; }
    if (norm(r.recorded_by) === norm(want)) out.matching++;
    else out.mismatched.push({ id: r.id, user_id: r.user_id, fathom_call_id: r.fathom_call_id,
                               recorded_by: r.recorded_by, owner_identity: want, call_date: r.call_date });
  });
  return out;
}

module.exports = { auditCallOwnership };

if (require.main === module) {
  (async () => {
    const { createClient } = require('@supabase/supabase-js');
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const r = await auditCallOwnership(admin);
    console.log('calls total        : ' + r.total);
    console.log('  stamped          : ' + r.stamped + '   (migration 058 onward)');
    console.log('  not stamped      : ' + r.unstamped + '   ⚠ predate the column — NOT checked, not clean');
    console.log('  owner has no id  : ' + r.no_identity);
    console.log('  matching         : ' + r.matching);
    console.log('  ⚠ MISMATCHED     : ' + r.mismatched.length + (r.mismatched.length ? '   <- these do not belong to their owner' : '   ✓'));
    r.mismatched.slice(0, 25).forEach(m => console.log(
      '      call ' + m.fathom_call_id + '  owner_identity=' + m.owner_identity + '  recorded_by=' + m.recorded_by));
    process.exit(r.mismatched.length ? 1 : 0);
  })().catch(e => { console.error('audit failed: ' + e.message); process.exit(2); });
}
