/**
 * Purge the three tombstoned users (Justin's ruling).
 *
 * IRREVERSIBLE. It destroys their calls, analyses, highlights and prospects —
 * history earned while they were on Josh's team, and history they were told
 * would be KEPT under the superseded tombstone contract. That is precisely why
 * the counts are read from the DATABASE before and after rather than taken from
 * the filing, and why Josh's resulting team totals are reported here.
 *
 * IT REUSES lib/user-purge.js — the same path DELETE /admin/users/:id and
 * DELETE /admin/companies/:head_id use. Writing a second deletion path is the
 * one place drift is unrecoverable.
 *
 * TARGETS ARE RESOLVED BY A PROPERTY, NOT BY A PASTED ID: inactive profiles
 * whose email carries the tombstone marker. Each is printed and the count is
 * asserted before anything is deleted.
 *
 * --plan prints and exits. --run executes.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { purgeUsers } = require('../lib/user-purge');

const RUN = process.argv.indexOf('--run') !== -1;
const EXPECTED = 3;

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

async function counts(admin, ids) {
  const out = {};
  for (const [k, table] of [['calls', 'fathom_calls'], ['analyses', 'call_analyses'],
                            ['highlights', 'call_highlights'], ['prospects', 'prospects']]) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).in('user_id', ids);
    out[k] = count || 0;
  }
  return out;
}

async function teamTotals(admin, joshId) {
  const { data: reps } = await admin.from('user_profiles').select('user_id').eq('managed_by', joshId);
  // the board includes the OWNER, not just the reps — the membership rule
  const members = [joshId].concat((reps || []).map(r => r.user_id));
  const { count: calls } = await admin.from('fathom_calls')
    .select('id', { count: 'exact', head: true }).in('user_id', members);
  const { count: graded } = await admin.from('call_analyses')
    .select('id', { count: 'exact', head: true }).in('user_id', members).eq('status', 'done');
  const { count: prospects } = await admin.from('prospects')
    .select('id', { count: 'exact', head: true }).in('user_id', members);
  return { members: members.length, calls: calls || 0, graded: graded || 0, prospects: prospects || 0 };
}

async function main() {
  const admin = db();

  const { data: profs, error } = await admin.from('user_profiles')
    .select('user_id, active, managed_by').eq('active', false);
  if (error) throw new Error('profiles: ' + error.message);

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailOf = {};
  (users && users.users ? users.users : []).forEach(u => { emailOf[u.id] = u.email; });

  const targets = (profs || []).filter(p => /^deleted-/.test(emailOf[p.user_id] || ''));
  console.log('inactive profiles: ' + (profs || []).length + ', tombstoned: ' + targets.length);
  targets.forEach(t => console.log('  ' + t.user_id + '  ' + emailOf[t.user_id] + '  managed_by=' + t.managed_by));

  if (targets.length !== EXPECTED) {
    console.error('REFUSING: expected ' + EXPECTED + ' tombstones, found ' + targets.length);
    process.exit(1);
  }
  const ids = targets.map(t => t.user_id);
  const joshId = targets[0].managed_by;
  if (!joshId || !targets.every(t => t.managed_by === joshId)) {
    console.error('REFUSING: tombstones do not share one manager');
    process.exit(1);
  }

  const before = await counts(admin, ids);
  const teamBefore = await teamTotals(admin, joshId);
  console.log('\nTHEIR data (from the database):', JSON.stringify(before));
  console.log('Josh team BEFORE:', JSON.stringify(teamBefore));

  if (!RUN) { console.log('\n--plan only. Pass --run to execute. IRREVERSIBLE.'); return; }

  const res = await purgeUsers(admin, ids);
  console.log('\npurge:', JSON.stringify(res));

  const after = await counts(admin, ids);
  const teamAfter = await teamTotals(admin, joshId);
  console.log('THEIR data after: ', JSON.stringify(after));
  console.log('Josh team AFTER: ', JSON.stringify(teamAfter));
  console.log('\nmoved: members ' + teamBefore.members + ' -> ' + teamAfter.members
    + ' | calls ' + teamBefore.calls + ' -> ' + teamAfter.calls
    + ' | graded ' + teamBefore.graded + ' -> ' + teamAfter.graded
    + ' | prospects ' + teamBefore.prospects + ' -> ' + teamAfter.prospects);

  const residue = Object.values(after).reduce((a, b) => a + b, 0);
  console.log(residue === 0 ? 'residue: NONE' : 'RESIDUE REMAINS: ' + JSON.stringify(after));
}

main().catch(e => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
