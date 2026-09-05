/**
 * lib/coachable-team.js — ONE gather for the Coachable Moments panel and the rep line (H726, H734).
 *
 * The route (GET /team/coachable-moments) and the measurement script (scripts/rep-line-measure-*) read the
 * SAME rows the same way — a script that counted a different prompt from the one the page sends would price
 * the wrong thing. Every counted call in the window for the members, with its outcome, prospect name and
 * highlights; the per-rep selection (lib/coachable-moments); the per-rep loss scope (lib/doctrine) so a
 * disqualified prospect is never a lost deal here either. Paged inside the request (H683), chunked at CHUNK,
 * synthetic rows and the paired exclusions applied (H369).
 */
'use strict';
var { CHUNK } = require('./chunk');
var { realCallsOnly } = require('./real-calls');
var { selectCoachableMoments, KIND_LABELS } = require('./coachable-moments');
var doctrineLib = require('./doctrine');

async function loadCoachableTeam(admin, memberIds, from, to) {
  var ids = memberIds || [];
  var calls = [];
  for (var i = 0; i < ids.length; i += CHUNK) {
    for (var page = 0; page < 10; page++) {
      var cq = await admin.from('fathom_calls').select('id, fathom_call_id, user_id, title, call_date, recording_url, not_a_sales_call, duplicate_of')
        .in('user_id', ids.slice(i, i + CHUNK)).gte('call_date', from).lte('call_date', to)
        .not('not_a_sales_call', 'is', true).is('duplicate_of', null).order('call_date', { ascending: false }).range(page * 1000, page * 1000 + 999);
      if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
      calls = calls.concat(cq.data || []);
      if ((cq.data || []).length < 1000) break;
    }
  }
  calls = realCallsOnly(calls).filter(function (c) { return c.not_a_sales_call !== true && !c.duplicate_of; });
  var byId = {}; calls.forEach(function (c) { byId[c.id] = c; c.highlights = []; c.outcome = null; c.prospect_name = null; });
  var callIds = Object.keys(byId);
  for (var j = 0; j < callIds.length; j += CHUNK) {
    var slice = callIds.slice(j, j + CHUNK);
    var pair = await Promise.all([
      admin.from('call_analyses').select('fathom_call_id, outcome, prospect_name').in('fathom_call_id', slice),
      admin.from('call_highlights').select('id, fathom_call_id, type, handling, resolution, section, speaker, speaker_verified, timestamp_seconds, quote, observation, closer_response, closer_response_verified, cause, objection_class, objection_category').in('fathom_call_id', slice),
    ]);
    if (pair[0].error) throw new Error('call_analyses: ' + pair[0].error.message);
    if (pair[1].error) throw new Error('call_highlights: ' + pair[1].error.message);
    (pair[0].data || []).forEach(function (a) { if (byId[a.fathom_call_id]) { byId[a.fathom_call_id].outcome = a.outcome || null; byId[a.fathom_call_id].prospect_name = a.prospect_name || null; } });
    (pair[1].data || []).forEach(function (h) { if (byId[h.fathom_call_id]) byId[h.fathom_call_id].highlights.push(h); });
  }
  var byRep = {}; ids.forEach(function (u) { byRep[u] = []; });
  calls.forEach(function (c) { if (byRep[c.user_id]) byRep[c.user_id].push(c); });
  var reps = ids.map(function (u) {
    var items = selectCoachableMoments(byRep[u]).map(function (it) { return Object.assign({ label: KIND_LABELS[it.kind] || it.kind }, it); });
    var hl = []; byRep[u].forEach(function (c) { hl = hl.concat(c.highlights || []); });
    var scope = doctrineLib.lossScope(byRep[u].map(function (c) { return { fathom_call_id: c.id, outcome: c.outcome }; }), hl);
    return { user_id: u, calls: byRep[u].length, items: items, loss_scope: scope };
  });
  return { calls: calls, byRep: byRep, reps: reps };
}

module.exports = { loadCoachableTeam: loadCoachableTeam };
