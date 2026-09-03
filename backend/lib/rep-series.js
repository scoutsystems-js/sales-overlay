/**
 * Per-rep weekly series for the manager board (10a).
 *
 * Two lines per rep over time — objection handle rate and closing rate — plus a
 * team average. Pure and deterministic: given the rows, the numbers are
 * arithmetic. ZERO model cost.
 *
 * ⚠ HANDLED INCLUDES CLOSED CALLS (ruling 2026-08-17). An objection on a call
 * that closed is credited whatever its resolution. `partial` on its own scores
 * ZERO — the rule is binary. The predicate lives in lib/objection-handled.js and
 * is shared with the other nine rate surfaces so they cannot disagree.
 *
 * ⚠ THE HANDLE RATE DOES NOT ROUTE THROUGH THE LLM BUCKET LANE. The dashboard
 * tile sources its handle rate from team-needs-work's Claude-grouped buckets;
 * those exist to GROUP surface phrases for the needs-work card, not to compute
 * a rate, and a weekly series through them would cost weeks × reps Claude
 * calls. Here it is handled ÷ objections, straight from call_highlights.
 *
 * ⚠ THE CLOSING RATE IS closed PROSPECTS ÷ TOTAL PROSPECTS — the standing
 * definition, in which OPEN prospects count as not-closed. team-analytics has a
 * `win_rate` that is wins ÷ DECIDED: the retired per-call definition, which
 * reported ~90% where the prospect definition reports ~40%. Putting that on a
 * manager's board would silently undo that correction, so this module never
 * touches it and a guard test enforces the separation.
 *
 * ⚠ EMPTY WEEKS ARE null, NOT ZERO. A week with no objections is "no data" and
 * the line must break; 0% reads as "handled nothing", which is a different and
 * damaging claim. A week where every objection genuinely went unhandled IS 0.
 *
 * ⚠ A PROSPECT BELONGS TO THE WEEK OF THEIR FIRST CALL. Prospects span weeks;
 * counting them in every week they appear would double-count a follow-up
 * sequence and inflate both numerator and denominator.
 *
 * RULING (2026-08-15): the objection selector uses Scout's EXISTING labelling —
 * the four stored `objection_category` values. There is deliberately NO "price"
 * option: money-phrased objections are classified `fear` per the standing rule,
 * unless a genuine logistical payment constraint appears. That is the taxonomy
 * working as designed, not a gap. Do not invent a parallel vocabulary.
 */

const { DQ_OUTCOME } = require('./dq-exclusion');
const { countsAsObjection } = require('./objection-strict');
const { bucketStart, bucketRangeLabel } = require('./team-analytics');
const { prospectOutcome, hadAConversation, anchorOf } = require('./prospect-entity');
const { isHandled } = require('./objection-handled');

// The selector vocabulary. Scout's own labels — see the ruling above.
const OBJECTION_CATEGORIES = require('./objection-categories').STORED_OBJECTION_CATEGORIES;   /* ⚠ ONE SOURCE (fix #7, H680): the ruled set in its stored order — never a literal copy here (sweep ③-3) */

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }

function bucketKeys(from, to, bucket) {
  var keys = [];
  var cur = bucketStart(from, bucket).getTime();
  var end = bucketStart(to, bucket).getTime();
  var guard = 0;
  // Raised for daily buckets: 500 truncates ~16 months of days SILENTLY, which
  // would read as a chart that simply stops rather than as an error.
  while (cur <= end && guard++ < 1500) {
    keys.push(cur);
    // Step forward a day at a time from the bucket start and re-normalise, so
    // month/quarter boundaries and DST are the existing helper's problem, not
    // arithmetic done twice.
    var next = cur;
    var probe = new Date(cur);
    do {
      probe = new Date(probe.getTime() + 24 * 3600 * 1000);
      next = bucketStart(probe.toISOString(), bucket).getTime();
    } while (next === cur && guard++ < 1500);
    cur = next;
  }
  return keys;
}

