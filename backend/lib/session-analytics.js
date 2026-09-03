// Fathom-era analytics aggregation (a supabase admin client + scope params →
// the response shape; no HTTP concerns), shared by the /me/* and /admin/*
// surfaces. computeCallAnalytics powers the coaching glance tiles + /analytics2;
// computeObjectionIntel powers the Objections intelligence view.
// (The legacy call_sessions helpers — computeAnalytics / loadSessionObjections /
// loadObjectionsByType — were removed 2026-07-29 with the Live-Sessions cleanup.)

var CALL_ANALYTICS_SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];
// Reuse the TEAM view's prior-window machinery for the Avg-score tile trend, so
// "prior period" means the exact same thing everywhere (no second implementation).
const { isDisqualified } = require('./dq-exclusion');
var teamAnalytics = require('./team-analytics');
const { isCredited } = require('./objection-handled');
const { countsAsObjection } = require('./objection-strict');   // the ONE definition — see test/objection-counting-carrier.test.js
var { fetchProspectCloseRates } = require('./prospect-entity');

const { clipHref } = require('./clip-link');
const { displayCloserResponse, provenCloserResponse } = require('./closer-side');
// Prior equal-length window's avg score for `userId`, via the reused team
// aggregator. Returns a rounded mean, or null when there are no graded calls in
// the prior window (new user / window predates their first call) → tile shows no
// arrow. Non-fatal: any failure yields null (the trend just doesn't render).
async function priorWindowAvgScore(admin, userId, from, to) {
  try {
    var span = new Date(to).getTime() - new Date(from).getTime();
    if (!(span > 0)) return null;
    var priorFrom = new Date(new Date(from).getTime() - span).toISOString();
    var prior = await teamAnalytics._aggregateWindow(admin, [userId], priorFrom, from);
    var pr = prior && prior.rep && prior.rep[userId];
    return (pr && pr.score_n > 0) ? Math.round(pr.score_sum / pr.score_n) : null;
  } catch (e) {
    return null;
  }
}

