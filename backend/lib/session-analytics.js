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

// ─── Analytics v2 — the Fathom-era Coaching Dashboard (call_analyses) ────────
// Powers /me/analytics2 and /admin/analytics2/:user_id. Aggregates
// call_analyses + call_highlights for the caller's fathom_calls in a date
// window (window applied on fathom_calls.call_date). Pure JS aggregation, one
// logical call — but the child-table reads are CHUNKED by fathom_call_id (100
// per batch) so we never hit supabase-js's silent 1000-row cap (an active user
// has 200+ calls × 5-8 highlights ≈ 1000+ highlight rows). fathom_calls itself
// is paginated in 1000-row pages for the same reason.
//
// Returns:
//   {
//     from, to,
//     calls:      { analyzed, total_in_range, processing, error },
//     avg_score:  { mean: 0-100|null, graded_calls },
//     objections: { calls_with_objection, total_highlights },
//     sections:   { intro:{avg,n}, discovery:{avg,n}, pitch:{avg,n}, objection:{avg,n}, close:{avg,n} },
//     weakest_section, strongest_section,
//     latest_one_things: [ { fathom_call_id, title, call_date, one_thing }, … up to 5 ],
//   }
var CALL_ANALYTICS_SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];

async function computeCallAnalytics(admin, userId, from, to) {
  // 1) fathom_calls in the date window — paginated to dodge the 1000-row cap.
  var calls = [];
  var PAGE = 1000;
  var start = 0;
  while (true) {
    var cq = await admin
      .from('fathom_calls')
      .select('id, call_date, title')
      .eq('user_id', userId)
      .gte('call_date', from)
      .lte('call_date', to)
      .order('call_date', { ascending: false })
      .range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var cbatch = cq.data || [];
    calls = calls.concat(cbatch);
    if (cbatch.length < PAGE) break;
    start += PAGE;
  }
  var callMeta = {};                          // id -> { call_date, title }
  var callIds = [];
  for (var i = 0; i < calls.length; i++) {
    callMeta[calls[i].id] = calls[i];
    callIds.push(calls[i].id);
  }

  var empty = {
    from: from, to: to,
    calls: { analyzed: 0, total_in_range: 0, processing: 0, error: 0 },
    avg_score: { mean: null, graded_calls: 0, win_mean: null, win_n: 0, other_mean: null, other_n: 0 },
    objections: { calls_with_objection: 0, total_highlights: 0 },
    sections: sectionsShape(),
    weakest_section: null, strongest_section: null,
    latest_one_things: [],
  };
  if (callIds.length === 0) return empty;

  // Chunked .in('fathom_call_id', …) helper — keeps each request small and
  // under the row cap; scopes child rows to the in-window calls without a huge
  // IN list or fetching the user's entire all-time history.
  async function fetchByCallIds(table, columns, refine) {
    var out = [];
    for (var c = 0; c < callIds.length; c += 100) {
      var chunk = callIds.slice(c, c + 100);
      var qb = admin.from(table).select(columns).in('fathom_call_id', chunk);
      if (refine) qb = refine(qb);
      var r = await qb;
      if (r.error) throw new Error(table + ': ' + r.error.message);
      out = out.concat(r.data || []);
    }
    return out;
  }

  // 2) call_analyses for those calls — status, overall + section scores, one_thing.
  var analyses = await fetchByCallIds(
    'call_analyses',
    'fathom_call_id, status, outcome, overall_score, intro_score, discovery_score, pitch_score, objection_score, close_score, one_thing'
  );

  var statusCounts = { done: 0, processing: 0, error: 0 };
  var scoreSum = 0, scoreN = 0;
  // Win (outcome='closed') vs others split, so a strong closer's win quality is
  // visible instead of buried in the blended average.
  var winSum = 0, winN = 0, otherSum = 0, otherN = 0;
  var sec = {};
  CALL_ANALYTICS_SECTIONS.forEach(function(s) { sec[s] = { sum: 0, n: 0 }; });
  var oneThings = [];
  for (var a = 0; a < analyses.length; a++) {
    var an = analyses[a];
    if (an.status === 'done') statusCounts.done++;
    else if (an.status === 'processing') statusCounts.processing++;
    else if (an.status === 'error') statusCounts.error++;
    // Only DONE analyses contribute to scores/sections/one_things. Held
    // ('synced_unanalyzed') rows keep their stale pre-calibration scores and
    // must NOT pollute the averages (this was inflating graded_calls and
    // dragging the blended Avg Score down).
    if (an.status !== 'done') continue;
    if (typeof an.overall_score === 'number') {
      scoreSum += an.overall_score; scoreN++;
      if (an.outcome === 'closed') { winSum += an.overall_score; winN++; }
      else { otherSum += an.overall_score; otherN++; }
    }
    CALL_ANALYTICS_SECTIONS.forEach(function(s) {
      var v = an[s + '_score'];
      if (typeof v === 'number') { sec[s].sum += v; sec[s].n++; }
    });
    if (typeof an.one_thing === 'string' && an.one_thing.trim()) {
      var meta = callMeta[an.fathom_call_id] || {};
      oneThings.push({
        fathom_call_id: an.fathom_call_id,
        title: meta.title || null,
        call_date: meta.call_date || null,
        one_thing: an.one_thing,
      });
    }
  }

  var sections = sectionsShape();
  var weakest = null, strongest = null;
  CALL_ANALYTICS_SECTIONS.forEach(function(s) {
    var avg = sec[s].n > 0 ? Math.round(sec[s].sum / sec[s].n) : null;
    sections[s] = { avg: avg, n: sec[s].n };
    if (avg !== null) {
      if (weakest === null || avg < sections[weakest].avg) weakest = s;
      if (strongest === null || avg > sections[strongest].avg) strongest = s;
    }
  });

  oneThings.sort(function(x, y) {
    return new Date(y.call_date || 0).getTime() - new Date(x.call_date || 0).getTime();
  });
  var latestOneThings = oneThings.slice(0, 5);

  // 3) objection highlights — distinct calls + total count.
  var objRows = await fetchByCallIds('call_highlights', 'fathom_call_id', function(qb) {
    return qb.eq('type', 'objection');
  });
  var objCalls = {};
  for (var o = 0; o < objRows.length; o++) { objCalls[objRows[o].fathom_call_id] = true; }

  return {
    from: from, to: to,
    calls: {
      analyzed: statusCounts.done,
      total_in_range: callIds.length,
      processing: statusCounts.processing,
      error: statusCounts.error,
    },
    avg_score: {
      mean: scoreN > 0 ? Math.round(scoreSum / scoreN) : null,
      graded_calls: scoreN,
      win_mean: winN > 0 ? Math.round(winSum / winN) : null, win_n: winN,
      other_mean: otherN > 0 ? Math.round(otherSum / otherN) : null, other_n: otherN,
    },
    objections: { calls_with_objection: Object.keys(objCalls).length, total_highlights: objRows.length },
    sections: sections,
    weakest_section: weakest,
    strongest_section: strongest,
    latest_one_things: latestOneThings,
  };
}