/**
 * @param {object} input
 *   reps      [{user_id, name}]
 *   calls     [{id, user_id, call_date, prospect_id}]
 *   analyses  [{fathom_call_id, outcome}]
 *   objections[{fathom_call_id, resolution, objection_category}]
 *   from,to   ISO bounds
 *   bucket    'week' | 'month' | 'quarter'
 *   objectionCategory  one of OBJECTION_CATEGORIES, or null for all
 *
 * Never throws. Malformed input yields an empty series.
 */
function buildRepSeries(input) {
  var d = input || {};
  var reps = Array.isArray(d.reps) ? d.reps : [];
  var calls = Array.isArray(d.calls) ? d.calls : [];
  var analyses = Array.isArray(d.analyses) ? d.analyses : [];
  var objections = Array.isArray(d.objections) ? d.objections : [];
  // 'day' for short ranges (7d), 'week' otherwise. Anything unrecognised falls
  // back to 'week' rather than producing one giant bucket.
  var VALID_BUCKETS = ['day', 'week', 'month', 'quarter'];
  var bucket = VALID_BUCKETS.indexOf(d.bucket) !== -1 ? d.bucket : 'week';
  var cat = (OBJECTION_CATEGORIES.indexOf(d.objectionCategory) !== -1) ? d.objectionCategory : null;

  var from = d.from, to = d.to;
  if (!from || !to) {
    var dates = calls.map(function (c) { return c && c.call_date; }).filter(Boolean).sort();
    from = from || dates[0]; to = to || dates[dates.length - 1];
  }
  if (!from || !to) return { bucket: bucket, buckets: [], reps: [], team: { handle: [], close: [] }, objection_category: cat };

  var keys = bucketKeys(from, to, bucket);
  var index = {}; keys.forEach(function (k, i) { index[k] = i; });
  var buckets = keys.map(function (k) {
    return { key: k, from: new Date(k).toISOString(), label: bucketRangeLabel(k, bucket, Date.parse(to)) };
  });

  var callById = {};
  calls.forEach(function (c) { if (c && c.id) callById[c.id] = c; });
  var outcomeOf = {};
  analyses.forEach(function (a) { if (a && a.fathom_call_id) outcomeOf[a.fathom_call_id] = a.outcome || null; });
  /* H706 — the prospect's whole history (the route fetches it without the window) so a
     prospect is anchored at its first BOOKED call, and its outcomes come from every call. */
  var prospectCalls = Array.isArray(d.prospect_calls) ? d.prospect_calls : null;
  (Array.isArray(d.prospect_analyses) ? d.prospect_analyses : []).forEach(function (a) { if (a && a.fathom_call_id && !(a.fathom_call_id in outcomeOf)) outcomeOf[a.fathom_call_id] = a.outcome || null; });

  // ── handle rate: objections attributed to their call's week ──────────────
  var hAcc = {};   // user -> bucketIndex -> {handled, total}
  objections.forEach(function (o) {
    if (!o) return;
    if (cat && o.objection_category !== cat) return;
    var c = callById[o.fathom_call_id];
    if (!c || !c.call_date) return;
    var i = index[bucketStart(c.call_date, bucket).getTime()];
    if (i === undefined) return;
    /* ⚠⚠ THE EXCLUSIONS COME BEFORE THE COUNT (H674, 2026-09-02). Until today
       `cell.total++` ran first, so a DQ call's objections and every
       logistical_barrier / disqualification row sat in the DENOMINATOR while
       only the numerator skipped them — the graph's rate read LOWER than the
       cards' for the same rows. One definition means one order, everywhere. */
    // Ruling 2026-08-17: an objection on a CLOSED call is credited whatever its
    // resolution — they side-stepped the barrier and still closed. One shared
    // predicate; see lib/objection-handled.js for why it is not inlined.
    /* ⚠ DQ CALLS LEAVE BOTH GRAPHS — objection handling % and closing %.
       Their objections were never winnable, and their prospect was never
       closeable. The call still counts as analysed elsewhere. */
    if (outcomeOf[o.fathom_call_id] === DQ_OUTCOME) return;
    // ⚠ one definition — see lib/objection-strict.js
    if (!countsAsObjection(o)) return;
    var byUser = hAcc[c.user_id] || (hAcc[c.user_id] = {});
    var cell = byUser[i] || (byUser[i] = { handled: 0, total: 0 });
    cell.total++;
    if (isHandled(o, outcomeOf[o.fathom_call_id])) cell.handled++;
  });

  // ── closing rate: prospects, bucketed by their FIRST call ────────────────
  /* ⚠⚠ H706 — ATTRIBUTION: a prospect is bucketed at its FIRST BOOKED call (anchorOf —
     the earliest call that is not a follow-up), read across the prospect's history so a
     prospect booked before the picker's start does not re-anchor at its first in-window
     call. Outcomes come from every call of the prospect (any close wins). */
  var prospects = {};  // user -> prospect_id -> {calls:[], outcomes:[]}
  (prospectCalls || calls).forEach(function (c) {
    if (!c || !c.prospect_id || !c.call_date) return;   // no prospect => not a prospect
    /* ⚠ AND THE SAME EXCLUSION ON THE CLOSING GRAPH. A prospect whose only call
       is a DQ contributes no calls and leaves both halves by construction —
       the same property lib/prospect-entity relies on. */
    if (outcomeOf[c.id] === DQ_OUTCOME) return;
    var byUser = prospects[c.user_id] || (prospects[c.user_id] = {});
    var p = byUser[c.prospect_id] || (byUser[c.prospect_id] = { calls: [], outcomes: [] });
    p.calls.push(c);
    p.outcomes.push(outcomeOf[c.id] || null);
  });

  var cAcc = {};   // user -> bucketIndex -> {closed, total}
  Object.keys(prospects).forEach(function (user) {
    Object.keys(prospects[user]).forEach(function (pid) {
      var p = prospects[user][pid];
      var anchor = anchorOf(p.calls);
      if (!anchor) return;
      var i = index[bucketStart(new Date(anchor).toISOString(), bucket).getTime()];
      if (i === undefined) return;
      var byUser = cAcc[user] || (cAcc[user] = {});
      var cell = byUser[i] || (byUser[i] = { closed: 0, total: 0 });
      /* ⚠⚠ ONE DEFINITION, AND ONLY THE closed/total DECISION MOVED — the
         BUCKETING is still this module's own concern, which is the point: the
         window differs legitimately (picker here, fixed 7 days on the gauge),
         the definition must not. `hadAConversation` is what drops a no-show or
         a DQ prospect: calls TAKEN, not booked. */
      if (!hadAConversation(p.outcomes)) return;
      cell.total++;
      if (prospectOutcome(p.outcomes) === 'closed') cell.closed++;
    });
  });

  // ── time to price: MINUTES, not a rate (item j) ──────────────────────────
  // ⚠ THIS SERIES IS A DURATION, NOT A PERCENTAGE. Its y-axis is minutes and it
  // must never share an axis with the two rate graphs.
  // ⚠ A call with a NULL price moment is EXCLUDED, never counted as 0 — the same
  // rule as an empty week on the rate lines, and for the same reason: ~1 in 5
  // closed calls genuinely has no price drop (a second call on an agreed deal),
  // and 0 would read as "priced immediately".
  var pAcc = {};   // user -> bucketIndex -> {secs, calls}
  analyses.forEach(function (a) {
    if (!a) return;
    var secs = a.price_stated_at_seconds;
    if (typeof secs !== 'number' || !isFinite(secs)) return;   // NULL is excluded, never zeroed
    var c = callById[a.fathom_call_id];
    if (!c || !c.call_date) return;
    var i = index[bucketStart(c.call_date, bucket).getTime()];
    if (i === undefined) return;
    var byUser = pAcc[c.user_id] || (pAcc[c.user_id] = {});
    var cell = byUser[i] || (byUser[i] = { secs: 0, calls: 0 });
    cell.secs += secs; cell.calls++;
  });

  /* ── volume, score and call length ────────────────────────────────────────
     ⚠⚠ THE REAL ANSWER TO "VERY CUSTOMIZABLE" IS HISTORY, NOT MORE CHART TYPES.
     Seven of ten metrics were snapshots, so seven of ten could never have a
     line — and a bar chart of a snapshot is the same number in a different
     outline. These three cost one column between them because the rows were
     ALREADY fetched and ALREADY bucketed here.

     ⚠⚠ AND EACH ONE MATCHES ITS NUMBER CARD'S DEFINITION EXACTLY, because a
     graph and the figure beside it disagreeing is the defect this codebase has
     paid for most often:
       calls    — analysed calls, DQ INCLUDED. `team-analytics` says so in its
                  own words: "calls_analyzed above is UNTOUCHED — the work
                  happened", and that is Justin's ruling on DQ calls.
       score    — mean overall_score over the same set.
       prospects— the CLOSING DENOMINATOR (`cAcc.total`), which is what the
                  number card reads, so DQ and no-show prospects leave it. It is
                  free: already computed above.
       duration — mean minutes. ⚠ A DURATION, NOT A RATE — it must never share
                  an axis with the rate lines, exactly like the price series. */
  var scoreOf = {};
  analyses.forEach(function (a) {
    if (a && a.fathom_call_id && typeof a.overall_score === 'number') scoreOf[a.fathom_call_id] = a.overall_score;
  });
  var analysedIds = {};
  analyses.forEach(function (a) { if (a && a.fathom_call_id) analysedIds[a.fathom_call_id] = true; });

  var vAcc = {};   // user -> bucketIndex -> {calls, scoreSum, scoreN, secs, durN}
  calls.forEach(function (c) {
    if (!c || !c.call_date) return;
    if (!analysedIds[c.id]) return;               // "calls graded", not "calls synced"
    var i = index[bucketStart(c.call_date, bucket).getTime()];
    if (i === undefined) return;
    var byUser = vAcc[c.user_id] || (vAcc[c.user_id] = {});
    var cell = byUser[i] || (byUser[i] = { calls: 0, scoreSum: 0, scoreN: 0, secs: 0, durN: 0 });
    cell.calls++;
    var sc = scoreOf[c.id];
    if (typeof sc === 'number') { cell.scoreSum += sc; cell.scoreN++; }
    /* ⚠ A ZERO-LENGTH CALL IS EXCLUDED, NOT AVERAGED IN. 2,005 of 2,052 real
       calls have a duration above zero; the rest are artefacts, and averaging a
       zero in drags the line toward "instant call" for a call that never
       happened. Same rule as a NULL price moment. */
    if (typeof c.duration_seconds === 'number' && c.duration_seconds > 0) {
      cell.secs += c.duration_seconds; cell.durN++;
    }
  });

  var repSeries = reps.map(function (r) {
    var u = r && r.user_id;
    return {
      user_id: u,
      name: (r && r.name) || null,
      // Carried straight through from the route. False = this rep has no offer
      // price saved, so the price series can never have a point for them — the
      // chart says so by name rather than dropping them without explanation.
      handle: keys.map(function (k, i) {
        var cell = (hAcc[u] || {})[i] || { handled: 0, total: 0 };
        return { rate: pct(cell.handled, cell.total), handled: cell.handled, total: cell.total };
      }),
      close: keys.map(function (k, i) {
        var cell = (cAcc[u] || {})[i] || { closed: 0, total: 0 };
        return { rate: pct(cell.closed, cell.total), closed: cell.closed, total: cell.total };
      }),
      // `rate` here carries MINUTES so the chart code can stay one function.
      // The unit lives on the axis label, and priceMinutes() is the only place
      // that knows it — see the axis note in dashboard.html.
      price: keys.map(function (k, i) {
        var cell = (pAcc[u] || {})[i] || { secs: 0, calls: 0 };
        return {
          rate: cell.calls ? Math.round((cell.secs / cell.calls / 60) * 10) / 10 : null,
          calls: cell.calls, total: cell.calls,
        };
      }),
      /* ⚠ A COUNT, NOT A RATE — `rate` is the field name the chart reads, and it
         carries whatever the series measures. The axis label is what says which,
         and it is the only place that knows. */
      calls: keys.map(function (k, i) {
        var cell = (vAcc[u] || {})[i] || { calls: 0 };
        /* ⚠ ZERO IS A REAL WEEK HERE, NOT AN ABSENCE — a rep who took no calls
           took no calls, which is exactly what a volume line should show. That
           is the opposite of the rate lines, where an empty week is unmeasured
           and must stay null. Same distinction, opposite answer, because the
           question is different. */
        return { rate: cell.calls, calls: cell.calls, total: cell.calls };
      }),
      score: keys.map(function (k, i) {
        var cell = (vAcc[u] || {})[i] || { scoreSum: 0, scoreN: 0 };
        return { rate: cell.scoreN ? Math.round(cell.scoreSum / cell.scoreN) : null,
                 calls: cell.scoreN, total: cell.scoreN };
      }),
      duration: keys.map(function (k, i) {
        var cell = (vAcc[u] || {})[i] || { secs: 0, durN: 0 };
        return { rate: cell.durN ? Math.round((cell.secs / cell.durN / 60) * 10) / 10 : null,
                 calls: cell.durN, total: cell.durN };
      }),
      prospects: keys.map(function (k, i) {
        /* ⚠ THE CLOSING DENOMINATOR, REUSED — the number card reads
           `prospect_close_total`, so the graph must read the same thing or the
           card and the line beside it disagree about the same word. Free. */
        var cell = (cAcc[u] || {})[i] || { closed: 0, total: 0 };
        return { rate: cell.total, calls: cell.total, total: cell.total };
      }),
    };
  });

  // ── team line: a real average ACROSS REPS ────────────────────────────────
  // Mean of the reps who HAVE data that week. A rep with no calls that week is
  // absent, not a zero — including them would drag the team line down for not
  // working rather than for working badly. Raw totals travel too, per the house
  // rule that a rate never renders without its counts.
  function teamLine(pick) {
    return keys.map(function (k, i) {
      var rates = [], num = 0, den = 0;
      repSeries.forEach(function (rs) {
        var p = pick(rs)[i];
        if (p.rate === null) return;
        rates.push(p.rate);
        num += (p.handled !== undefined) ? p.handled
             : (p.closed !== undefined) ? p.closed
             : p.calls;                       // price: the sample, not a numerator
        den += p.total;
      });
      if (!rates.length) return { rate: null, reps_counted: 0, numerator: 0, total: 0 };
      var mean = Math.round(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length);
      return { rate: mean, reps_counted: rates.length, numerator: num, total: den };
    });
  }

  return {
    bucket: bucket,
    objection_category: cat,
    buckets: buckets,
    reps: repSeries,
    team: {
      handle: teamLine(function (r) { return r.handle; }),
      close: teamLine(function (r) { return r.close; }),
      price: teamLine(function (r) { return r.price; }),
      /* ⚠ THE TEAM LINE ON A COUNT IS A MEAN PER REP, NOT A TOTAL — teamLine
         averages the reps who have data, so "calls" reads as calls per rep and
         "prospects" as prospects per rep. A team TOTAL would tower over every
         rep line and flatten the comparison the chart exists for. */
      calls: teamLine(function (r) { return r.calls; }),
      score: teamLine(function (r) { return r.score; }),
      duration: teamLine(function (r) { return r.duration; }),
      prospects: teamLine(function (r) { return r.prospects; }),
    },
  };
}

module.exports = {
  buildRepSeries: buildRepSeries,
  OBJECTION_CATEGORIES: OBJECTION_CATEGORIES,
  _bucketKeys: bucketKeys,
};
