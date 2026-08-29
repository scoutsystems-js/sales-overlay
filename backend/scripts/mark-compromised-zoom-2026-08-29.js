/**
 * Mark the ZOOM compromised files that the gate cannot be run against.
 *
 * WHY THIS EXISTS RATHER THAN A RE-ANALYSIS. Re-running the real pipeline was
 * the preferred route and was used for the five FATHOM calls. It is not
 * available for these four:
 *
 *   godwin.o  x3  the Zoom access token has EXPIRED, so a run would refresh it.
 *                 Zoom refresh tokens are SINGLE-USE and rotate, and this local
 *                 process shares no lock with Railway's — a collision bricks the
 *                 connection of the live customer who just raised a Zoom support
 *                 ticket. Not worth it for a data cleanup.
 *   josh      x1  has NO Zoom connection at all, so the transcript cannot be
 *                 fetched. The pipeline would fail at Phase 3/4 and mark the
 *                 call ERRORED — it never reaches the gate, so it could not
 *                 produce the compromised label even if it ran.
 *
 * WHAT IS AND IS NOT PROVEN BY THIS. The gate's WIRING is proven on five real
 * calls; it sits AFTER normalize, which is the point the pipeline becomes
 * source-agnostic, so nothing source-specific remains below it. The DETECTOR is
 * verified against these four transcripts directly, here, using the production
 * module. What is not exercised for them is the fetch-and-normalize path above
 * the gate — which is exactly the part that is source-specific and exactly the
 * part that is unavailable.
 *
 * It writes the SAME fields the gate writes, via the SAME shared helper, so the
 * rows are indistinguishable from a gate-marked one — including marked_by NULL,
 * which is what keeps the human-override guard working on them afterwards.
 *
 * --plan prints and exits. --run executes.
 */
'use strict';

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { assessTranscript, clearedGradeFields } = require('../lib/compromised-file');

const RUN = process.argv.indexOf('--run') !== -1;

const COMP_REASON = 'This recording only captured one voice, so it could not be '
  + 'graded and is not counted in your numbers. If both sides were speaking, '
  + 'mark it as a sales call on this page to include it.';

async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const ids = fs.readFileSync(process.env.COMPROMISED_IDS || '/tmp/ids-zoom.txt', 'utf8')
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('no ids');

  const { data: calls, error: ce } = await db.from('fathom_calls')
    .select('id, source, user_id, not_a_sales_call, not_sales_marked_by, exclusion_reason')
    .in('id', ids);
  if (ce) throw new Error('calls: ' + ce.message);

  const { data: an, error: ae } = await db.from('call_analyses')
    .select('fathom_call_id, overall_score, outcome_source, transcript_stored')
    .in('fathom_call_id', ids);
  if (ae) throw new Error('analyses: ' + ae.message);
  const anBy = {}; (an || []).forEach(a => { anBy[a.fathom_call_id] = a; });

  const targets = [];
  for (const c of calls || []) {
    const a = anBy[c.id];
    // RE-VERIFY WITH THE PRODUCTION RULE. A pinned id that no longer satisfies
    // it is reported, never acted on.
    const v = a && a.transcript_stored && assessTranscript(a.transcript_stored.turns);
    if (!v || !v.compromised) { console.log('  NOT COMPROMISED, skipping: ' + c.id); continue; }
    // THE HUMAN-OVERRULE GUARD, same rule as the gate.
    if (c.not_a_sales_call === false && c.not_sales_marked_by) {
      console.log('  HUMAN SAID IT COUNTS, skipping: ' + c.id); continue;
    }
    if (c.source !== 'zoom') { console.log('  NOT ZOOM, skipping: ' + c.id); continue; }
    targets.push({ c, a, v });
    console.log('  ' + c.source + '  ' + String(v.chars).padStart(6) + ' chars  score='
      + String(a.overall_score).padStart(4) + '  outcome_source=' + String(a.outcome_source));
  }

  if (targets.length !== ids.length) {
    console.error('REFUSING: pinned ' + ids.length + ', ' + targets.length + ' verify');
    process.exit(1);
  }
  if (!RUN) { console.log('\n--plan only. Pass --run to execute.'); return; }

  for (const t of targets) {
    const manual = t.a.outcome_source === 'manual';
    await db.from('fathom_calls').update({
      not_a_sales_call: true,
      exclusion_reason: 'compromised_file',
      not_sales_marked_by: null,
      not_sales_marked_role: null,
      not_sales_marked_at: new Date().toISOString(),
      sync_status: 'processed',
    }).eq('id', t.c.id);

    await db.from('call_analyses').update(Object.assign({
      status: 'done',
      overall_summary: COMP_REASON,
      analyzed_at: new Date().toISOString(),
    }, clearedGradeFields(!manual))).eq('fathom_call_id', t.c.id);

    await db.from('call_highlights').delete().eq('fathom_call_id', t.c.id);
    console.log('  marked ' + t.c.id);
  }

  const { data: after } = await db.from('fathom_calls')
    .select('id, not_a_sales_call, exclusion_reason, not_sales_marked_by').in('id', ids);
  const { data: an2 } = await db.from('call_analyses')
    .select('fathom_call_id, overall_score').in('fathom_call_id', ids);
  const scored = (an2 || []).filter(x => x.overall_score !== null).length;
  console.log('\nexcluded ' + (after || []).filter(c => c.not_a_sales_call === true).length + '/' + ids.length
    + '  labelled ' + (after || []).filter(c => c.exclusion_reason === 'compromised_file').length + '/' + ids.length
    + '  automatic ' + (after || []).filter(c => c.not_sales_marked_by === null).length + '/' + ids.length
    + '  still carrying a score: ' + scored);
}

main().catch(e => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
