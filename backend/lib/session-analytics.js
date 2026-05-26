// Shared analytics aggregation for /me/analytics and /admin/analytics/:user_id.
// Pure-ish — takes a supabase admin client + scope params, returns the
// response shape. No HTTP concerns. Extracted from backend/routes/me.js when
// the admin user-picker variant landed; keeping the logic in one place
// means the dashboard widget renders identically on both surfaces.

// Aggregates call_sessions outcomes + session_objections counts for a single
// user over a date range. Both routes wrap this with their own auth + path
// resolution. Returns the shape:
//   {
//     from, to,
//     totals: { total_calls, wins, losses, follow_ups, unmarked, live, outcome_sources },
//     objections: { totals, by_type },
//   }
async function computeAnalytics(admin, userId, from, to) {
  var sessionsQ = await admin
    .from('call_sessions')
    .select('session_id, outcome, outcome_source, started_at, ended_at')
    .eq('user_id', userId)
    .gte('started_at', from)
    .lte('started_at', to)
    .order('started_at', { ascending: false });
  if (sessionsQ.error) throw new Error('sessions query: ' + sessionsQ.error.message);
  var sessions = sessionsQ.data || [];

  var dist = { win: 0, loss: 0, follow_up: 0, unmarked: 0, live: 0 };
  var sources = { inferred: 0, manual: 0, none: 0 };
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (!s.ended_at) dist.live++;
    else if (s.outcome === 'win') dist.win++;
    else if (s.outcome === 'loss') dist.loss++;
    else if (s.outcome === 'follow_up') dist.follow_up++;
    else dist.unmarked++;
    if (s.outcome_source === 'inferred') sources.inferred++;
    else if (s.outcome_source === 'manual') sources.manual++;
    else sources.none++;
  }

  var sessionIds = sessions.map(function(s) { return s.session_id; });
  var objRows = [];
  if (sessionIds.length > 0) {
    var objQ = await admin
      .from('session_objections')
      .select('objection_id, objection_label, framework, overcome, overcome_confidence')
      .in('session_id', sessionIds);
    if (!objQ.error) objRows = objQ.data || [];
  }

  var byId = {};
  for (var j = 0; j < objRows.length; j++) {
    var o = objRows[j];
    if (!byId[o.objection_id]) {
      byId[o.objection_id] = {
        objection_id: o.objection_id,
        label: o.objection_label,
        framework: o.framework,
        count: 0, overcome: 0, not_overcome: 0, unknown: 0,
      };
    }
    var bucket = byId[o.objection_id];
    bucket.count++;
    if (o.overcome === true) bucket.overcome++;
    else if (o.overcome === false) bucket.not_overcome++;
    else bucket.unknown++;
  }
  var byType = Object.keys(byId).map(function(k) { return byId[k]; });
  byType.forEach(function(b) {
    var denom = b.overcome + b.not_overcome;
    b.overcome_pct = denom > 0 ? Math.round((b.overcome / denom) * 100) : null;
  });
  byType.sort(function(a, b) { return b.count - a.count; });

  var objTotals = { total: objRows.length, overcome: 0, not_overcome: 0, unknown: 0 };
  for (var k = 0; k < objRows.length; k++) {
    if (objRows[k].overcome === true) objTotals.overcome++;
    else if (objRows[k].overcome === false) objTotals.not_overcome++;
    else objTotals.unknown++;
  }
  var objDenom = objTotals.overcome + objTotals.not_overcome;
  objTotals.overcome_pct = objDenom > 0 ? Math.round((objTotals.overcome / objDenom) * 100) : null;

  return {
    from: from,
    to: to,
    totals: {
      total_calls: sessions.length,
      wins: dist.win,
      losses: dist.loss,
      follow_ups: dist.follow_up,
      unmarked: dist.unmarked,
      live: dist.live,
      outcome_sources: sources,
    },
    objections: {
      totals: objTotals,
      by_type: byType,
    },
  };
}

// Per-session objection drill — used by both /me/sessions/:id/objections and
// /admin/sessions/:id/objections. Caller is responsible for ownership/auth.
async function loadSessionObjections(admin, sessionId) {
  var r = await admin
    .from('session_objections')
    .select('detected_at, objection_id, objection_label, framework, overcome, overcome_confidence, notes, framework_rebuttal, closer_response, coaching_note')
    .eq('session_id', sessionId)
    .order('detected_at', { ascending: true });
  if (r.error) throw new Error('objection lookup: ' + r.error.message);
  return r.data || [];
}

// Per-type objection drill — all events of one objection_id for one user
// in a date range, with session metadata joined. Powers the third-level
// drill on the dashboard ("Objections" donut → type breakdown → click a
// type → see every instance with coaching narrative).
async function loadObjectionsByType(adminClient, userId, objectionId, from, to) {
  var sessionsQ = await adminClient
    .from('call_sessions')
    .select('session_id, started_at, ended_at, prospect_name, outcome, outcome_source')
    .eq('user_id', userId)
    .gte('started_at', from)
    .lte('started_at', to);
  if (sessionsQ.error) throw new Error('sessions: ' + sessionsQ.error.message);
  var sessions = sessionsQ.data || [];
  if (sessions.length === 0) {
    return { objection_id: objectionId, label: null, framework: null,
             totals: { total: 0, overcome: 0, not_overcome: 0, unknown: 0, overcome_pct: null },
             events: [] };
  }

  var sessionIds = sessions.map(function(s) { return s.session_id; });
  var sessionMap = {};
  sessions.forEach(function(s) { sessionMap[s.session_id] = s; });

  var eventsQ = await adminClient
    .from('session_objections')
    .select('session_id, detected_at, objection_id, objection_label, framework, overcome, overcome_confidence, notes, framework_rebuttal, closer_response, coaching_note')
    .in('session_id', sessionIds)
    .eq('objection_id', objectionId)
    .order('detected_at', { ascending: false });
  if (eventsQ.error) throw new Error('objections: ' + eventsQ.error.message);
  var events = eventsQ.data || [];

  var enriched = events.map(function(e) {
    var s = sessionMap[e.session_id] || {};
    return Object.assign({}, e, {
      session_started_at:   s.started_at || null,
      session_ended_at:     s.ended_at || null,
      prospect_name:        s.prospect_name || null,
      session_outcome:      s.outcome || null,
      session_outcome_source: s.outcome_source || null,
    });
  });

  var totals = { total: events.length, overcome: 0, not_overcome: 0, unknown: 0 };
  events.forEach(function(e) {
    if (e.overcome === true) totals.overcome++;
    else if (e.overcome === false) totals.not_overcome++;
    else totals.unknown++;
  });
  var denom = totals.overcome + totals.not_overcome;
  totals.overcome_pct = denom > 0 ? Math.round(100 * totals.overcome / denom) : null;

  return {
    objection_id: objectionId,
    label: events.length > 0 ? events[0].objection_label : null,
    framework: events.length > 0 ? events[0].framework : null,
    totals: totals,
    events: enriched,
  };
}

module.exports = {
  computeAnalytics: computeAnalytics,
  loadSessionObjections: loadSessionObjections,
  loadObjectionsByType: loadObjectionsByType,
};
