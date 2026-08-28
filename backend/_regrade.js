/* SAMPLE RE-GRADE — 30 PINNED ids, never a predicate re-evaluated at write time.
   ⚠ 4 concurrent loops, not 12: the recorded ceiling on this account is 6, and
   12 rate-limited Fathom's transcript fetch and silently errored 153 calls.
   ⚠ ABORT COUNTS SATURATION ONLY. A call whose transcript Fathom returns empty
   will never succeed at any speed; counting it toward the abort would halt a
   healthy run for a reason that is not overload. */
const { createClient } = require('@supabase/supabase-js');
const { analyzeCall } = require('./lib/analysis-worker');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SAT = /429|rate.?limit|too many requests|overloaded|529/i;
const ids = require('/tmp/sample_ids.json').map(s => s.id);
/* ⚠ analyzeCall(fathomCallId, userId) — BOTH arguments. Passing one silently
   fails the scope check with user=undefined, and because user_id is NOT NULL the
   error-status write ALSO fails, so the call is left CLAIMED at 'processing'
   with no error recorded. 30 rows were stranded that way and had to be restored.
   The owner is read from the DB rather than assumed. */
let OWNER = {};
let sat = 0, done = 0, err = 0, i = 0;
const started = Date.now();
async function loop(n) {
  while (i < ids.length) {
    if (sat >= 4) { console.log('loop ' + n + ': SATURATION ABORT'); return; }
    const id = ids[i++];
    try {
      const r = await analyzeCall(id, OWNER[id]);
      if (r && r.status === 'done') { done++; }
      else { err++; console.log('  ' + id.slice(0,8) + ' -> ' + (r && (r.status + (r.reason?' '+r.reason:''))) ); }
    } catch (e) {
      err++;
      if (SAT.test(e.message || '')) { sat++; console.log('  SATURATION: ' + e.message.slice(0,80)); }
      else console.log('  ' + id.slice(0,8) + ' ERR ' + String(e.message).slice(0,90));
    }
    if ((done + err) % 5 === 0) console.log('  progress ' + (done+err) + '/' + ids.length
      + '  done=' + done + ' err=' + err + ' sat=' + sat
      + '  ' + Math.round((Date.now()-started)/60000) + 'm');
  }
}
(async () => {
  const own = await admin.from('fathom_calls').select('id, user_id').in('id', ids);
  (own.data||[]).forEach(r => { OWNER[r.id] = r.user_id; });
  const missing = ids.filter(id => !OWNER[id]);
  if (missing.length) throw new Error('no owner resolved for ' + missing.length + ' calls — refusing');
  console.log('re-grading ' + ids.length + ' PINNED calls, 4 loops; owners resolved for all');
  await Promise.all([1,2,3,4].map(loop));
  console.log('\nCOMPLETE  done=' + done + '  errored=' + err + '  saturation=' + sat
    + '  ' + Math.round((Date.now()-started)/60000) + ' min');
})().catch(e=>{console.error('THREW:',e.message);process.exit(1);});
