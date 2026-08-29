/**
 * Mark calls whose recording source no longer exists as NOT GRADEABLE.
 *
 * Justin's ruling: yazan connected Zoom, then Fathom, then disconnected Zoom.
 * Everything now arrives via Fathom, so his 181 ungraded Zoom calls can never
 * have a transcript fetched — there is no connection to fetch it with.
 *
 * ⚠ NOTHING IS DELETED. The rows stay, visible and labelled. What changes is
 * that they stop reading as a backlog waiting to happen: they were
 * indistinguishable from calls merely queued for grading, which is the ambiguity
 * that sized an approved spend run at 616 calls when ~63 were gradeable.
 *
 * ⚠ IT REUSES THE ONE EXCLUSION FLAG and adds only the reason, exactly as the
 * compromised-file work does. It does NOT clear scores or highlights — unlike a
 * compromised file, nothing here was graded from an unreadable source; these
 * were never graded at all.
 *
 * ⚠ AND IT NEVER OVERRULES A PERSON: a call someone has explicitly said counts
 * is skipped, the same read-before-write guard the gate uses.
 *
 * --plan prints and exits. --run executes.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');

const RUN = process.argv.indexOf('--run') !== -1;
const EMAIL = process.env.TARGET_EMAIL || 'yazan@soberlivingriches.com';
const SOURCE = process.env.TARGET_SOURCE || 'zoom';

async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = (users.users || []).find(u => u.email === EMAIL);
  if (!user) { console.error('REFUSING: no such user ' + EMAIL); process.exit(1); }

  /* ⚠ THE PRECONDITION IS THE WHOLE JUSTIFICATION: this is only correct if the
     connection really is gone. If one exists, these calls ARE gradeable and
     marking them would hide real work. */
  const { data: conn } = await db.from('call_connections')
    .select('provider').eq('user_id', user.id).eq('provider', SOURCE);
  if ((conn || []).length > 0) {
    console.error('REFUSING: ' + EMAIL + ' still HAS a ' + SOURCE + ' connection — these calls are gradeable');
    process.exit(1);
  }
  console.log('precondition ok: ' + EMAIL + ' has no ' + SOURCE + ' connection');

  const { data: calls } = await db.from('fathom_calls')
    .select('id, source, duplicate_of, not_a_sales_call, not_sales_marked_by, exclusion_reason')
    .eq('user_id', user.id).eq('source', SOURCE).limit(2000);
  const { data: an } = await db.from('call_analyses')
    .select('fathom_call_id, status').eq('user_id', user.id).limit(2000);
  const done = new Set((an || []).filter(a => a.status === 'done').map(a => a.fathom_call_id));

  const targets = [], skipped = [];
  for (const c of calls || []) {
    if (done.has(c.id)) { skipped.push([c.id, 'already graded']); continue; }
    // the human-overrule guard, same rule as the compromised-file gate
    if (c.not_a_sales_call === false && c.not_sales_marked_by) {
      skipped.push([c.id, 'a person said it counts']); continue;
    }
    if (c.exclusion_reason === 'source_disconnected') { skipped.push([c.id, 'already marked']); continue; }
    targets.push(c);
  }

  console.log('  ' + SOURCE + ' calls: ' + (calls || []).length
    + '  already graded: ' + (skipped.filter(s => s[1] === 'already graded').length)
    + '  to mark: ' + targets.length
    + '  already flagged duplicate: ' + targets.filter(t => t.duplicate_of).length);
  if (skipped.some(s => s[1] === 'a person said it counts')) {
    console.log('  SKIPPED (human override): ' + skipped.filter(s => s[1] === 'a person said it counts').length);
  }

  if (!RUN) { console.log('\n--plan only. Pass --run to execute.'); return; }

  const ids = targets.map(t => t.id);
  for (let i = 0; i < ids.length; i += 100) {      // chunked: .in() rides the URL
    const slice = ids.slice(i, i + 100);
    const up = await db.from('fathom_calls').update({
      not_a_sales_call: true,
      exclusion_reason: 'source_disconnected',
      not_sales_marked_by: null,      // automatic — keeps the override guard working
      not_sales_marked_role: null,
      not_sales_marked_at: new Date().toISOString(),
    }).in('id', slice);
    if (up.error) { console.error('FAILED on chunk ' + i + ': ' + up.error.message); process.exit(1); }
  }

  const { count: marked } = await db.from('fathom_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('exclusion_reason', 'source_disconnected');
  console.log('\nmarked source_disconnected: ' + marked + '/' + ids.length);
}

main().catch(e => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
