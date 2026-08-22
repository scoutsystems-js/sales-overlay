/**
 * TEAM OBJECTION DRILLDOWN — the instance list and the per-closer grid.
 *
 * Manager view only (Justin's ruling, 2026-08-22): closers keep their existing
 * per-user objection surfaces, so this lives under /team/* and is gated there.
 *
 * ⚠ NO NEW DATA. Every field here is already stored — objection_category,
 * resolution, timestamp_seconds, quote, observation, closer_response, plus
 * recording_url for the clip. This is a view over the existing join, not a
 * pipeline. The one thing that must be GENERATED is the coaching summary, and
 * that is deliberately NOT in this module.
 *
 * ⚠ THE INSTANCE SHAPE IS COPIED FROM lib/session-analytics.js computeObjectionIntel
 * SO THE EXISTING FEED ROW RENDERS IT UNCHANGED — same keys, same meanings —
 * plus `closer`, because today's feed is single-user and no row says whose call
 * it is.
 */

'use strict';

const { clipHref } = require('./clip-link');
const { realCallsOnly } = require('./real-calls');
// ⚠ isCredited is IMPORTED, never re-expressed. objection-handled.js exists
// because ten surfaces ask this question and a written-out copy drifts —
// which surfaces as two different handle rates on one screen. This module
// would have been the eleventh copy.
const { outcomeMap, isCredited } = require('./objection-handled');
const crypto = require('crypto');

/* The fingerprint of an empty analysis set. Written as the same md5 the loaded
   path produces for 'empty' so an empty window and a populated one can never
   collide on a cache key, and so the empty return is a real fingerprint rather
   than a null the cache layer has to special-case. */
const EMPTY_FINGERPRINT = crypto.createHash('md5').update('empty').digest('hex');

const OBJECTION_CATEGORIES = ['fear', 'logistical', 'timing', 'partner'];
const UNCATEGORIZED = 'uncategorized';
const ALL_CATEGORIES = OBJECTION_CATEGORIES.concat([UNCATEGORIZED]);
const FEED_CAP = 200;

function emptyCounts() {
  return { total: 0, handled: 0, credited: 0, partial: 0, unhandled: 0 };
}

/**
 * ⚠ THE RATE COUNTS `credited` WITH `handled`, matching every other objection
 * surface. An objection on a call that CLOSED counts as handled — Justin's
 * ruling ("objections are just barriers to a close"). The four buckets sum to
 * the denominator by construction, so the rate always reconciles with the
 * counts printed beside it.
 */
function rateOf(c) {
  var denom = c.handled + c.credited + c.partial + c.unhandled;
  return denom > 0 ? Math.round(((c.handled + c.credited) / denom) * 100) : null;
}

