// Team analytics (v1.4 Manager view). Pure aggregation across a set of rep
// user_ids — the caller (routes/team.js) resolves WHO the reps are and enforces
// permission before calling in here. All queries are chunked .in() to dodge the
// supabase-js 1000-row cap, same as session-analytics.js.

var { resolveDisplayName } = require('./display-name');

var SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];

var { fetchProspectCloseRates, closeRate } = require('./prospect-entity');

function avg(sum, n) { return n > 0 ? Math.round(sum / n) : null; }

// One window's raw per-rep accumulation. Returns { rep: {id: {...}}, done_call_ids }.
async function aggregateWindow(admin, repIds, from, to) {
  var rep = {};
  repIds.forEach(function (id) {
    rep[id] = { calls_analyzed: 0, score_sum: 0, score_n: 0, win_sum: 0, win_n: 0, cash_sum: 0, close_won: 0, close_decided: 0, obj_total: 0, obj_handled: 0, sec_sum: {}, sec_n: {} };
    SECTIONS.forEach(function (s) { rep[id].sec_sum[s] = 0; rep[id].sec_n[s] = 0; });
  });
  if (repIds.length === 0) return { rep: rep, doneCallIds: [] };

  // calls in window for these reps
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, user_id, call_date')
      .in('user_id', repIds).gte('call_date', from).lte('call_date', to)
      .order('call_date', { ascending: false }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }
  var callRep = {}, callIds = [];
  calls.forEach(function (c) { callRep[c.id] = c.user_id; callIds.push(c.id); });
  if (callIds.length === 0) return { rep: rep, doneCallIds: [] };

  var doneCallIds = [];
  for (var i = 0; i < callIds.length; i += 100) {
    var aq = await admin.from('call_analyses')
      .select('fathom_call_id, analyzed_at, overall_score, outcome, cash_collected, intro_score, discovery_score, pitch_score, objection_score, close_score')
      .in('fathom_call_id', callIds.slice(i, i + 100)).eq('status', 'done');
    if (aq.error) throw new Error('call_analyses: ' + aq.error.message);
    (aq.data || []).forEach(function (a) {
      var r = rep[callRep[a.fathom_call_id]]; if (!r) return;
      r.calls_analyzed++;
      doneCallIds.push(a.fathom_call_id + ':' + a.analyzed_at);
      if (typeof a.overall_score === 'number') {
        r.score_sum += a.overall_score; r.score_n++;
        if (a.outcome === 'closed') { r.win_sum += a.overall_score; r.win_n++; }
      }
      // cash_collected: numeric(12,2), grader-forced to 0 on non-closed. PostgREST
      // may return numeric as a string, so coerce defensively.
      var cash = Number(a.cash_collected); if (isFinite(cash)) r.cash_sum += cash;
      // LEGACY per-call figure, retained only for compatibility. The RENDERED
      // rate is prospect_close_* (3d-3): closed PROSPECTS / TOTAL prospects.
      // follow_up = still-open pipeline (not a loss); no_show also excluded.
      if (a.outcome === 'closed') { r.close_won++; r.close_decided++; }
      else if (a.outcome === 'lost') { r.close_decided++; }
      SECTIONS.forEach(function (s) { var v = a[s + '_score']; if (typeof v === 'number') { r.sec_sum[s] += v; r.sec_n[s]++; } });
    });
  }
  for (var j = 0; j < callIds.length; j += 100) {
    var hq = await admin.from('call_highlights').select('fathom_call_id, resolution')
      .in('fathom_call_id', callIds.slice(j, j + 100)).eq('type', 'objection');
    if (hq.error) throw new Error('call_highlights: ' + hq.error.message);
    (hq.data || []).forEach(function (h) { var r = rep[callRep[h.fathom_call_id]]; if (!r) return; r.obj_total++; if (h.resolution === 'handled') r.obj_handled++; });
  }
  return { rep: rep, doneCallIds: doneCallIds };
}

