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
/* ⚠⚠ THE STRICT STANDARD (Justin's ruling, 2026-08-22): "the strict guidelines
   for objection handling is the standard." Disqualifications and payment /
   logistical barriers are NOT coachable objections and must not count toward
   any rate. That distinction is NOT derivable from the stored columns —
   `objection_category` has a `logistical` value, but it means a logistical
   OBJECTION, and there is no disqualification concept stored at all. It comes
   from the same classifier the old panel used, imported rather than rebuilt. */
const { getBucketMapping, normSurface } = require('./team-needs-work');
const { snapCacheWindow } = require('./cache-window');
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
    strict: true, strict_reason: null, excluded: { disqualifications: 0, logistical: 0 },
    bucket_rates: [],
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
        .is('duplicate_of', null)
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

  /* ── 3b) THE STRICT STANDARD ────────────────────────────────────────────
     Classify the distinct surface phrases into true_objection /
     logistical_barrier / disqualification, and drop everything that is not a
     true objection from the grid, the totals AND the feed — counting what was
     dropped so the panel can say so out loud.

     ⚠ CACHED under its own synthesis_type on the SAME fingerprint the rest of
     this module uses, so it invalidates when the analysis set does — including
     when a call is marked not-a-sales-call.

     ⚠⚠ IF THE CLASSIFIER IS UNAVAILABLE WE DO NOT SILENTLY FALL BACK TO THE
     LOOSE RATE. Loose numbers presented as if they were the strict standard
     would be a data problem rendering as good news, and the rate would read
     HIGHER than the truth — the direction that flatters. `strict:false` travels
     with the payload so the view labels what it is actually showing. */
  var strict = true, strictReason = null;
  var excluded = { disqualifications: 0, logistical: 0 };
  var bucketOf = {};   // normalised surface → { label, cls }
  if (opts.strict !== false) {
    var surfaces = {};
    rows.forEach(function (r) {
      var s = String(r.objection_surface == null ? '' : r.objection_surface).trim();
      if (s) surfaces[s] = (surfaces[s] || 0) + 1;
    });
    var distinct = Object.keys(surfaces);
    if (distinct.length === 0) {
      strict = false; strictReason = 'no objection phrases to classify';
    } else {
      var ck0 = snapCacheWindow(from, to);
      var bucketKey = crypto.createHash('md5')
        .update(fingerprint + '|buckets|' + distinct.slice().sort().join('|')).digest('hex');
      var cached = null;
      var cq0 = await admin.from('objection_synthesis_cache').select('synthesis')
        .eq('user_id', opts.keyId || memberIds[0]).eq('synthesis_type', 'objection_buckets')
        .eq('from_ts', ck0.from).eq('to_ts', ck0.to).eq('analysis_set_hash', bucketKey).maybeSingle();
      if (!cq0.error && cq0.data && cq0.data.synthesis) cached = cq0.data.synthesis;

      var map = cached;
      if (!map) {
        var got = await getBucketMapping(rows.map(function (r) { return { surface: r.objection_surface }; }));
        if (got.ok) {
          map = { mapping: got.mapping, bucketClass: got.bucketClass, generated_at: new Date().toISOString() };
          // best effort — a cache write failure must not fail the panel
          var up0 = await admin.from('objection_synthesis_cache').upsert({
            user_id: opts.keyId || memberIds[0], synthesis_type: 'objection_buckets',
            from_ts: ck0.from, to_ts: ck0.to, analysis_set_hash: bucketKey,
            synthesis: map, generated_at: map.generated_at,
          }, { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
          if (up0.error) console.error('[team-objections] bucket cache write failed: ' + up0.error.message);
        } else {
          strict = false;
          strictReason = got.empty ? 'no objection phrases to classify' : (got.reason || 'classification unavailable');
        }
      }
      if (map) {
        rows.forEach(function (r) {
          var k = normSurface(r.objection_surface);
          var label = k ? map.mapping[k] : null;
          if (label) bucketOf[k] = { label: label, cls: map.bucketClass[label] || 'true_objection' };
        });
      }
    }
  } else {
    strict = false; strictReason = 'strict classification not requested';
  }

  /** true when this moment counts toward a rate under the strict standard. */
  function isCoachable(r) {
    if (!strict) return true;
    var b = bucketOf[normSurface(r.objection_surface)];
    /* ⚠ AN UNCLASSIFIED PHRASE COUNTS. Dropping it would silently shrink the
       denominator on data the classifier simply never saw — an exclusion the
       manager was never told about, which is the opposite of the exclusion line
       this feature exists to show. Measured on the live board: 0 of 177. */
    if (!b) return true;
    return b.cls === 'true_objection';
  }

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
  /* ⚠ RATES PER SALES-LANGUAGE BUCKET — "Spouse / partner approval",
     "Needs time / think it over", "Price / too expensive". The one thing the
     old Objection Handling Focus panel had that this one did not, which is why
     that panel could not be archived until now.

     ⚠ ACCUMULATED HERE, NOT DERIVED FROM `instances` ON THE CLIENT: the
     instance list is capped (FEED_CAP), so a client-side tally would quietly
     compute these rates over a truncated sample as soon as a board got busy —
     a wrong number with nothing on screen to suggest it. Keyed per closer as
     well, so the rep filter can pool over the visible ones. */
  var bucketTotals = {};

  rows.forEach(function (r) {
    var m = meta[r.fathom_call_id];
    if (!m) return;                                  // call filtered out above

    /* ⚠ NOT COACHABLE → OUT OF THE GRID, THE TOTALS AND THE FEED, but COUNTED.
       The old panel's behaviour exactly: the math never sees them and a line
       underneath says how many there were. Silently dropping them would make
       the rate move for a reason nobody could see. */
    if (!isCoachable(r)) {
      var b0 = bucketOf[normSurface(r.objection_surface)];
      if (b0 && b0.cls === 'disqualification') excluded.disqualifications += 1;
      else if (b0 && b0.cls === 'logistical_barrier') excluded.logistical += 1;
      return;
    }

    var cat = (OBJECTION_CATEGORIES.indexOf(r.objection_category) !== -1) ? r.objection_category : UNCATEGORIZED;

    var res = (r.resolution === 'handled' || r.resolution === 'partial' || r.resolution === 'unhandled') ? r.resolution : null;
    var credited = isCredited(r, outcomeByCall[r.fathom_call_id]);

    var cell = byCloser[m.user_id] || (byCloser[m.user_id] = { user_id: m.user_id, by_category: {}, total: emptyCounts() });
    ALL_CATEGORIES.forEach(function (c) { if (!cell.by_category[c]) cell.by_category[c] = emptyCounts(); });

    var bLabel = (bucketOf[normSurface(r.objection_surface)] || {}).label || null;
    var bAcc = null;
    if (bLabel) {
      var bRow = bucketTotals[bLabel] || (bucketTotals[bLabel] = { label: bLabel, by_closer: {} });
      bAcc = bRow.by_closer[m.user_id] || (bRow.by_closer[m.user_id] = emptyCounts());
    }

    [cell.by_category[cat], cell.total, totals, catTotals[cat]].concat(bAcc ? [bAcc] : []).forEach(function (bucket) {
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
      /* ⚠ THE CLASSIFIER'S SALES-LANGUAGE LABEL — "Spouse / partner approval",
         "Needs time / think it over", "Price / too expensive". Free here: the
         same mapping that decides what counts also names it.

         ⚠ IT DOES NOT DRIVE THE GRID'S COLUMNS, DELIBERATELY. These labels are
         model-generated and window-dependent (4-8 of them, different phrasing
         each period), and a comparison table whose columns change when you
         widen the date range is one a manager cannot trust. The columns stay
         the four stored categories; the sales language rides on the moment,
         where varying wording costs nothing. */
      bucket_label: (bucketOf[normSurface(r.objection_surface)] || {}).label || null,
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
    /* ⚠ THE DEFINITION TRAVELS WITH THE NUMBERS. A rate is meaningless without
       knowing what it counted, and this panel's denominator now depends on a
       classifier that can be unavailable. `strict` says which definition
       produced these figures; `excluded` is what the panel prints underneath. */
    strict: strict,
    strict_reason: strictReason,
    excluded: excluded,
    /* Per-closer so the rep filter can pool over the visible ones — the client
       sums the closers it is showing, exactly as it does for the average row. */
    bucket_rates: Object.keys(bucketTotals).map(function (k) { return bucketTotals[k]; }),
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
