// Team analytics (v1.4 Manager view). Pure aggregation across a set of rep
// user_ids — the caller (routes/team.js) resolves WHO the reps are and enforces
// permission before calling in here. All queries are chunked .in() to dodge the
// supabase-js 1000-row cap, same as session-analytics.js.

var { resolveDisplayName, disambiguateNames } = require('./display-name');

var SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];

var { fetchProspectCloseRates, closeRate } = require('./prospect-entity');
var { weakestSection, weakestObjection, MIN_CATEGORY_OBJECTIONS } = require('./rep-card-metrics');
var { isHandled } = require('./objection-handled');
// ⚠ ONE definition of "synthetic" — shared with lib/team-synthesis.js (the team
// loader) and lib/team-objections.js (the drilldown). Never re-expressed here.
var { realCallsOnly } = require('./real-calls');

function avg(sum, n) { return n > 0 ? Math.round(sum / n) : null; }

// One window's raw per-rep accumulation. Returns { rep: {id: {...}}, done_call_ids }.
async function aggregateWindow(admin, repIds, from, to) {
  var rep = {};
  repIds.forEach(function (id) {
    rep[id] = { calls_analyzed: 0, score_sum: 0, score_n: 0, win_sum: 0, win_n: 0, cash_sum: 0, close_won: 0, close_decided: 0, obj_total: 0, obj_handled: 0, sec_sum: {}, sec_n: {}, obj_by_cat: {}, close_earned_sum: 0, close_earned_n: 0 };
    SECTIONS.forEach(function (s) { rep[id].sec_sum[s] = 0; rep[id].sec_n[s] = 0; });
  });
  if (repIds.length === 0) return { rep: rep, doneCallIds: [] };

  // calls in window for these reps
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, user_id, fathom_call_id, call_date')
      .in('user_id', repIds).gte('call_date', from).lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
      .order('call_date', { ascending: false }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }
  /* ⚠⚠ SYNTHETIC EXCLUSION — the SAME rule as lib/team-synthesis.js and the
     objection drilldown, imported from lib/real-calls.js. This query aggregates
     ACROSS a team (`.in('user_id', ...)`), so without it the demo accounts'
     copied rows are counted as real people's performance. Ava Mitchell read
     "39 calls, 13% closing" on the live board while owning ZERO real calls. */
  calls = realCallsOnly(calls);
  var callRep = {}, callIds = [];
  // Ruling 2026-08-17: the objection loop needs the CALL's outcome, to credit
  // objections on calls that closed. `outcome` is already selected below, so
  // this is a map build and not a new query.
  var callOutcome = {};
  calls.forEach(function (c) { callRep[c.id] = c.user_id; callIds.push(c.id); });
  if (callIds.length === 0) return { rep: rep, doneCallIds: [] };

  var doneCallIds = [];
  for (var i = 0; i < callIds.length; i += 100) {
    var aq = await admin.from('call_analyses')
      .select('fathom_call_id, analyzed_at, overall_score, outcome, cash_collected, intro_score, discovery_score, pitch_score, objection_score, close_score, close_score_earned')
      .in('fathom_call_id', callIds.slice(i, i + 100)).eq('status', 'done');
    if (aq.error) throw new Error('call_analyses: ' + aq.error.message);
    (aq.data || []).forEach(function (a) {
      callOutcome[a.fathom_call_id] = a.outcome || null;
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
      // ⚠ The EARNED close score, tracked alongside the displayed one. Migration
      // 027 forces close_score to 100 on closed calls, so "weakest section" must
      // not read it — the section drilldown already reads earned for this reason.
      if (typeof a.close_score_earned === 'number') { r.close_earned_sum += a.close_score_earned; r.close_earned_n++; }
    });
  }
  for (var j = 0; j < callIds.length; j += 100) {
    var hq = await admin.from('call_highlights').select('fathom_call_id, resolution, objection_category')
      .in('fathom_call_id', callIds.slice(j, j + 100)).eq('type', 'objection');
    if (hq.error) throw new Error('call_highlights: ' + hq.error.message);
    (hq.data || []).forEach(function (h) {
      var r = rep[callRep[h.fathom_call_id]]; if (!r) return;
      // Shared predicate. This same rate is quoted IN PROSE by the WHY sentence
      // and decides which category the rep card names as the rep's weakest, so
      // it must never become a second local definition.
      var handled = isHandled(h, callOutcome[h.fathom_call_id]);
      r.obj_total++; if (handled) r.obj_handled++;
      // Per-category, for the card's weakest-objection field. Uncategorised
      // objections still count in the aggregate above but cannot be attributed
      // to a category, so they are left out here rather than bucketed as 'other'
      // — an invented category would be rankable and wrong.
      var cat = h.objection_category;
      if (!cat) return;
      if (!r.obj_by_cat[cat]) r.obj_by_cat[cat] = { total: 0, handled: 0 };
      r.obj_by_cat[cat].total++; if (handled) r.obj_by_cat[cat].handled++;
    });
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
  /* WHO HAS A RECORDING SOURCE CONNECTED. Nothing on the team board knew this,
     so a rep who had never connected looked identical to one who simply had a
     quiet week — the manager's most actionable fact was invisible.
     ⚠ BOTH tables: Fathom lives in fathom_connections, everything else in
     call_connections. Checking one would report every Fathom user as
     unconnected, which is most of the platform.
     ⚠ IT DEGRADES TO "CONNECTED". On a read failure nobody is reported as
     unconnected — a false alarm naming a real person is worse than silence,
     and this drives a badge that accuses someone by name. */
  var connectedSet = {};
  if (repIds.length > 0) {
    var conns = await Promise.all([
      admin.from('fathom_connections').select('user_id').in('user_id', repIds),
      admin.from('call_connections').select('user_id').in('user_id', repIds),
    ]);
    var connErr = conns.some(function (c) { return !!c.error; });
    if (connErr) {
      console.error('[team-analytics] connection lookup failed — nobody will be reported unconnected');
      repIds.forEach(function (id) { connectedSet[id] = true; });
    } else {
      conns.forEach(function (c) {
        (c.data || []).forEach(function (r) { connectedSet[r.user_id] = true; });
      });
    }
  }

  var profileMap = {};
  if (repIds.length > 0) {
    var profs = await admin.from('user_profiles').select('user_id, first_name, last_name, active').in('user_id', repIds);
    if (!profs.error) (profs.data || []).forEach(function (p) { profileMap[p.user_id] = p; });
  }

  // Team per-category totals + how many reps have enough volume to be ranked
  // against. Built BEFORE the per-rep map because a ranking needs every rep's
  // numbers in hand at once.
  var teamByCat = {};
  repIds.forEach(function (id) {
    var byCat = cur.rep[id].obj_by_cat || {};
    Object.keys(byCat).forEach(function (cat) {
      if (!teamByCat[cat]) teamByCat[cat] = { reps_with_volume: 0, total: 0, handled: 0, lowest_rate: null };
      var c = byCat[cat];
      teamByCat[cat].total += c.total;
      teamByCat[cat].handled += c.handled;
      if (c.total >= MIN_CATEGORY_OBJECTIONS) {
        teamByCat[cat].reps_with_volume++;
        var rate = Math.round((c.handled / c.total) * 100);
        if (teamByCat[cat].lowest_rate === null || rate < teamByCat[cat].lowest_rate) {
          teamByCat[cat].lowest_rate = rate;
        }
      }
    });
  });

  /* ⚠ Names are resolved for the WHOLE board first, then disambiguated across
     it — two reps sharing a first name get a surname initial ("Josh P"). It has
     to see every member at once, so it cannot be done per row. */
  var nameOf = {};
  repIds.forEach(function (id) {
    nameOf[id] = resolveDisplayName(profileMap[id], (emailMap && emailMap[id]) || null, id);
  });
  nameOf = disambiguateNames(nameOf);

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
      display_name: nameOf[id],
      /* ⚠⚠ RENDERING AND COUNTING ARE TWO DIFFERENT QUESTIONS AND THIS FLAG
         ANSWERS ONLY THE FIRST. Justin's ruling: DEACTIVATE LEAVES THE NUMBERS.
         So a deactivated person stays in every aggregate — their calls, cash and
         objections still count, exactly as they did — and the ONLY thing that
         changes is that the board stops drawing a card for someone who has been
         switched off. ⚠ A fix that filtered them out of `repIds` instead would
         silently rewrite the team's history, which is the opposite of the
         ruling. Nothing here touches the scope. */
      active: (profileMap[id] && profileMap[id].active) !== false,
      connected: connectedSet[id] === true,
      calls_analyzed: c.calls_analyzed,
      avg_score: curAvg,
      prior_avg_score: priAvg,
      trend: trend,
      win_mean: avg(c.win_sum, c.win_n),
      win_n: c.win_n,
    /* ⚠ CASH REMOVED FROM THIS PAYLOAD 2026-08-25 (Justin): "we don't track
       cash collected at all... the only time it's needed is on the EOD report."
       A DISPLAY ruling — call_analyses.cash_collected is still extracted by the
       grader and still drives EOD. Removed from the payload rather than merely
       unrendered, so it cannot quietly reappear on a tile later. */
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
      // 10c-1, for the rep cards. Both are pure derivations — see rep-card-metrics.
      // weakest_section reads the EARNED close score, never the displayed one.
      objection_categories: c.obj_by_cat,
      weakest_section: weakestSection(Object.assign({}, sections, {
        close: avg(c.close_earned_sum, c.close_earned_n),
      })),
      weakest_objection: weakestObjection(c.obj_by_cat, teamByCat),
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
  return { from: from, to: to, totals: totals, per_rep: per_rep, objection_categories: teamByCat };
}

// Trend buckets across the team by call_date. bucket ∈ week|month|quarter.
// Returns [{ label, from, to, calls, avg_score, win_rate }] oldest→newest.
function bucketStart(d, bucket) {
  var dt = new Date(d);
  if (bucket === 'month') return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  if (bucket === 'quarter') return new Date(Date.UTC(dt.getUTCFullYear(), Math.floor(dt.getUTCMonth() / 3) * 3, 1));
  // day: midnight UTC. Added for the 7-day manager graphs, where weekly buckets
  // collapse to a single point and Chart.js draws a lone dot with no line.
  if (bucket === 'day') return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
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

// Explicit SPAN label — "Aug 3 - Aug 9" rather than a bare start date, so a point
// is never ambiguous about the period it covers (Justin's ruling 2026-08-15).
//
// ⚠ THE END IS INCLUSIVE, and that is a deliberate departure from the literal
// example given ("Aug 3 - Aug 10"). An exclusive end makes consecutive buckets
// share a date on screen — "Aug 3 - Aug 10" beside "Aug 10 - Aug 17" puts Aug 10
// in two buckets, which is the ambiguity this label exists to remove.
//
// `clampToMs` trims a partial final bucket to the range end, so the current week
// reads "Aug 10 - Aug 12" rather than claiming days that have not happened yet.
// A separate function from bucketLabel on purpose: computeTeamTrends renders bare
// start dates and must not change underneath its own view.
function bucketRangeLabel(start, bucket, clampToMs) {
  var s = new Date(start);
  if (bucket === 'day') return bucketLabel(start, 'day');
  if (bucket === 'month' || bucket === 'quarter') return bucketLabel(start, bucket);

  var endMs = bucketStart(new Date(s.getTime() + 8 * 24 * 3600 * 1000).toISOString(), 'week').getTime() - 24 * 3600 * 1000;
  if (clampToMs != null && clampToMs < endMs) endMs = bucketStart(new Date(clampToMs).toISOString(), 'day').getTime();
  if (endMs <= s.getTime()) return bucketLabel(start, 'week');       // single-day span
  return bucketLabel(start, 'week') + ' - ' + bucketLabel(endMs, 'week');
}

async function computeTeamTrends(admin, repIds, bucket, from, to) {
  if (repIds.length === 0) return { bucket: bucket, buckets: [] };
  // calls + done analyses in window
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, fathom_call_id, call_date')
      .in('user_id', repIds).gte('call_date', from).lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
      .order('call_date', { ascending: true }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }
  /* ⚠⚠ SYNTHETIC EXCLUSION — the SAME rule as lib/team-synthesis.js and the
     objection drilldown, imported from lib/real-calls.js. This query aggregates
     ACROSS a team (`.in('user_id', ...)`), so without it the demo accounts'
     copied rows are counted as real people's performance. Ava Mitchell read
     "39 calls, 13% closing" on the live board while owning ZERO real calls. */
  calls = realCallsOnly(calls);
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
  bucketRangeLabel: bucketRangeLabel,
};