// Team overview: per-rep cards (with a trend arrow vs the immediately-prior equal
// window) + team totals. emailMap: { user_id: email }.
async function computeTeamAnalytics(admin, repIds, from, to, emailMap) {
  // 3d-3: one shared prospect close-rate computation for the whole team.
  var prospectRates = await fetchProspectCloseRates(admin, repIds, from, to);
  var cur = await aggregateWindow(admin, repIds, from, to);
  // prior window = same length immediately before `from`
  var span = new Date(to).getTime() - new Date(from).getTime();
  var priorFrom = new Date(new Date(from).getTime() - span).toISOString();
  var prior = await aggregateWindow(admin, repIds, priorFrom, from);

  // Names for the rep cards — resolved through the shared helper (real name when
  // set, email prefix fallback otherwise), so the fallback lives in one place.
  var profileMap = {};
  if (repIds.length > 0) {
    var profs = await admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', repIds);
    if (!profs.error) (profs.data || []).forEach(function (p) { profileMap[p.user_id] = p; });
  }

  var per_rep = repIds.map(function (id) {
    var c = cur.rep[id];
    var p = prior.rep[id];
    var curAvg = avg(c.score_sum, c.score_n);
    var priAvg = avg(p.score_sum, p.score_n);
    var trend = (curAvg == null || priAvg == null) ? 0 : (curAvg > priAvg ? 1 : (curAvg < priAvg ? -1 : 0));
    var sections = {}; SECTIONS.forEach(function (s) { sections[s] = avg(c.sec_sum[s], c.sec_n[s]); });
    return {
      user_id: id,
      email: (emailMap && emailMap[id]) || null,
      display_name: resolveDisplayName(profileMap[id], (emailMap && emailMap[id]) || null, id),
      calls_analyzed: c.calls_analyzed,
      avg_score: curAvg,
      prior_avg_score: priAvg,
      trend: trend,
      win_mean: avg(c.win_sum, c.win_n),
      win_n: c.win_n,
      cash_collected: Math.round(c.cash_sum * 100) / 100,
      close_wins: c.close_won,
      close_decided: c.close_decided,
      close_rate: c.close_decided > 0 ? Math.round((c.close_won / c.close_decided) * 100) : null,
      // 3d-3: the RENDERED rate — closed PROSPECTS / TOTAL prospects, from the
      // one shared computation in lib/prospect-entity.
      prospect_close_rate:  (prospectRates[id] || {}).pct != null ? prospectRates[id].pct : null,
      prospect_close_wins:  (prospectRates[id] || {}).closed || 0,
      prospect_close_total: (prospectRates[id] || {}).total || 0,
      obj_total: c.obj_total,
      obj_handled: c.obj_handled,
      obj_handle_rate: c.obj_total > 0 ? Math.round((c.obj_handled / c.obj_total) * 100) : null,
      sections: sections,
    };
  });
  // sort: most calls first, then score
  per_rep.sort(function (a, b) { return (b.calls_analyzed - a.calls_analyzed) || ((b.avg_score || 0) - (a.avg_score || 0)); });

  var t = { calls_analyzed: 0, score_sum: 0, score_n: 0, win_sum: 0, win_n: 0, cash_sum: 0, close_won: 0, close_decided: 0, obj_total: 0, obj_handled: 0 };
  repIds.forEach(function (id) {
    var c = cur.rep[id];
    t.calls_analyzed += c.calls_analyzed; t.score_sum += c.score_sum; t.score_n += c.score_n;
    t.win_sum += c.win_sum; t.win_n += c.win_n; t.obj_total += c.obj_total; t.obj_handled += c.obj_handled;
    t.cash_sum += c.cash_sum; t.close_won += c.close_won; t.close_decided += c.close_decided;
  });
  // Team prospect totals: sum the per-rep prospect counts. Summing counts (not
  // averaging percentages) keeps the team rate consistent with the rep rates —
  // averaging rates would weight a 1-prospect rep the same as a 30-prospect one.
  var teamProspectClosed = 0, teamProspectTotal = 0;
  repIds.forEach(function (id) {
    var pr = prospectRates[id];
    if (pr) { teamProspectClosed += pr.closed; teamProspectTotal += pr.total; }
  });
  var teamProspect = {
    closed: teamProspectClosed,
    total: teamProspectTotal,
    pct: teamProspectTotal > 0 ? Math.round((100 * teamProspectClosed) / teamProspectTotal) : null,
  };

  var tp = { score_sum: 0, score_n: 0 };
  repIds.forEach(function (id) { tp.score_sum += prior.rep[id].score_sum; tp.score_n += prior.rep[id].score_n; });

  var totals = {
    reps: repIds.length,
    active_reps: per_rep.filter(function (r) { return r.calls_analyzed > 0; }).length,
    calls_analyzed: t.calls_analyzed,
    avg_score: avg(t.score_sum, t.score_n),
    prior_avg_score: avg(tp.score_sum, tp.score_n),
    win_mean: avg(t.win_sum, t.win_n),
    win_n: t.win_n,
    cash_collected: Math.round(t.cash_sum * 100) / 100,
    close_wins: t.close_won,
    close_decided: t.close_decided,
    close_rate: t.close_decided > 0 ? Math.round((t.close_won / t.close_decided) * 100) : null,
    prospect_close_wins:  teamProspect.closed,
    prospect_close_total: teamProspect.total,
    prospect_close_rate:  teamProspect.pct,
    objections_total: t.obj_total,
    objections_handled: t.obj_handled,
    obj_handle_rate: t.obj_total > 0 ? Math.round((t.obj_handled / t.obj_total) * 100) : null,
  };
  return { from: from, to: to, totals: totals, per_rep: per_rep };
}

