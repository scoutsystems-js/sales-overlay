// lib/duplicate-calls.js — pair the SAME meeting recorded by two providers.
//
// ⚠⚠ TOLERANCES DERIVED FROM JOSH'S WHOLE CORPUS (2026-08-24), not chosen.
// 25 cross-provider candidates within 30 minutes, ranked by how much the two
// recordings OVERLAP as a fraction of the longer one:
//
//     99 99 99 99 99 98 98 98 98 98 97 97 96 96 95 95 93 92 92 86 78 72 71   <- genuine
//                                                                    42      <- ambiguous
//                                                                     0      <- KNOWN false pair
//
// There is an EMPTY BAND between 42% and 71%, so the threshold sits inside it
// rather than on a round number — the same discipline as MIN_CUE_GAP_SECONDS.
//
// ⚠⚠ WHY OVERLAP AND NOT DURATION DIFFERENCE. Zoom reports duration in WHOLE
// MINUTES (every Zoom value in the corpus is divisible by 60) while Fathom
// reports exact seconds, so a duration delta conflates rounding with a real
// difference. Worse, it is scale-blind: the known false pair differs by 2645s
// AND by 897% of the shorter call, but a 90s delta is fatal on a 4-minute call
// and irrelevant on a 90-minute one. Overlap answers the actual question —
// "were these two recordings of the same stretch of time?"
//
// ⚠⚠ THE FALSE POSITIVE IS FAR WORSE THAN THE FALSE NEGATIVE, and the rule is
// tuned that way. Merging two genuinely different back-to-back calls destroys a
// real call silently; missing a duplicate only leaves a count too high, which is
// visible and reversible. Two back-to-back calls do not overlap AT ALL, so they
// score ~0% and are rejected twice over — by the start gap and by the overlap.
//
// Pure and total. No I/O, never throws.

'use strict';

/* Measured genuine start gaps: 18–254s. The known false pair sits at 379s.
   300 is inside that empty band and also bounds Fathom's bot-join lag, which
   was separately measured at 92–467s for Zoom meetings. */
var MAX_START_GAP_SECONDS = 300;

/* The empty band is 42→71. 0.60 sits in it. */
var MIN_OVERLAP_RATIO = 0.60;

/* ⚠ WHICH COPY SURVIVES — A PREFERENCE, NOT A VERDICT ON A PROVIDER.
   Today Fathom wins because it carries a prospect name and a seekable clip
   link, and Zoom carries neither (its rows arrive titled "Josh's Personal
   Meeting Room"). Justin intends Zoom to REPLACE Fathom eventually, so this is
   an ordered list to be re-ordered — never "zoom is bad" baked into a branch. */
var SOURCE_PREFERENCE = ['fathom', 'zoom'];

function rank(source) {
  var i = SOURCE_PREFERENCE.indexOf(source);
  return i === -1 ? SOURCE_PREFERENCE.length : i;   // unknown sources lose, never crash
}

function startMs(c) {
  var t = Date.parse(c && c.call_date);
  return isNaN(t) ? null : t;
}

/** Seconds the two recordings share, as a fraction of the LONGER one. */
function overlapRatio(a, b) {
  var as = startMs(a), bs = startMs(b);
  var ad = Number(a && a.duration_seconds), bd = Number(b && b.duration_seconds);
  if (as === null || bs === null) return 0;
  if (!(ad > 0) || !(bd > 0)) return 0;      // a zero-length row cannot be matched on time
  var ae = as + ad * 1000, be = bs + bd * 1000;
  var ov = Math.min(ae, be) - Math.max(as, bs);
  if (ov <= 0) return 0;
  return (ov / 1000) / Math.max(ad, bd);
}

/**
 * Is this pair the same meeting recorded twice?
 * ⚠ SAME USER ONLY. Two closers on one meeting is not a duplicate — it is two
 * people's calls, and merging them would delete one closer's record.
 * ⚠ DIFFERENT SOURCES ONLY. Same-provider repeats are already prevented by the
 * unique key, so anything matching within one provider is a real second call.
 */
