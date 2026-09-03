// lib/call-kind.js — THE FOLLOW-UP FLAG (Justin's ruling 2026-09-03, H706).
//
// booked · follow-up · not-a-sales-call. A follow-up IS a sales call — it counts in
// calls taken, its coaching stands, its moments stand. It is NOT a booked call — its
// outcome attributes to the booked call it follows.
//
// WHAT SETS IT: a LINKED later call for a prospect is a follow-up (linking's path 1 or
// path 2 — the exact and the full-name paths). A call with no link and no earlier
// call is booked. A call attached by today's one-word key (path 3) is booked too: a
// collision-prone key must not manufacture follow-ups (the Anthony problem in a new
// costume). A human sets it by hand on the Calls page — the impromptu reconnect with
// only the rep on the invite cannot be linked and the closer knows what it was.
//
// THE HUMAN MARK ALWAYS WINS and is never reversed by a re-analysis: the automatic
// setter writes only where call_kind_marked_by is NULL.
'use strict';
var LINKED_PATHS = { human: 1, invitee_email: 1, title_name: 1, display_name: 1 };   // H707: a human-named link is a link

/* input: { linkPath, prospectId, callDate, earlierCalls: [{ id, call_date, call_kind }] }
   → { call_kind, call_kind_source, follows_call_id } — pure and total. */
function deriveCallKind(input) {
  var o = input || {};
  var earlier = (Array.isArray(o.earlierCalls) ? o.earlierCalls : [])
    .filter(function (c) { return c && c.call_date && (!o.callDate || c.call_date < o.callDate); })
    .sort(function (a, b) { return String(a.call_date).localeCompare(String(b.call_date)); });
  if (o.prospectId && LINKED_PATHS[o.linkPath] && earlier.length > 0) {
    var booked = earlier.filter(function (c) { return c.call_kind !== 'follow_up'; });
    var anchor = booked.length ? booked[0] : earlier[0];
    return { call_kind: 'follow_up', call_kind_source: 'linked', follows_call_id: anchor.id };
  }
  return { call_kind: 'booked', call_kind_source: 'first', follows_call_id: null };
}

/* The automatic setter: writes ONLY where no human has spoken. Never throws. */
async function setCallKindAuto(admin, callId, userId, decision) {
  try {
    var r = await admin.from('fathom_calls')
      .update({ call_kind: decision.call_kind, call_kind_source: decision.call_kind_source, follows_call_id: decision.follows_call_id || null })
      .eq('id', callId).eq('user_id', userId).is('call_kind_marked_by', null);
    if (r && r.error) { console.warn('[call-kind] auto set failed for ' + callId + ': ' + r.error.message); return false; }
    return true;
  } catch (err) {
    console.warn('[call-kind] auto set threw for ' + callId + ': ' + ((err && err.message) || 'unknown'));
    return false;
  }
}

/* The human setter: always wins; stamps who and when. Returns the update result. */
async function setCallKindHuman(admin, callId, kind, actorId, followsCallId) {
  return admin.from('fathom_calls')
    .update({ call_kind: kind, call_kind_source: 'human', call_kind_marked_by: actorId, call_kind_marked_at: new Date().toISOString(),
              follows_call_id: kind === 'follow_up' ? (followsCallId || null) : null })
    .eq('id', callId).select('id, call_kind, call_kind_source, follows_call_id').single();
}

/* Earlier counted calls of the same prospect for the same rep (the attribution anchor). */
async function earlierCallsFor(admin, userId, prospectId, callDate, excludeCallId) {
  if (!prospectId) return [];
  var q = admin.from('fathom_calls').select('id, call_date, call_kind')
    .eq('user_id', userId).eq('prospect_id', prospectId)
    .not('not_a_sales_call', 'is', true).is('duplicate_of', null)
    .order('call_date', { ascending: true }).limit(50);
  if (callDate) q = q.lt('call_date', callDate);
  var r = await q;
  if (r.error) throw new Error('earlier calls: ' + r.error.message);
  return (r.data || []).filter(function (c) { return c.id !== excludeCallId; });
}

module.exports = { deriveCallKind: deriveCallKind, setCallKindAuto: setCallKindAuto, setCallKindHuman: setCallKindHuman, earlierCallsFor: earlierCallsFor, LINKED_PATHS: LINKED_PATHS };