// Trend buckets across the team by call_date. bucket ∈ week|month|quarter.
// Returns [{ label, from, to, calls, avg_score, win_rate }] oldest→newest.
function bucketStart(d, bucket) {
  var dt = new Date(d);
  if (bucket === 'month') return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  if (bucket === 'quarter') return new Date(Date.UTC(dt.getUTCFullYear(), Math.floor(dt.getUTCMonth() / 3) * 3, 1));
  // week: back up to Monday (UTC)
  var day = (dt.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - day));
}
function bucketLabel(start, bucket) {
  var d = new Date(start);
  if (bucket === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (bucket === 'quarter') return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + " '" + String(d.getUTCFullYear()).slice(2);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function computeTeamTrends(admin, repIds, bucket, from, to) {
  if (repIds.length === 0) return { bucket: bucket, buckets: [] };
  // calls + done analyses in window
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, call_date')
      .in('user_id', repIds).gte('call_date', from).lte('call_date', to)
      .order('call_date', { ascending: true }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }
  var dateOf = {}, callIds = [];
  calls.forEach(function (c) { dateOf[c.id] = c.call_date; callIds.push(c.id); });
  if (callIds.length === 0) return { bucket: bucket, buckets: [] };

  var buckets = {}; // key(ms) -> {calls, score_sum, score_n, wins, decided}
  for (var i = 0; i < callIds.length; i += 100) {
    var aq = await admin.from('call_analyses').select('fathom_call_id, overall_score, outcome')
      .in('fathom_call_id', callIds.slice(i, i + 100)).eq('status', 'done');
    if (aq.error) throw new Error('call_analyses: ' + aq.error.message);
    (aq.data || []).forEach(function (a) {
      var d = dateOf[a.fathom_call_id]; if (!d) return;
      var key = bucketStart(d, bucket).getTime();
      var bk = buckets[key] || (buckets[key] = { calls: 0, score_sum: 0, score_n: 0, wins: 0, decided: 0 });
      bk.calls++;
      if (typeof a.overall_score === 'number') { bk.score_sum += a.overall_score; bk.score_n++; }
      if (a.outcome === 'closed') { bk.wins++; bk.decided++; }
      else if (a.outcome === 'lost') { bk.decided++; }
    });
  }
  var out = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; }).map(function (key) {
    var bk = buckets[key];
    return {
      label: bucketLabel(key, bucket),
      from: new Date(key).toISOString(),
      calls: bk.calls,
      avg_score: avg(bk.score_sum, bk.score_n),
      win_rate: bk.decided > 0 ? Math.round((bk.wins / bk.decided) * 100) : null,
    };
  });
  return { bucket: bucket, buckets: out };
}

module.exports = {
  computeTeamAnalytics: computeTeamAnalytics,
  computeTeamTrends: computeTeamTrends,
  _aggregateWindow: aggregateWindow,
  // Exported for lib/rep-series.js (10a) so the manager board's weekly buckets
  // are the SAME DST-safe boundaries the team trends already use. One
  // definition — two chart lanes that disagreed about where a week starts
  // would be a very quiet bug.
  bucketStart: bucketStart,
  bucketLabel: bucketLabel,
};
