/**
 * MARKING A CALL "NOT A SALES CALL" IS RETROACTIVE — SO THE RETRACTION MUST BE TOO
 * (2026-08-30, after Justin found Discovery coaching on a closer's internal
 * meeting with his own sales manager).
 *
 * ⚠⚠ THE GATE WAS NEVER THE PROBLEM. `shouldHarvest(outcome, notASalesCall)`
 * correctly refuses a call that is ALREADY marked. But a call is almost always
 * marked AFTER it was analysed, and by then its moments are already in the
 * knowledge base and its per-moment coaching is already written. A gate that
 * only looks forward cannot un-say something.
 *
 * ⚠ MEASURED BEFORE BUILDING: 4 harvested KB moments from 2 marked calls,
 * including an internal check-up whose "moments" are admin lines about filling
 * in an income field. A manager conversation was teaching Scout what good
 * selling looks like — silent, and it survives any display fix.
 *
 * ⚠⚠ THIS IS DELETION, AND IT IS DELIBERATE RATHER THAN A SOFT FLAG. A harvested
 * moment has no "excluded" state to set: the KB is read by similarity and by
 * scope, and every reader would need its own filter. One row removed is one
 * fewer thing that can leak. The COACHING is nulled rather than deleted because
 * the row is the moment itself, which stays — only the coaching text goes.
 *
 * ⚠ UN-MARKING DOES NOT RESTORE THEM, AND THAT IS CORRECT: the re-analysis the
 * mark route already fires will re-harvest and re-coach the call from scratch.
 * Restoring stale text would be worse than regenerating it.
 */

async function retractExcludedCall(admin, callRowId) {
  var out = { kb_deleted: 0, coaching_cleared: 0, errors: [] };
  if (!admin || !callRowId) return out;

  // 1 — harvested KB moments sourced from this call
  try {
    var kb = await admin.from('knowledge_base')
      .delete().eq('source_fathom_call_id', callRowId).select('id');
    if (kb.error) out.errors.push('kb: ' + kb.error.message);
    else out.kb_deleted = (kb.data || []).length;
  } catch (e) { out.errors.push('kb: ' + ((e && e.message) || 'unknown')); }

  // 2 — per-moment coaching written for this call (v30+)
  try {
    var hl = await admin.from('call_highlights')
      .update({ coaching: null })
      .eq('fathom_call_id', callRowId).not('coaching', 'is', null).select('id');
    if (hl.error) out.errors.push('coaching: ' + hl.error.message);
    else out.coaching_cleared = (hl.data || []).length;
  } catch (e) { out.errors.push('coaching: ' + ((e && e.message) || 'unknown')); }

  return out;
}

module.exports = { retractExcludedCall: retractExcludedCall };