function isDuplicatePair(a, b) {
  if (!a || !b) return false;
  if (!a.user_id || a.user_id !== b.user_id) return false;
  if (!a.source || !b.source || a.source === b.source) return false;
  var as = startMs(a), bs = startMs(b);
  if (as === null || bs === null) return false;
  if (Math.abs(as - bs) / 1000 > MAX_START_GAP_SECONDS) return false;
  return overlapRatio(a, b) >= MIN_OVERLAP_RATIO;
}

/**
 * Given one user's calls, decide which rows to suppress.
 * returns [{ id, duplicate_of }] — the row to mark, and the row it duplicates.
 *
 * ⚠ ONE FATHOM CALL CAN HAVE TWO ZOOM CANDIDATES (it happens in the live data:
 * one 5-minute Fathom call matched both a 6-minute and a 49-minute Zoom row).
 * So each row takes its BEST match by overlap, and a row already suppressed is
 * never reused as a target — otherwise a chain could suppress a survivor.
 */
function planDuplicates(calls) {
  var arr = (Array.isArray(calls) ? calls : []).filter(function (c) { return c && c.id; });
  var suppressed = {};
  var plan = [];

  // Best-first, so a strong pair claims its rows before a weaker one can.
  var pairs = [];
  for (var i = 0; i < arr.length; i++) {
    for (var j = i + 1; j < arr.length; j++) {
      if (!isDuplicatePair(arr[i], arr[j])) continue;
      pairs.push({ a: arr[i], b: arr[j], ov: overlapRatio(arr[i], arr[j]) });
    }
  }
  pairs.sort(function (x, y) { return y.ov - x.ov; });

  pairs.forEach(function (p) {
    if (suppressed[p.a.id] || suppressed[p.b.id]) return;
    var keep = rank(p.a.source) <= rank(p.b.source) ? p.a : p.b;
    var drop = keep === p.a ? p.b : p.a;
    suppressed[drop.id] = true;
    plan.push({ id: drop.id, duplicate_of: keep.id, source_dropped: drop.source, overlap: p.ov });
  });
  return plan;
}

module.exports = {
  MAX_START_GAP_SECONDS: MAX_START_GAP_SECONDS,
  MIN_OVERLAP_RATIO: MIN_OVERLAP_RATIO,
  SOURCE_PREFERENCE: SOURCE_PREFERENCE,
  overlapRatio: overlapRatio,
  isDuplicatePair: isDuplicatePair,
  planDuplicates: planDuplicates,
};

/* ── the DB side ───────────────────────────────────────────────────────────
   ⚠ Everything above is pure and is where the rule lives. This is the only
   part that touches the database, kept here so the rule and its application
   cannot drift into two files. */

/**
 * Mark this user's cross-provider duplicates. Idempotent — already-marked rows
 * are excluded from the candidate set, so re-running suppresses nothing new.
 *
 * ⚠ NEVER THROWS. It runs after a sync, and a suppression failure must not turn
 * a successful sync into a failed one — the same degrade rule fetchSellingContext
 * and the KB harvest follow. Worst case the counts stay inflated, which is the
 * state we were already in.
 */
async function applyDuplicateSuppression(admin, userId) {
  try {
    var q = await admin.from('fathom_calls')
      .select('id, user_id, source, call_date, duration_seconds')
      .eq('user_id', userId)
      .is('duplicate_of', null);
    if (q.error || !q.data || q.data.length < 2) return { marked: 0 };

    var plan = planDuplicates(q.data);
    if (!plan.length) return { marked: 0 };

    var marked = 0;
    for (var i = 0; i < plan.length; i++) {
      var up = await admin.from('fathom_calls')
        .update({ duplicate_of: plan[i].duplicate_of })
        .eq('id', plan[i].id)
        .is('duplicate_of', null);          // ⚠ never re-mark a row another run claimed
      if (!up.error) marked++;
    }
    if (marked) {
      console.log('[dupes] suppressed ' + marked + ' cross-provider duplicate(s) for user ' + userId);
    }
    return { marked: marked };
  } catch (err) {
    console.error('[dupes] suppression failed for user ' + userId + ': ' + ((err && err.message) || 'unknown'));
    return { marked: 0 };
  }
}

module.exports.applyDuplicateSuppression = applyDuplicateSuppression;
