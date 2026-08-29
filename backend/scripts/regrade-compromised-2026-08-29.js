/**
 * Re-analyse the calls that were graded BEFORE the compromised-file refusal
 * shipped, so the gate marks them the same way it now marks a new one.
 *
 * WHY (c) RATHER THAN A ONE-OFF UPDATE: re-running the real pipeline is the
 * one-off update PLUS proof the shipped gate fires on the exact calls it was
 * built for. A direct UPDATE would leave the gate unproven against real cases.
 *
 * IT COSTS NOTHING IN MODEL SPEND. The refusal sits at Phase 5b, BEFORE the two
 * Claude calls, so each call here is a transcript fetch and nothing more.
 *
 * OWNERS ARE RESOLVED FROM THE DATABASE AND ASSERTED BEFORE ANYTHING RUNS.
 * analyzeCall's real signature is (fathomCallId, userId); calling it with one
 * argument fails the scope check with user=undefined AND the error-status write
 * then fails too (user_id is NOT NULL), leaving the row CLAIMED at 'processing'
 * with no error recorded. That stranded 30 rows once. A precondition, not care.
 *
 * --plan prints and exits. --run executes.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');

const RUN = process.argv.indexOf('--run') !== -1;

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, key, { auth: { persistSession: false } });
}

// The rule, applied to what is already stored. Deliberately the SAME module the
// worker uses — a hand-written variant here could disagree with the gate and
// the run would prove nothing about it.
const { assessTranscript } = require('../lib/compromised-file');

async function main() {
  const db = admin();

  /* 1. THE TARGET SET IS A PINNED LIST OF IDS, not a predicate re-evaluated
     here. Selecting the whole table's transcripts through the client times out,
     and more importantly a second expression of the rule could disagree with
     the one that was reviewed. The ids come from the SQL predicate that was run
     and READ first; this script re-verifies each one with the PRODUCTION module
     and refuses any that does not still satisfy it. */
  const idFile = process.env.COMPROMISED_IDS || '/tmp/compromised-ids.txt';
  const ids0 = require('fs').readFileSync(idFile, 'utf8').split('\n')
    .map(x => x.trim()).filter(Boolean);
  if (!ids0.length) throw new Error('no ids in ' + idFile);

  const { data: rows, error } = await db
    .from('call_analyses')
    .select('fathom_call_id, user_id, overall_score, transcript_stored')
    .in('fathom_call_id', ids0);
  if (error) throw new Error('load: ' + error.message);

  const hits = [];
  for (const r of rows || []) {
    const turns = r.transcript_stored && r.transcript_stored.turns;
    if (!Array.isArray(turns)) continue;
    const a = assessTranscript(turns);
    // re-verified against the production rule; a pinned id that no longer
    // satisfies it is reported rather than silently acted on
    if (a.compromised) hits.push({ id: r.fathom_call_id, userId: r.user_id, score: r.overall_score, chars: a.chars });
    else console.log('  PINNED BUT NO LONGER COMPROMISED (skipping): ' + r.fathom_call_id);
  }
  hits.sort((x, y) => y.chars - x.chars);
  if (hits.length !== ids0.length) {
    console.error('REFUSING: pinned ' + ids0.length + ' but ' + hits.length + ' verify');
    process.exit(1);
  }

  // 2. enrich with the call row, and REFUSE to run if anything is unresolved
  const ids = hits.map(h => h.id);
  const { data: calls } = await db
    .from('fathom_calls')
    .select('id, user_id, source, title, not_a_sales_call, not_sales_marked_by, exclusion_reason, fathom_call_id')
    .in('id', ids);
  const byId = {};
  (calls || []).forEach(c => { byId[c.id] = c; });

  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const emailOf = {};
  (users && users.users ? users.users : []).forEach(u => { emailOf[u.id] = u.email; });

  console.log('candidates: ' + hits.length);
  let unresolved = 0, humanMarked = 0;
  for (const h of hits) {
    const c = byId[h.id];
    if (!c) { console.log('  UNRESOLVED call row: ' + h.id); unresolved++; continue; }
    if (!h.userId) { console.log('  UNRESOLVED owner: ' + h.id); unresolved++; continue; }
    // THE HUMAN-OVERRULE GUARD, checked here too: a call a person has said
    // counts must never be swept up by a bulk correction either.
    const human = (c.not_a_sales_call === false && !!c.not_sales_marked_by);
    if (human) humanMarked++;
    console.log('  ' + (c.source || '?').padEnd(7)
      + (emailOf[h.userId] || h.userId).padEnd(34)
      + String(h.chars).padStart(6) + ' chars  score=' + String(h.score).padStart(4)
      + '  marked=' + String(c.not_a_sales_call) + '  reason=' + String(c.exclusion_reason)
      + (human ? '  <-- HUMAN SAID IT COUNTS, SKIP' : ''));
  }
  if (unresolved) { console.error('REFUSING: ' + unresolved + ' unresolved target(s)'); process.exit(1); }
  console.log('human-marked (will be skipped by the gate): ' + humanMarked);

  if (!RUN) { console.log('\n--plan only. Pass --run to execute.'); return; }

  // 3. run the REAL pipeline, sequentially
  const worker = require('../lib/analysis-worker');
  console.log('\nrunning ' + hits.length + ' through analyzeCall...\n');
  const results = [];
  for (const h of hits) {
    const c = byId[h.id];
    const who = emailOf[h.userId] || h.userId;
    let out;
    try {
      out = await worker.analyzeCall(h.id, h.userId);   // TWO arguments. Always.
    } catch (e) {
      out = { status: 'threw', reason: e && e.message };
    }
    const status = (out && out.status) || '?';
    console.log('  ' + (c.source || '?').padEnd(7) + who.padEnd(34)
      + String(h.chars).padStart(6) + ' -> ' + status
      + (out && out.reason ? '  (' + String(out.reason).slice(0, 90) + ')' : ''));
    results.push({ id: h.id, source: c.source, who, chars: h.chars, status });
  }

  // 4. confirm the OUTCOME on the row, not the return value
  const { data: after } = await db
    .from('fathom_calls')
    .select('id, source, not_a_sales_call, exclusion_reason, not_sales_marked_by')
    .in('id', ids);
  console.log('\nafter:');
  let excluded = 0, labelled = 0, automatic = 0;
  (after || []).forEach(c => {
    if (c.not_a_sales_call === true) excluded++;
    if (c.exclusion_reason === 'compromised_file') labelled++;
    if (c.not_sales_marked_by === null) automatic++;
    console.log('  ' + (c.source || '?').padEnd(7) + ' excluded=' + String(c.not_a_sales_call)
      + ' reason=' + String(c.exclusion_reason) + ' marked_by=' + (c.not_sales_marked_by ? 'HUMAN' : 'null'));
  });
  console.log('\nexcluded ' + excluded + '/' + ids.length
    + '  labelled ' + labelled + '/' + ids.length
    + '  automatic(marked_by null) ' + automatic + '/' + ids.length);
}

main().catch(e => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
