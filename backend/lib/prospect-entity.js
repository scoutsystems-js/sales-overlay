// lib/prospect-entity.js — the PROSPECT entity + the close-rate rollup.
// PROSPECT NAMES, sub-stage 3d-1.
//
// ── THE RULING this file implements (2026-08-03) ──────────────────────────
// Close rate = `closed PROSPECTS ÷ TOTAL PROSPECTS`.
//   • Follow-up calls COLLAPSE into their prospect — "if 1 prospect takes 3
//     calls to close that SHOULDN'T count as 3 calls, it's 1 prospect getting
//     closed". Multi-call prospects never inflate the denominator.
//   • OPEN prospects COUNT in the denominator as not-closed. That single choice
//     is what removes the need for an aging rule, a "still open" bucket, or any
//     human judgement about when a dark deal died — all of which were on the
//     table and are now moot.
//   • A prospect is CLOSED if ANY of their calls closed; else the most recent
//     decided outcome; else open.
//
// ── Honest scope note ─────────────────────────────────────────────────────
// On the current corpus this entity moves the rate by ~1 point (40% per-prospect
// vs 39% per-call) because almost every prospect has exactly one call so far.
// The DENOMINATOR REDEFINITION did the work (90% → 40%); this makes the number
// correct as volume grows, and gives 3d-2's merge review something to hang off.
//
// Pure and total. No I/O, never throws.

// ⚠ ONE definition of "synthetic", shared with every team surface. This file
// had no requires at all, so the import needed an explicit home — and without
// it `realCallsOnly` would have been an undefined identifier that `node -c`
// happily accepts and that only throws when the line runs. Exactly the defect
// that killed add-user.
const { ratedCallsOnly } = require('./dq-exclusion');
const { CHUNK } = require('./chunk');   // ⚠ the one `.in()` chunk size (③-6) — never a literal here
var { realCallsOnly } = require('./real-calls');

// Normalized grouping key. Two calls resolving to the same key attach to the
// same prospect automatically (exact match only — fuzzy joins are PROPOSALS for
// human review in 3d-2, never automatic).
//
// Returns null for an unusable name. That is load-bearing: a call whose name
// could not be resolved must get NO prospect rather than joining an "Unknown"
// bucket, which would merge every unidentified prospect into one row and wreck
// both the numerator and the denominator.
function nameKey(v) {
  if (typeof v !== 'string') return null;
  var k = v
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    // Hyphens/dashes are word SEPARATORS, not removable punctuation:
    // "Mark-Anthony" must key the same as "Mark Anthony", not "markanthony".
    .replace(/[-–—]/g, ' ')
    // Apostrophes and stops are presentational: "O'Brien" ≡ "OBrien".
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return k || null;
}

// Outcomes for ONE prospect, oldest → newest, → that prospect's state.
var DECIDED = { closed: 1, lost: 1 };

/* ⚠⚠ CLOSING % IS ON CALLS TAKEN, NOT CALLS BOOKED (Justin's ruling 2026-08-30).
   A prospect who never turned up had NO CONVERSATION TO CLOSE, so counting them
   against a rep is marking them down for something that never happened.
   ⚠ `no_show` and `disqualified` leave the denominator FOR THE SAME REASON —
   there was no closeable conversation — which is why one predicate covers both
   rather than two rules that can drift apart.
   ⚠ AND IT IS ALL-OR-NOTHING PER PROSPECT: a prospect is dropped only when EVERY
   one of their calls is a no-show or a DQ. Someone who no-showed once and then
   turned up is a real prospect with a real conversation. */
var NOT_A_CONVERSATION = { no_show: 1, disqualified: 1 };
function hadAConversation(outcomes) {
  var arr = Array.isArray(outcomes) ? outcomes : [];
  for (var i = 0; i < arr.length; i++) {
    if (!NOT_A_CONVERSATION[arr[i]]) return true;   // null/open counts — a call happened
  }
  return arr.length === 0;                          // no outcomes at all → keep (unknown, not absent)
}