function sectionsShape() {
  return {
    intro:     { avg: null, n: 0 },
    discovery: { avg: null, n: 0 },
    pitch:     { avg: null, n: 0 },
    objection: { avg: null, n: 0 },
    close:     { avg: null, n: 0 },
  };
}

// ─── Objection intelligence (Objections view) ───────────────────────────────
// Aggregates type='objection' highlights for the caller's calls in a window.
// Metrics + per-category breakdown + a feed with Fathom clip links. Reads
// existing highlights; the objection_category / resolution / closer_response
// fields stay empty until a re-analysis populates them (Anthropic-credit gated).
// Cap-safe: fathom_calls paginated, highlights read in chunks of 100 call ids.
var OBJECTION_CATEGORIES = ['fear', 'logistical', 'timing', 'partner'];

async function computeObjectionIntel(admin, userId, from, to) {
  // 1) calls in window → metadata map (recording_url powers the clip link).
  var calls = [];
  var PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin
      .from('fathom_calls')
      .select('id, title, call_date, recording_url')
      .eq('user_id', userId)
      .gte('call_date', from)
      .lte('call_date', to)
      .order('call_date', { ascending: false, nullsFirst: false })
      .range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var cb = cq.data || [];
    calls = calls.concat(cb);
    if (cb.length < PAGE) break;
    start += PAGE;
  }
  var meta = {};
  var callIds = [];
  for (var i = 0; i < calls.length; i++) { meta[calls[i].id] = calls[i]; callIds.push(calls[i].id); }

  var emptyCats = {};
  OBJECTION_CATEGORIES.concat(['uncategorized']).forEach(function(c) { emptyCats[c] = { total: 0, handled: 0, partial: 0, unhandled: 0 }; });
  var base = {
    from: from, to: to,
    metrics: { total: 0, calls_with_objection: 0, handled: 0, partial: 0, unhandled: 0, handled_rate: null },
    by_category: emptyCats,
    feed: [],
  };
  if (callIds.length === 0) return base;

  // 2) objection highlights for those calls (chunked, cap-safe).
  var rows = [];
  for (var c = 0; c < callIds.length; c += 100) {
    var hr = await admin
      .from('call_highlights')
      .select('fathom_call_id, timestamp_seconds, quote, observation, objection_surface, objection_category, resolution, closer_response')
      .in('fathom_call_id', callIds.slice(c, c + 100))
      .eq('type', 'objection');
    if (hr.error) throw new Error('call_highlights: ' + hr.error.message);
    rows = rows.concat(hr.data || []);
  }

  var callsWith = {};
  var feed = [];
  rows.forEach(function(r) {
    callsWith[r.fathom_call_id] = true;
    base.metrics.total += 1;
    var res = (r.resolution === 'handled' || r.resolution === 'partial' || r.resolution === 'unhandled') ? r.resolution : null;
    if (res) base.metrics[res] += 1;
    var cat = (OBJECTION_CATEGORIES.indexOf(r.objection_category) !== -1) ? r.objection_category : 'uncategorized';
    base.by_category[cat].total += 1;
    if (res) base.by_category[cat][res] += 1;

    var m = meta[r.fathom_call_id] || {};
    var clip = (m.recording_url && typeof r.timestamp_seconds === 'number')
      ? m.recording_url + (m.recording_url.indexOf('?') === -1 ? '?' : '&') + 't=' + r.timestamp_seconds
      : null;
    feed.push({
      fathom_call_id: r.fathom_call_id,
      title: m.title || null,
      call_date: m.call_date || null,
      timestamp_seconds: (typeof r.timestamp_seconds === 'number') ? r.timestamp_seconds : null,
      clip_url: clip,
      surface: r.objection_surface || null,
      category: cat,
      resolution: res,
      quote: r.quote || null,
      observation: r.observation || null,
      closer_response: r.closer_response || null,
    });
  });
  base.metrics.calls_with_objection = Object.keys(callsWith).length;
  var denom = base.metrics.handled + base.metrics.partial + base.metrics.unhandled;
  base.metrics.handled_rate = denom > 0 ? Math.round((base.metrics.handled / denom) * 100) : null;

  // Feed newest-call-first, then by timestamp; cap to keep the payload bounded.
  feed.sort(function(a, b) {
    var d = new Date(b.call_date || 0).getTime() - new Date(a.call_date || 0).getTime();
    if (d !== 0) return d;
    return (a.timestamp_seconds || 0) - (b.timestamp_seconds || 0);
  });
  base.feed = feed.slice(0, 100);
  return base;
}

module.exports = {
  computeAnalytics: computeAnalytics,
  computeCallAnalytics: computeCallAnalytics,
  computeObjectionIntel: computeObjectionIntel,
  loadSessionObjections: loadSessionObjections,
  loadObjectionsByType: loadObjectionsByType,
};
