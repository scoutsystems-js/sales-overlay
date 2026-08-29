/**
 * Grade a pinned list of calls, sequentially, reporting per call.
 *
 * PINNED IDS, NOT A PREDICATE RE-EVALUATED HERE. The set was selected and READ
 * first; re-deriving it inside the runner is how a run once selected 315 calls
 * when the sizing query said 134.
 *
 * analyzeCall(fathomCallId, userId) — TWO arguments. Owners are resolved from
 * the database and asserted before anything runs: with one argument the scope
 * check fails on user=undefined AND the error write fails too (user_id is NOT
 * NULL), stranding the row CLAIMED at 'processing' with no reason recorded.
 *
 * SEQUENTIAL. The saturation ceiling on this account is six concurrent loops;
 * these batches are small enough that one loop is well inside it, and a
 * saturation abort counts ONLY rate-limit errors — a permanently ungradeable
 * call (no transcript, missing connection) is a casualty to NAME, never a
 * reason to back off.
 *
 * Usage: IDS=/tmp/x.txt LABEL=A-something node grade-batch-2026-08-29.js [--run]
 */
'use strict';

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const RUN = process.argv.indexOf('--run') !== -1;
const LABEL = process.env.LABEL || 'batch';
const SATURATION = /429|rate.?limit|too many requests|overloaded|529/i;
const SATURATION_ABORT = 4;

/* ⚠⚠ A CAPABILITY FAILURE IS NOT A DATA FAILURE, AND IT MUST STOP THE RUN AT
   ONCE. If THIS PROCESS cannot reach the provider — a missing client id, a
   token that expired mid-run — then every remaining call will fail for the same
   reason, and the worker will record each one as `error`: a state no shipped
   control can reach. That is how a previous run turned 11 GRADEABLE pending
   calls into errored ones. One occurrence is enough to stop; there is nothing
   to retry and nothing to learn from the twelfth. */
const CAPABILITY = /not configured|missing [A-Z_]*CLIENT_ID|connection not found|token unavailable/i;

async function main() {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const ids = fs.readFileSync(process.env.IDS, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('no ids in ' + process.env.IDS);

  const { data: calls, error } = await admin.from('fathom_calls')
    .select('id, user_id, source, title').in('id', ids);
  if (error) throw new Error('calls: ' + error.message);

  const missing = ids.filter(i => !(calls || []).some(c => c.id === i));
  const noOwner = (calls || []).filter(c => !c.user_id);
  if (missing.length || noOwner.length) {
    console.error('REFUSING: ' + missing.length + ' missing, ' + noOwner.length + ' without an owner');
    process.exit(1);
  }

  console.log('[' + LABEL + '] targets: ' + calls.length
    + '  sources: ' + JSON.stringify(calls.reduce((a, c) => { a[c.source] = (a[c.source] || 0) + 1; return a; }, {})));
  if (!RUN) { console.log('[' + LABEL + '] --plan only.'); return; }

  const worker = require('../lib/analysis-worker');
  let ok = 0, errored = 0, saturation = 0, other = 0;
  const casualties = [];

  for (const c of calls) {
    let out;
    try {
      out = await worker.analyzeCall(c.id, c.user_id);
    } catch (e) {
      out = { status: 'threw', reason: e && e.message };
    }
    const st = (out && out.status) || '?';
    const reason = (out && out.reason) || '';
    if (st === 'done') ok++;
    else if (st === 'error' || st === 'threw') {
      errored++;
      // NAME every call that cannot be graded, never fold it into a zero
      casualties.push({ id: c.id, source: c.source, reason: String(reason).slice(0, 110) });
      if (CAPABILITY.test(String(reason))) {
        console.error('\n[' + LABEL + '] ABORTING — THIS PROCESS CANNOT REACH THE PROVIDER.');
        console.error('   ' + String(reason).slice(0, 160));
        console.error('   Remaining calls were NOT attempted, so they stay reachable by the normal control.');
        break;
      }
      if (SATURATION.test(String(reason))) {
        saturation++;
        if (saturation >= SATURATION_ABORT) {
          console.error('[' + LABEL + '] ABORTING — ' + saturation + ' saturation errors');
          break;
        }
      }
    } else other++;
    process.stdout.write('.');
  }

  console.log('\n[' + LABEL + '] attempted ' + calls.length + '  succeeded ' + ok
    + '  errored ' + errored + '  other ' + other + '  saturation ' + saturation);
  if (casualties.length) {
    console.log('[' + LABEL + '] CANNOT BE GRADED — named, not counted as zero:');
    casualties.forEach(c => console.log('   ' + c.source + '  ' + c.id + '  ' + c.reason));
  }

  const { data: after } = await admin.from('call_analyses')
    .select('fathom_call_id, status').in('fathom_call_id', ids);
  const done = (after || []).filter(a => a.status === 'done').length;
  console.log('[' + LABEL + '] now done: ' + done + '/' + ids.length
    + '  remaining: ' + (ids.length - done));
}

main().catch(e => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