async function computeCallAnalytics(admin, userId, from, to) {
  // 3d-3: the ONE shared prospect close-rate computation (lib/prospect-entity).
  // Degrades to {pct:null} on any failure so a close-rate problem renders "—"
  // rather than breaking the analytics response.
  /* ⚠⚠ STARTED NOW, AWAITED WITH THE REST. The prospect rate and the prior
     window depend on nothing computed below, and the Coaching lead number
     waited on them one after another (~6s on production with every cache
     hit). The no-op catch keeps a rejection from becoming an unhandled
     rejection while the calls query is still in flight; the real await below
     still throws it. */
  var _pcrP = fetchProspectCloseRates(admin, [userId], from, to);
  _pcrP.catch(function () {});
  var _priorP = priorWindowAvgScore(admin, userId, from, to);
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
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
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
    close_wins: 0, close_decided: 0,
    sections: sectionsShape(),
    weakest_section: null, strongest_section: null,
    latest_one_things: [],
  };
  if (callIds.length === 0) return empty;

  // Chunked .in('fathom_call_id', …) helper — keeps each request small and
  // under the row cap; scopes child rows to the in-window calls without a huge
  // IN list or fetching the user's entire all-time history.
  async function fetchByCallIds(table, columns, refine) {
    var qs = [];
    for (var c = 0; c < callIds.length; c += 100) {
      var qb = admin.from(table).select(columns).in('fathom_call_id', callIds.slice(c, c + 100));
      if (refine) qb = refine(qb);
      qs.push(qb);
    }
    var rs = await Promise.all(qs);   // every chunk at once; concatenated in chunk order
    var out = [];
    rs.forEach(function (r) {
      if (r.error) throw new Error(table + ': ' + r.error.message);
      out = out.concat(r.data || []);
    });
    return out;
  }

  // 2) call_analyses for those calls — status, overall + section scores, one_thing.
  var _both = await Promise.all([
    fetchByCallIds('call_analyses',
      'fathom_call_id, status, outcome, overall_score, cash_collected, intro_score, discovery_score, pitch_score, objection_score, close_score, one_thing'),
    fetchByCallIds('call_highlights', 'fathom_call_id', function(qb) { return qb.eq('type', 'objection'); }),
    _pcrP,
  ]);
  var analyses = _both[0];
  var _pcr = _both[2];
  var prospectRate = _pcr[userId] || { closed: 0, total: 0, pct: null };

  var statusCounts = { done: 0, processing: 0, error: 0 };
  var scoreSum = 0, scoreN = 0;
  // A-1 glance tiles: cash collected (sum) + close rate = closed/(closed+lost),
  // DECIDED calls only (ruling 1: follow_up is open pipeline, no_show excluded).
  var cashSum = 0, closeWon = 0, closeDecided = 0;
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
    // cash_collected: numeric(12,2), grader-forced 0 on non-closed. PostgREST may
    // return numeric as a string, so coerce defensively.
    var cash = Number(an.cash_collected); if (isFinite(cash)) cashSum += cash;
    if (an.outcome === 'closed') { closeWon++; closeDecided++; }
    else if (an.outcome === 'lost') { closeDecided++; }
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
  var objRowsAll = _both[1];
  /* ⚠⚠ DISQUALIFIED CALLS LEAVE THE OBJECTION FIGURES AND STAY IN `analyzed`.
     That split is the whole ruling: the work happened, so the call counts as
     work; the prospect was never closeable, so their objections do not count
     against the rep. ⚠ `statusCounts.done` above is deliberately untouched. */
  var dqSet = {};
  (analyses || []).forEach(function (a2) { if (isDisqualified(a2)) dqSet[a2.fathom_call_id] = 1; });
  var objRows = objRowsAll.filter(function (r) { return !dqSet[r.fathom_call_id]; });
  var objCalls = {};
  for (var o = 0; o < objRows.length; o++) { objCalls[objRows[o].fathom_call_id] = true; }

  var result = {
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
    /* ⚠ CASH REMOVED FROM THIS PAYLOAD 2026-08-25 (Justin): "we don't track
       cash collected at all... the only time it's needed is on the EOD report."
       A DISPLAY ruling — call_analyses.cash_collected is still extracted by the
       grader and still drives EOD. Removed from the payload rather than merely
       unrendered, so it cannot quietly reappear on a tile later. */
    // 3d-3: close rate is now closed PROSPECTS / TOTAL prospects. The old
    // decided-only per-CALL figure is kept ONLY as close_wins/close_decided for
    // any legacy caller; the rendered rate comes from prospect_close_* below.
    close_wins: closeWon, close_decided: closeDecided,
    prospect_close_rate:  prospectRate.pct,
    prospect_close_wins:  prospectRate.closed,
    prospect_close_total: prospectRate.total,
    sections: sections,
    weakest_section: weakest,
    strongest_section: strongest,
    latest_one_things: latestOneThings,
  };
  // Avg-score tile trend baseline (period-over-period). Attached to avg_score so
  // the client can render the arrow + delta % next to the mean; null when there's
  // no prior-window data (→ no arrow).
  result.avg_score.prior_mean = await _priorP;
  return result;
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
      .select('id, title, call_date, recording_url, source')
      .eq('user_id', userId)
      .gte('call_date', from)
      .lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
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
  OBJECTION_CATEGORIES.concat(['uncategorized']).forEach(function(c) { emptyCats[c] = { total: 0, handled: 0, partial: 0, unhandled: 0, credited: 0 }; });
  var base = {
    from: from, to: to,
    // ⚠ `credited` is a FOURTH bucket, not a reclassification: handled/partial/
    // unhandled still report the moment's OWN resolution. Without it the four
    // numbers on screen would not add up to the rate printed beside them,
    // which is how a manager stops trusting the page.
    metrics: { total: 0, calls_with_objection: 0, handled: 0, partial: 0, unhandled: 0, credited: 0, handled_rate: null },
    by_category: emptyCats,
    feed: [],
  };
  if (callIds.length === 0) return base;

  // 2) objection highlights for those calls (chunked, cap-safe).
  var rows = [];
  for (var c = 0; c < callIds.length; c += 100) {
    var hr = await admin
      .from('call_highlights')
      .select('fathom_call_id, timestamp_seconds, quote, observation, objection_surface, objection_category, objection_class, resolution, closer_response, closer_response_verified')
      .in('fathom_call_id', callIds.slice(c, c + 100))
      .eq('type', 'objection');
    if (hr.error) throw new Error('call_highlights: ' + hr.error.message);
    rows = rows.concat(hr.data || []);
  }

  // Ruling 2026-08-17: an objection on a CLOSED call counts as handled, so this
  // lane needs the per-call outcome. It is NOT already in scope here — the
  // win/loss split lives in computeCallAnalytics, a different function — so this
  // is one chunked select, matching the pattern directly above.
  var outcomeByCall = {};
  for (var oc = 0; oc < callIds.length; oc += 100) {
    var orq = await admin.from('call_analyses').select('fathom_call_id, outcome')
      .in('fathom_call_id', callIds.slice(oc, oc + 100)).eq('status', 'done');
    if (orq.error) throw new Error('call_analyses: ' + orq.error.message);
    (orq.data || []).forEach(function (a) { outcomeByCall[a.fathom_call_id] = a.outcome || null; });
  }
  var callsWith = {};
  var feed = [];
  rows.forEach(function(r) {
    /* ⚠ ONE DEFINITION OF WHAT COUNTS (H674): the strict predicate — a row with no
       class (pre-v37) counts; a stored logistical_barrier or disqualification does
       not. This page counted every row until 2026-09-02, the third answer sweep
       block 6 found. The feed below still lists the moment; only the rate excludes it. */
    if (!countsAsObjection(r)) return;
    callsWith[r.fathom_call_id] = true;
    base.metrics.total += 1;
    var res = (r.resolution === 'handled' || r.resolution === 'partial' || r.resolution === 'unhandled') ? r.resolution : null;
    var outcome = outcomeByCall[r.fathom_call_id];
    var credited = isCredited(r, outcome);
    if (credited) base.metrics.credited += 1; else if (res) base.metrics[res] += 1;
    var cat = (OBJECTION_CATEGORIES.indexOf(r.objection_category) !== -1) ? r.objection_category : 'uncategorized';
    base.by_category[cat].total += 1;
    if (credited) { base.by_category[cat].credited += 1; }
    else if (res) base.by_category[cat][res] += 1;

    var m = meta[r.fathom_call_id] || {};
    var clip = clipHref(m.recording_url, r.timestamp_seconds);
    feed.push({
      fathom_call_id: r.fathom_call_id,
      title: m.title || null,
      call_date: m.call_date || null,
      timestamp_seconds: (typeof r.timestamp_seconds === 'number') ? r.timestamp_seconds : null,
      clip_url: clip,
      source: m.source || null,
      surface: r.objection_surface || null,
      category: cat,
      resolution: res,
      credited: credited,   // 'Credited (call closed)' badge
      quote: r.quote || null,
      observation: r.observation || null,
      closer_response: provenCloserResponse(r),
    });
  });
  base.metrics.calls_with_objection = Object.keys(callsWith).length;
  // The four buckets sum to the denominator by construction, so the rate always
  // reconciles with the counts printed next to it.
  var denom = base.metrics.handled + base.metrics.credited + base.metrics.partial + base.metrics.unhandled;
  base.metrics.handled_rate = denom > 0
    ? Math.round(((base.metrics.handled + base.metrics.credited) / denom) * 100) : null;

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
  computeCallAnalytics: computeCallAnalytics,
  computeObjectionIntel: computeObjectionIntel,
};
