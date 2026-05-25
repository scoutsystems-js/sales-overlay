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
    .select('detected_at, objection_id, objection_label, framework, overcome, overcome_confidence, notes')
    .eq('session_id', sessionId)
    .order('detected_at', { ascending: true });
  if (r.error) throw new Error('objection lookup: ' + r.error.message);
  return r.data || [];
}

module.exports = { computeAnalytics: computeAnalytics, loadSessionObjections: loadSessionObjections };
