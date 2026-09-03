// lib/not-sales-mark.js — THE ONE NOT-A-SALES-CALL MARK (H712). Two callers — the Calls page
// button (POST /me/calls/:id/not-a-sales-call) and the review queue's confirm
// (POST /team/verdict-review) — and ONE function, so "the human mark is the only thing
// that removes a call from a rate" has exactly one place that removes. A second copy of
// this update is how a queue would become a second remover.
//
// What a mark does, in order: write the flag with the human's id (the durable override the
// worker reads); if marking, RETRACT the call's harvested KB moments and coaching (awaited —
// a data correction); then kick a re-analysis, fire-and-forget, never blocking the mark.
'use strict';
var { markRoleFor } = require('./outcome-tag');
var { retractExcludedCall } = require('./excluded-call-retraction');

async function markNotSalesCall(admin, args) {
  var a = args || {};
  var up = await admin.from('fathom_calls').update({
    not_a_sales_call:      a.marked === true,
    exclusion_reason:      null,
    not_sales_marked_by:   a.actor.id,
    not_sales_marked_at:   new Date().toISOString(),
    not_sales_marked_role: markRoleFor(a.actor, a.ownerProfile),
  }).eq('id', a.callId).select('id, not_a_sales_call, not_sales_marked_role').single();
  if (up.error) throw new Error('update: ' + up.error.message);
  if (a.marked === true) {
    try {
      var retraction = await retractExcludedCall(admin, a.callId);
      console.log('[not-sales-mark] retraction: call=%s kb_deleted=%d coaching_cleared=%d%s', a.callId, retraction.kb_deleted, retraction.coaching_cleared, retraction.errors.length ? ' errors=' + retraction.errors.join('; ') : '');
    } catch (e) {
      console.error('[not-sales-mark] retraction failed for %s: %s', a.callId, (e && e.message) || 'unknown');
    }
  }
  if (a.reanalyze !== false) {
    try {
      var worker = require('./analysis-worker');
      if (worker && typeof worker.analyzeCall === 'function') {
        Promise.resolve(worker.analyzeCall(a.callId, a.ownerId)).catch(function (e) { console.warn('[not-sales-mark] re-analysis failed (non-fatal):', e && e.message); });
      }
    } catch (e) { /* never block the mark */ }
  }
  return up.data;
}

module.exports = { markNotSalesCall: markNotSalesCall };
