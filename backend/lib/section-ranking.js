/**
 * 12a — WHICH PART OF THE SALES PROCESS NEEDS WORK.
 *
 * Justin: "I just wanna know what part of the ENTIRE sales process needs work,
 * not just objections." Five sections, ranked worst first, with the gap to the
 * next one. Pure arithmetic — no model call, no I/O.
 *
 * ⚠ SCOPE: this is the REP PAGE. The team view KEEPS its objection-bucket
 * needs-work — Josh called that view "perfect" and asked for it to be surfaced
 * there. It answers a different question and is NOT being replaced.
 *
 * ⚠⚠ CLOSE IS READ FROM close_score_earned. Migration 027 forces the DISPLAYED
 * close score to 100 on closed calls. Measured on Josh's 153 analysed calls:
 *      earned    57  → rank 3 of 5
 *      displayed 65  → rank 4 of 5
 * ⚠ QUOTE THE EIGHT POINTS, NOT THE RANK. This was being described as "displayed
 * makes close 2nd BEST, earned makes it 2nd WORST" — an overstatement, because
 * pitch and objection also sit at ~65, so the displaced close lands among them
 * rather than at the far end. Overstating a real effect is its own kind of wrong:
 * it invites someone to check, find a one-position shift, and dismiss the whole
 * warning. The EIGHT-POINT score swing is the substance — it is the difference
 * between close reading as level with `intro` and close reading as level with the
 * two strongest sections.
 * Reading the wrong column throws nothing and looks entirely plausible.
 * `sectionStatsFromAnalyses` below is the only supported way to build the input,
 * precisely so the column choice is made once.
 *
 * ⚠ THE "LEVEL" GATE. Two sections whose means are closer than the noise in
 * those means must be reported as LEVEL, not ranked confidently. It is derived
 * from the standard error of each mean rather than hard-coded, because the same
 * 4-point gap is real on 150 calls and meaningless on 12 — a fixed threshold
 * would be wrong at one end or the other.
 *
 * It is not a theoretical concern. On Josh's real 30-day data it fires TWICE:
 *      intro 57.2 (n=149)  vs  close     57.2 (n=136)  → gap 0.0
 *      pitch 64.5 (n=140)  vs  objection 64.6 (n=127)  → gap 0.1
 * Without it the card would name a 2nd-worst section off a 0.0-point difference
 * and flip its answer on the next call analysed.
 */

// The order of the sales process, for stable tie-breaking and for display.
const SECTION_ORDER = ['intro', 'discovery', 'pitch', 'objection', 'close'];

const LABELS = {
  intro: 'Intro', discovery: 'Discovery', pitch: 'Pitch',
  objection: 'Objection Handling', close: 'Close',
};

// ⚠ The SAME floor team-needs-work uses for "enough calls to model at all".
// One question, one answer.
const { _MIN_ANALYZED } = require('./team-needs-work');
const MIN_CALLS_TO_RANK = _MIN_ANALYZED;

// 95%. Two means are "level" when their gap falls inside this many standard
// errors of the difference.
//
// ⚠⚠ WHY THIS IS DERIVED AND NOT A CONSTANT NUMBER OF POINTS — this is the
// reasoning, not just the formula. A fixed threshold is wrong at one end or the
// other: the same 4-point gap is a real difference on 150 calls and is noise on
// 12. Deriving it from each section's own standard error means the behaviour
// scales the right way — FEWER CALLS PRODUCE MORE "LEVEL" VERDICTS, NOT FEWER.
// That is what makes the card honest: a rep three weeks in sees it decline to
// split hairs, while Josh on 150 calls sees it commit.
//
// On Josh's live data the threshold lands at roughly 3.3–4.4 points depending on
// the pair, because it also tracks each section's spread — objection handling has
// sd 8.6 against close's 20.5, so objection separates on a smaller gap than close
// ever could. A single hard-coded number could not express that.
const CONFIDENCE_Z = 1.96;

// ⚠ close comes from close_score_earned and nowhere else. This function exists
// so that decision is made ONCE rather than at every caller.
const COLUMN = {
  intro: 'intro_score', discovery: 'discovery_score', pitch: 'pitch_score',
  objection: 'objection_score', close: 'close_score_earned',
};

function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : null; }