async function computeTeamObjections(admin, memberIds, from, to, opts) {
  opts = opts || {};
  var wantCategory = (ALL_CATEGORIES.indexOf(opts.category) !== -1) ? opts.category : null;
  var emailMap = opts.emailMap || {};
  var nameMap = opts.nameMap || {};
  /* ⚠ THE SUMMARY LANE READS THROUGH THIS FUNCTION ON PURPOSE. It could fetch
     its own calls and highlights, and then the grid and the paragraph beneath
     it could disagree about the same window on the same screen — the failure
     that already cost a round when a picker and a note both said "the team".
     One fetch, one filtered call list, one truth. The two knobs below exist
     only so the summary can ask for the whole set and a cache fingerprint. */
  var cap = (typeof opts.instanceCap === 'number' && opts.instanceCap > 0) ? opts.instanceCap : FEED_CAP;

  /**
   * ⚠ `board_size` IS RETURNED SO THE VIEW NEVER HAS TO ASK ANOTHER LANE.
   * The note under the grid states "N of M closers on this board", and M is
   * exactly `memberIds` — the set this function enumerates. Reading it from
   * `state.teamOverview` instead made the denominator appear only when the
   * user happened to arrive via the Team page and vanish on a deep link or a
   * refresh, which is the standing shared-carrier failure: a value one lane
   * populates and another quietly depends on.
   */
  var boardSize = memberIds ? memberIds.length : 0;

  var empty = {
    category: wantCategory, instances: [], grid: [], closers: [],
    totals: emptyCounts(), instance_count: 0, truncated: false,
    board_size: boardSize, analysis_fingerprint: EMPTY_FINGERPRINT,
    category_totals: (function () {
      var out = {}; ALL_CATEGORIES.forEach(function (c) { out[c] = Object.assign(emptyCounts(), { rate: null }); }); return out;
    })(),
  };
  if (!memberIds || memberIds.length === 0) return empty;

  // ── 1) calls in window, for the team, that COUNT ──
  // ⚠ `is not true`, never `= false`: a `= false` predicate drops every
  // never-assessed row, which is almost the entire corpus.
  var calls = [], PAGE = 1000;
  for (var i = 0; i < memberIds.length; i += 50) {
    var slice = memberIds.slice(i, i + 50);
    var start = 0;
    for (;;) {
      var cq = await admin.from('fathom_calls')
        // duration_seconds powers "where in the call did this land" — the
        // difference between a summary that restates a rate and one that can
        // say an objection arrives at the end and was never pre-handled.
        .select('id, user_id, fathom_call_id, title, call_date, recording_url, source, duration_seconds')
        .in('user_id', slice)
        .gte('call_date', from).lte('call_date', to)
        .not('not_a_sales_call', 'is', true)
        .order('call_date', { ascending: false, nullsFirst: false })
        .range(start, start + PAGE - 1);
      if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
      var batch = cq.data || [];
      calls = calls.concat(batch);
      if (batch.length < PAGE) break;
      start += PAGE;
    }
  }

  // ⚠⚠ THE SYNTHETIC FILTER IS THE LOAD-BEARING LINE OF THIS MODULE. Without it
  // the grid shows Josh three extra times under demo names. See lib/real-calls.js.
  calls = realCallsOnly(calls);
  if (calls.length === 0) return empty;

  var meta = {}, callIds = [];
  calls.forEach(function (c) { meta[c.id] = c; callIds.push(c.id); });

  async function inChunks(table, cols, refine) {
    var out = [];
    for (var j = 0; j < callIds.length; j += 100) {
      var qb = admin.from(table).select(cols).in('fathom_call_id', callIds.slice(j, j + 100));
      if (refine) qb = refine(qb);
      var r = await qb;
      if (r.error) throw new Error(table + ': ' + r.error.message);
      out = out.concat(r.data || []);
    }
    return out;
  }

  // ── 2) outcomes, so a closed call credits its objections ──
  // `analyzed_at` rides along for the cache fingerprint — same select, one more
  // column, no extra query.
  var done = await inChunks('call_analyses', 'fathom_call_id, outcome, analyzed_at', function (q) { return q.eq('status', 'done'); });
  var outcomeByCall = outcomeMap(done);

  /* ⚠⚠ THE FINGERPRINT IS COMPUTED HERE, OVER THE ALREADY-FILTERED CALL LIST,
     AND THAT PLACEMENT IS THE WHOLE MECHANISM — not an implementation detail.
     `callIds` has already had not_a_sales_call and the synthetic rows removed,
     so marking a call drops its analysis out of `done`, which changes the
     fingerprint, which misses the cache. A summary lane computing its own hash
     from its own query would look identical and would keep serving a cached
     paragraph built on a call the manager had just excluded. Copied from
     lib/objection-synthesis.js rather than re-derived. */
  var fingerprint = crypto.createHash('md5').update(
    done.map(function (d) { return d.fathom_call_id + ':' + d.analyzed_at; }).sort().join('|') || 'empty'
  ).digest('hex');

  // ── 3) the objection moments ──
  var rows = await inChunks(
    'call_highlights',
    'id, fathom_call_id, objection_category, objection_surface, resolution, quote, observation, ' +
    'closer_response, timestamp_seconds, speaker_verified, closer_response_verified',
    function (q) { return q.eq('type', 'objection'); }
  );

  // ── 4) fold into instances + the per-closer x per-category grid ──
  var byCloser = {}, totals = emptyCounts(), instances = [];
  /* ⚠ POOLED, NEVER THE MEAN OF PER-CLOSER RATES — the same house rule the
     team-averages gauges follow. The raw counts are printed beside the rate, so
     a mean-of-rates would put a different number on screen from the counts
     underneath it. Accumulated from the SAME filtered rows as the grid, so the
     average inherits the not_a_sales_call and synthetic exclusions rather than
     needing its own. */
  var catTotals = {};
  ALL_CATEGORIES.forEach(function (c) { catTotals[c] = emptyCounts(); });

  rows.forEach(function (r) {
    var m = meta[r.fathom_call_id];
    if (!m) return;                                  // call filtered out above
    var cat = (OBJECTION_CATEGORIES.indexOf(r.objection_category) !== -1) ? r.objection_category : UNCATEGORIZED;

    var res = (r.resolution === 'handled' || r.resolution === 'partial' || r.resolution === 'unhandled') ? r.resolution : null;
    var credited = isCredited(r, outcomeByCall[r.fathom_call_id]);

    var cell = byCloser[m.user_id] || (byCloser[m.user_id] = { user_id: m.user_id, by_category: {}, total: emptyCounts() });
    ALL_CATEGORIES.forEach(function (c) { if (!cell.by_category[c]) cell.by_category[c] = emptyCounts(); });

    [cell.by_category[cat], cell.total, totals, catTotals[cat]].forEach(function (bucket) {
      bucket.total += 1;
      if (credited) bucket.credited += 1;
      else if (res) bucket[res] += 1;
    });

    if (wantCategory && cat !== wantCategory) return;

    instances.push({
      id: r.id,
      fathom_call_id: r.fathom_call_id,
      closer: {
        user_id: m.user_id,
        name: nameMap[m.user_id] || emailMap[m.user_id] || 'Unknown',
        email: emailMap[m.user_id] || null,
      },
      title: m.title || null,
      call_date: m.call_date || null,
      timestamp_seconds: (typeof r.timestamp_seconds === 'number') ? r.timestamp_seconds : null,
      duration_seconds: (typeof m.duration_seconds === 'number') ? m.duration_seconds : null,
      // ⚠ the ONE place a deep link is built — never construct it here.
      clip_url: clipHref(m.recording_url, r.timestamp_seconds),
      source: m.source || null,
      category: cat,
      surface: r.objection_surface || null,
      resolution: res,
      credited: credited,
      quote: r.quote || null,
      observation: r.observation || null,
      closer_response: r.closer_response || null,
      speaker_verified: r.speaker_verified === true,
      closer_response_verified: r.closer_response_verified === true,
    });
  });

  // newest call first, then in-call order
  instances.sort(function (a, b) {
    var d = new Date(b.call_date || 0).getTime() - new Date(a.call_date || 0).getTime();
    if (d !== 0) return d;
    return (a.timestamp_seconds || 0) - (b.timestamp_seconds || 0);
  });

  var grid = Object.keys(byCloser).map(function (uid) {
    var c = byCloser[uid];
    var cats = {};
    ALL_CATEGORIES.forEach(function (k) {
      cats[k] = Object.assign({}, c.by_category[k], { rate: rateOf(c.by_category[k]) });
    });
    return {
      user_id: uid,
      name: nameMap[uid] || emailMap[uid] || 'Unknown',
      email: emailMap[uid] || null,
      by_category: cats,
      total: Object.assign({}, c.total, { rate: rateOf(c.total) }),
    };
  });

  // ⚠ WEAKEST FIRST, and on the UNDERLYING value — never the rounded one.
  // Rounding collapses distinct rates into equal ones and the tie-break then
  // picks deterministically, producing a stable wrong ranking.
  grid.sort(function (a, b) {
    var ar = a.total.rate, br = b.total.rate;
    if (ar === null && br === null) return b.total.total - a.total.total;
    if (ar === null) return 1;
    if (br === null) return -1;
    var exactA = (a.total.handled + a.total.credited) / (a.total.total || 1);
    var exactB = (b.total.handled + b.total.credited) / (b.total.total || 1);
    if (exactA !== exactB) return exactA - exactB;
    return b.total.total - a.total.total;
  });

  return {
    category: wantCategory,
    instances: instances.slice(0, cap),
    instance_count: instances.length,
    // ⚠ NO SILENT CAPS. If the list is trimmed the view must be able to say so.
    truncated: instances.length > cap,
    analysis_fingerprint: fingerprint,
    grid: grid,
    /* The team-average row. Same shape as a grid row's by_category so the
       renderer can reuse one cell function — a second cell renderer for the
       average is how the two would drift into showing different roundings. */
    category_totals: (function () {
      var out = {};
      ALL_CATEGORIES.forEach(function (c) { out[c] = Object.assign({}, catTotals[c], { rate: rateOf(catTotals[c]) }); });
      return out;
    })(),
    board_size: boardSize,
    closers: grid.map(function (g) { return { user_id: g.user_id, name: g.name }; }),
    totals: Object.assign({}, totals, { rate: rateOf(totals) }),
  };
}

module.exports = {
  computeTeamObjections: computeTeamObjections,
  OBJECTION_CATEGORIES: OBJECTION_CATEGORIES,
  ALL_CATEGORIES: ALL_CATEGORIES,
  FEED_CAP: FEED_CAP,
  EMPTY_FINGERPRINT: EMPTY_FINGERPRINT,
  _rateOf: rateOf,
};
