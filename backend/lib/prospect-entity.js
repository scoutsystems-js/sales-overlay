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
  var arr = Array.isArray(prospects) ? prospects : [];
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
// THE shared computation — every surface that shows a close rate routes through
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
    var cq = admin.from('fathom_calls')
      .select('id, user_id, prospect_id, call_date')
      .in('user_id', ids)
      .not('not_a_sales_call', 'is', true)
      .not('prospect_id', 'is', null);
    if (fromIso) cq = cq.gte('call_date', fromIso);
    if (toIso) cq = cq.lte('call_date', toIso);
    var calls = await cq;
    if (calls.error || !calls.data || !calls.data.length) return {};

    var byId = {};
    calls.data.forEach(function (c) { byId[c.id] = c; });

    // Outcomes come from call_analyses; only 'done' rows carry a real outcome.
    var an = await admin.from('call_analyses')
      .select('fathom_call_id, outcome')
      .in('fathom_call_id', Object.keys(byId))
      .eq('status', 'done');
    if (an.error) return {};
    var outcomeBy = {};
    (an.data || []).forEach(function (a) { outcomeBy[a.fathom_call_id] = a.outcome; });

    var pr = await admin.from('prospects').select('id, merged_into').in('user_id', ids);
    var mergedInto = {};
    if (!pr.error) {
      (pr.data || []).forEach(function (p) { if (p.merged_into) mergedInto[p.id] = p.merged_into; });
    }

    var joined = calls.data
      .filter(function (c) { return Object.prototype.hasOwnProperty.call(outcomeBy, c.id); })
      .map(function (c) {
        return { id: c.id, user_id: c.user_id, prospect_id: c.prospect_id, call_date: c.call_date, outcome: outcomeBy[c.id] };
      });
    return rollupProspects(joined, mergedInto);
  } catch (err) {
    console.error('[prospect-entity] close-rate fetch failed: ' + ((err && err.message) || 'unknown'));
    return {};
  }
}

module.exports = {
  nameKey: nameKey,
  prospectOutcome: prospectOutcome,
  closeRate: closeRate,
  rollupProspects: rollupProspects,
  fetchProspectCloseRates: fetchProspectCloseRates,
};