// rows: call_analyses rows. Returns { section: {mean, n, sd} }.
// A null score is SKIPPED, never counted as zero — a missing grade is absence,
// not a failure, and averaging it as 0 would invent a weakness.
function sectionStatsFromAnalyses(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var out = {};
  SECTION_ORDER.forEach(function (key) {
    var vals = [];
    list.forEach(function (r) {
      if (!r) return;
      var v = num(r[COLUMN[key]]);
      if (v !== null) vals.push(v);
    });
    var n = vals.length;
    var mean = n ? vals.reduce(function (a, b) { return a + b; }, 0) / n : null;
    var sd = null;
    if (n > 1) {
      var ss = vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0);
      sd = Math.sqrt(ss / (n - 1));
    }
    out[key] = { mean: mean, n: n, sd: sd };
  });
  return out;
}

function seOfMean(s) {
  if (!s || !s.n || s.n < 2 || typeof s.sd !== 'number' || !isFinite(s.sd)) return null;
  return s.sd / Math.sqrt(s.n);
}

// Are these two means distinguishable? Null SE (n<2) → treat as NOT
// distinguishable, which is the conservative direction: with no spread estimate
// we decline to rank rather than ranking on nothing.
function areLevel(a, b) {
  var gap = Math.abs((a.mean || 0) - (b.mean || 0));
  var sa = seOfMean(a), sb = seOfMean(b);
  if (sa === null || sb === null) return true;
  var seDiff = Math.sqrt(sa * sa + sb * sb);
  return gap < CONFIDENCE_Z * seDiff;
}

function round1(x) { return Math.round(x * 10) / 10; }

/**
 * sections: { intro: {mean, n, sd}, ... }
 * Returns all five, worst first, with unranked (too-thin) ones last.
 *
 * ⚠ AN UNRANKED SECTION HOLDS NO POSITION. A section with 3 calls and a low
 * mean must not lead the card — "we cannot say yet" and "this is your weakest
 * area" are different claims and only one of them is supported.
 */
function rankSections(sections) {
  var src = (sections && typeof sections === 'object') ? sections : {};
  var all = SECTION_ORDER.map(function (key) {
    var s = src[key] || {};
    var mean = num(s.mean), n = (typeof s.n === 'number' && isFinite(s.n)) ? s.n : 0;
    var enough = mean !== null && n >= MIN_CALLS_TO_RANK;
    return {
      section: key,
      label: LABELS[key],
      mean: mean,
      score: mean === null ? null : Math.round(mean),
      n: n,
      sd: num(s.sd),
      enough: enough,
      rank: null,
      gapToNext: null,
      levelWithNext: false,
      reason: enough ? null
        : (n === 0 ? 'no graded calls in this period'
                   : 'only ' + n + ' call' + (n === 1 ? '' : 's') + ' graded in this period'),
    };
  });

  var ranked = all.filter(function (x) { return x.enough; })
    // Worst first. Ties fall back to process order so the card cannot reshuffle
    // between loads on identical data.
    .sort(function (a, b) {
      if (a.mean !== b.mean) return a.mean - b.mean;
      return SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    });

  ranked.forEach(function (x, i) {
    x.rank = i + 1;
    var next = ranked[i + 1];
    if (next) {
      x.gapToNext = round1(next.mean - x.mean);
      x.levelWithNext = areLevel(x, next);
      x.nextLabel = next.label;
    }
  });

  var unranked = all.filter(function (x) { return !x.enough; })
    .sort(function (a, b) { return SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section); });
  return ranked.concat(unranked);
}

/**
 * Human copy for a position, worst-first. "ranked 3 of 5" never told anyone which
 * end was good — a number alone is ambiguous in both directions, and the old
 * drilldown rendered exactly that while meaning the OPPOSITE of this module.
 */
function rankLabel(rank, total) {
  if (!rank || !total) return null;
  if (rank === 1) return 'Weakest of ' + total;
  if (rank === total) return 'Strongest of ' + total;
  var ord = rank === 2 ? '2nd' : (rank === 3 ? '3rd' : rank + 'th');
  return ord + ' weakest of ' + total;
}

module.exports = {
  SECTION_ORDER: SECTION_ORDER,
  rankLabel: rankLabel,
  LABELS: LABELS,
  COLUMN: COLUMN,
  MIN_CALLS_TO_RANK: MIN_CALLS_TO_RANK,
  CONFIDENCE_Z: CONFIDENCE_Z,
  sectionStatsFromAnalyses: sectionStatsFromAnalyses,
  rankSections: rankSections,
  areLevel: areLevel,
  seOfMean: seOfMean,
};