function prospectOutcome(outcomes) {
  var arr = Array.isArray(outcomes) ? outcomes : [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === 'closed') return 'closed';   // ANY close wins the deal
  }
  for (var j = arr.length - 1; j >= 0; j--) {
    if (DECIDED[arr[j]]) return arr[j];         // most recent decided
  }
  return 'open';                                 // a real state, not a missing one
}

// The headline number. Returns counts alongside the percentage because the
// house rule is that rates always render with their raw counts
// ("12 of 37 prospects") — a bare percentage hides the sample size.
//
// pct is null (not 0) when there are no prospects: "no prospects yet" is not a
// 0% close rate, and rendering 0% would be a lie about performance.
function closeRate(prospects) {
  var all = Array.isArray(prospects) ? prospects : [];
  // ⚠ CALLS TAKEN, NOT BOOKED — see NOT_A_CONVERSATION above.
  var arr = all.filter(function (p) { return hadAConversation((p || {}).outcomes); });
  var closed = 0;
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i] || {};
    if (prospectOutcome(p.outcomes) === 'closed') closed++;
  }
  var total = arr.length;
  return {
    closed: closed,
    total: total,
    pct: total > 0 ? Math.round((100 * closed) / total) : null,
  };
}

// Roll a flat list of calls up into per-user prospect close rates.
// ⚠ CORRECTED 2026-08-30: this comment used to claim every close-rate surface
// routed through here. It did not — the manager graph (lib/rep-series.js) and the
// team gauge (routes/team.js) each computed their own, and the three agreed by
// luck rather than by construction. They now call closeRateForCalls below.
// The shared computation — every surface that shows a close rate routes through
// this, so the coaching tile, the team glance box and the team score list can
// never drift into three different definitions (which is what "closed/(closed+
// lost) — decided calls only" was, in three places, before 3d-3).
//
// calls: [{ id, user_id, prospect_id, call_date, outcome }] — prospect_id NULL
//        means unresolved, and those calls are EXCLUDED rather than bucketed
//        together (an "Unknown" bucket would merge every unidentified prospect
//        into one row and corrupt both halves of the rate).
// mergedInto: { losingProspectId: survivingProspectId } — applied so a merge
//        performed in the review actually moves the headline number.
//
// Returns { [user_id]: { closed, total, pct } }. Pure and total.
function rollupProspects(calls, mergedInto) {
  var arr = Array.isArray(calls) ? calls : [];
  var merged = mergedInto || {};
  var perUser = {};

  for (var i = 0; i < arr.length; i++) {
    var c = arr[i];
    if (!c || !c.user_id || !c.prospect_id) continue;
    var pid = merged[c.prospect_id] || c.prospect_id;
    var u = (perUser[c.user_id] = perUser[c.user_id] || {});
    var p = (u[pid] = u[pid] || []);
    p.push({ outcome: c.outcome, date: c.call_date });
  }

  var out = {};
  Object.keys(perUser).forEach(function (uid) {
    var prospects = Object.keys(perUser[uid]).map(function (pid) {
      var calls_ = perUser[uid][pid].slice().sort(function (a, b) {
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
      return { outcomes: calls_.map(function (x) { return x.outcome; }) };
    });
    out[uid] = closeRate(prospects);
  });
  return out;
}

// DB wrapper around rollupProspects. Never throws — a close-rate failure must
// degrade to "—" rather than break an analytics response.
/* ⚠⚠ ATTRIBUTION (Justin's ruling 2026-09-03, H706): A PROSPECT'S WINDOW IS THE DATE OF
   ITS FIRST BOOKED CALL. A close on a later call attributes to the booked call's date,
   flagged "follow-up close". So the window is applied to the prospect's ANCHOR — the
   earliest call that is not a follow-up (else the earliest call) — never to each call.
   A prospect booked in August and closed in September is closed IN AUGUST, and
   nowhere in September. Every surface that shows a closing rate reads THIS grouping.
   The read is therefore the rep's whole prospect history (paged, capped, `truncated`
   on the result), not the window: ~1,800 rows today, +36 a day. */
function anchorOf(calls_) {
  var booked = calls_.filter(function (c) { return c.call_kind !== 'follow_up'; });
  var pool = booked.length ? booked : calls_;
  var min = null;
  pool.forEach(function (c) { if (c.call_date && (min === null || c.call_date < min)) min = c.call_date; });
  return min;
}
function windowByAnchor(calls, fromIso, toIso) {
  var groups = {};
  (Array.isArray(calls) ? calls : []).forEach(function (c) {
    if (!c || !c.user_id || !c.prospect_id) return;
    var k = c.user_id + '|' + c.prospect_id;
    (groups[k] = groups[k] || []).push(c);
  });
  var keep = {};
  Object.keys(groups).forEach(function (k) {
    var a = anchorOf(groups[k]);
    if (a === null) return;
    if (fromIso && a < fromIso) return;
    if (toIso && a > toIso) return;
    keep[k] = true;
  });
  return (Array.isArray(calls) ? calls : []).filter(function (c) { return c && keep[c.user_id + '|' + c.prospect_id]; });
}
async function fetchProspectCloseRates(admin, userIds, fromIso, toIso) {
  try {
    var ids = Array.isArray(userIds) ? userIds : [userIds];
    if (!ids.length) return {};

    /* ⚠⚠ THE EXCLUSION IS ALSO THE "DETACH", AND NOTHING IS DESTROYED.
       Josh's venting call created a real prospect named after two colleagues,
       and it sits in this denominator now. The obvious fix — null the call's
       prospect_id on marking — is the WRONG one twice over: it loses the
       attachment so un-marking cannot restore it, and it would have to reason
       about whether the prospect has other calls before deciding to orphan it.

       ⚠ Filtering HERE achieves the same result reversibly and with no data
       change. rollupProspects groups calls BY prospect and skips any call that
       has none, so a prospect whose ONLY call is marked contributes zero calls
       and disappears from both numerator and denominator on its own. A prospect
       with OTHER calls keeps every one of them — only the marked call leaves,
       which is exactly the "must not orphan the rest" requirement, satisfied by
       construction rather than by a rule someone has to remember.
       ⚠ Un-marking puts the row straight back. No stored prior-attachment
       column, nothing to keep in sync.

       ⚠ `.not(col,'is',true)`, never `.eq(col,false)` — nullable column; see
       test/not-a-sales-call.test.js. */
    /* ⚠⚠ PAGED (2026-09-02, H683). This read carried a whole team's prospect-attached
       calls in ONE select — PostgREST returns 1,000 and stops SILENTLY. The Sober
       Living team stood at 947 in its 90-day window, growing 20.7 a day: from about
       5 September the closing rate on every team page would have been computed on a
       truncated set with no error, a wrong number rendered as a right one on the
       metric Justin rules from. Every page is fetched HERE before anything is
       computed, so no surface ever shows a partial rate; the read's row count and a
       `truncated` flag travel on the result (non-enumerable, so callers that iterate
       users never see a phantom rep) and team-analytics forwards them on its payload.
       Fix #6's shape (routes/kb.js), not a second approach. Pinned by
       test/close-rate-paged.test.js, which failed on the unpaged code. */
    var PE_PAGE = 1000, PE_MAX_PAGES = 25;
    var reads = { calls: 0, prospects: 0, truncated: false };
    var buildCalls = function () {
      /* H706: no date filter here — the window is applied to the prospect's ANCHOR below. */
      var q = admin.from('fathom_calls')
        .select('id, user_id, fathom_call_id, prospect_id, call_date, call_kind')
        .in('user_id', ids)
        .not('not_a_sales_call', 'is', true)
        .is('duplicate_of', null)
        .not('prospect_id', 'is', null);
      return q;
    };
    var calls = { data: [], error: null };
    for (var pg = 0; pg < PE_MAX_PAGES; pg++) {
      var page = await buildCalls().range(pg * PE_PAGE, pg * PE_PAGE + PE_PAGE - 1);
      if (page.error) { calls = page; break; }
      calls.data = calls.data.concat(page.data || []);
      if (!page.data || page.data.length < PE_PAGE) break;
      if (pg === PE_MAX_PAGES - 1) reads.truncated = true;
    }
    reads.calls = (calls.data || []).length;
    var withReads = function (out) { Object.defineProperty(out, '_reads', { value: reads, enumerable: false }); return out; };
    if (calls.error || !calls.data || !calls.data.length) return withReads({});

    /* ⚠⚠ SYNTHETIC EXCLUSION — AND IT NEEDS NO SECOND RULE FOR PROSPECTS.
       The close rate is computed from CALLS grouped by prospect_id, so
       filtering the calls is enough: a prospect whose only calls are synthetic
       contributes zero calls and drops out of BOTH numerator and denominator
       on its own — the same by-construction property the not-a-sales-call note
       above relies on.
       ⚠ A prospect-level rule was considered and REJECTED: the seeded rows
       carry a 'Seed %' display name, but that would be a THIRD convention, and
       'has no real call' would have dropped 39 of Josh's genuine prospects.
       ⚠ Unfiltered until 2026-08-24, which is why a demo account with ZERO
       calls still showed "13% closing rate, 3 of 24 prospects" directly under
       an honest "0 calls". */
    var realCalls = windowByAnchor(realCallsOnly(calls.data), fromIso, toIso);   // H706
    if (!realCalls.length) return withReads({});

    var byId = {};
    realCalls.forEach(function (c) { byId[c.id] = c; });

    // Outcomes come from call_analyses; only 'done' rows carry a real outcome.
    /* ⚠⚠ CHUNKED AT 100 — AN UNCHUNKED .in() PUT THE WHOLE BOARD'S CLOSE RATE
       AT ZERO, SILENTLY. PostgREST carries `.in()` in the URL, so one call per
       id-list means a URL that grows with the board. Measured on the live Sober
       Living board 2026-08-28, 600 call ids in a 30-day window:

         .in() with 100 ids -> 100 rows
         .in() with 300 ids -> 300 rows
         .in() with 600 ids -> TypeError: fetch failed   (URL ~22,199 chars)

       ⚠⚠ AND THE FAILURE WAS INVISIBLE: `if (an.error) return {}` swallowed it,
       so every rep card on the board read "0 prospects" and a null close rate
       while the database held 109-254 prospects each. Nothing errored on screen.
       It was reported as one rep's card being wrong; it was every card, on any
       board big enough to cross the URL limit — which is why it appeared only
       as the company grew. Every other `.in()` in this codebase already chunks
       at 100; this one did not. */
    var outcomeBy = {};
    var allIds = Object.keys(byId);
    for (var oi = 0; oi < allIds.length; oi += CHUNK) {
      var an = await admin.from('call_analyses')
        .select('fathom_call_id, outcome')
        .in('fathom_call_id', allIds.slice(oi, oi + CHUNK))
        .eq('status', 'done');
      /* ⚠ LOUD, NOT SILENT. Returning {} on error is still the safe answer — a
         wrong close rate is worse than none — but it must say so, or the next
         person sees zeros and looks at the data instead of the query. */
      if (an.error) {
        console.error('[prospect-entity] outcome lookup failed (' + allIds.length
          + ' calls, chunk at ' + oi + '): ' + an.error.message);
        return withReads({});
      }
      (an.data || []).forEach(function (a) { outcomeBy[a.fathom_call_id] = a.outcome; });
    }

    /* the merge map — paged for the same reason (886 rows for the same team, +36 a day) */
    var pr = { data: [], error: null };
    for (var pp = 0; pp < PE_MAX_PAGES; pp++) {
      var ppage = await admin.from('prospects').select('id, merged_into').in('user_id', ids).range(pp * PE_PAGE, pp * PE_PAGE + PE_PAGE - 1);
      if (ppage.error) { pr = ppage; break; }
      pr.data = pr.data.concat(ppage.data || []);
      if (!ppage.data || ppage.data.length < PE_PAGE) break;
      if (pp === PE_MAX_PAGES - 1) reads.truncated = true;
    }
    reads.prospects = (pr.data || []).length;
    var mergedInto = {};
    if (!pr.error) {
      (pr.data || []).forEach(function (p) { if (p.merged_into) mergedInto[p.id] = p.merged_into; });
    }

    var joined = realCalls
      .filter(function (c) { return Object.prototype.hasOwnProperty.call(outcomeBy, c.id); })
      .map(function (c) {
        return { id: c.id, user_id: c.user_id, prospect_id: c.prospect_id, call_date: c.call_date, outcome: outcomeBy[c.id] };
      });
    /* ⚠⚠ DISQUALIFIED CALLS LEAVE THE RATE HERE, AND THE SAME BY-CONSTRUCTION
       PROPERTY THE TWO NOTES ABOVE RELY ON DOES THE REST. A prospect whose only
       call is a DQ contributes zero calls and disappears from BOTH numerator and
       denominator; a prospect with other calls keeps every one of them.
       ⚠ Justin's ruling: a DQ'd prospect was never closeable, so leaving them in
       the denominator marks a rep down for a call that could not be won.
       ⚠⚠ THIS IS THE *RATE*, NOT THE COUNT. The call still counts in calls
       analyzed, still appears in the library, and still carries its score,
       coaching and moments — filtering it anywhere else would HIDE it, which is
       precisely the not_a_sales_call behaviour this deliberately is not. */
    var rated = ratedCallsOnly(joined);
    return withReads(rollupProspects(rated, mergedInto));
  } catch (err) {
    console.error('[prospect-entity] close-rate fetch failed: ' + ((err && err.message) || 'unknown'));
    return {};
  }
}

/**
 * ⚠⚠ THE ONE COMPUTATION. Give it calls, get the rate — this is what the tile,
 * the rep cards, the score list, the manager graph AND the team gauge all call,
 * so "closing %" cannot mean three things on three pages.
 *
 * calls: [{ id, user_id, prospect_id, outcome }]  → { closed, total, pct }
 * ⚠ THE WINDOW IS THE CALLER'S CONCERN AND THE DEFINITION IS NOT. The gauge is a
 * fixed 7 days and the graph follows the picker — that difference is legitimate
 * and each surface says which window it shows. What must never differ is THIS.
 */
function closeRateForCalls(calls, mergedInto) {
  var rolled = rollupProspects(Array.isArray(calls) ? calls : [], mergedInto || {});
  var all = [];
  Object.keys(rolled).forEach(function (uid) {
    var r = rolled[uid];
    all.push({ closed: r.closed, total: r.total });
  });
  var closed = 0, total = 0;
  all.forEach(function (r) { closed += r.closed; total += r.total; });
  return { closed: closed, total: total, pct: total > 0 ? Math.round((100 * closed) / total) : null };
}

module.exports = {
  closeRateForCalls: closeRateForCalls,
  windowByAnchor: windowByAnchor,   // H706 — the one attribution rule
  anchorOf: anchorOf,
  hadAConversation: hadAConversation,
  nameKey: nameKey,
  prospectOutcome: prospectOutcome,
  closeRate: closeRate,
  rollupProspects: rollupProspects,
  fetchProspectCloseRates: fetchProspectCloseRates,
};
