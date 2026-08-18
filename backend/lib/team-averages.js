/**
 * THE TEAM AVERAGES PANEL — three gauges, team-wide, on a fixed last-7-days
 * window. Replaces the per-rep speedometers (Josh's note, ruled 2026-08-18).
 *
 * ⚠ WHY IT REPLACED THEM, so nobody rebuilds the old shape: a dial PER REP does
 * not survive 20+ reps. At that size a manager's question is not "what is
 * everyone's number", it is "how many are clearing the bar" — which is why the
 * count sentence beneath each gauge is the load-bearing part of this panel and
 * the needle is the summary.
 *
 * Pure maths + copy. No I/O, no model call. The route (GET /team/averages) owns
 * the querying and the window; this module owns every number and every threshold.
 */

// ⚠ THE FLOOR IS THE EXISTING ONE. "Is this enough to judge?" must not have two
// answers, so this is rep-card-metrics' MIN_CATEGORY_OBJECTIONS rather than a
// new constant — the same reasoning that made the old panel's MIN_PROSPECTS
// mirror it. It applies to prospects, objections AND calls: the unit differs,
// the question does not.
const { MIN_CATEGORY_OBJECTIONS } = require('./rep-card-metrics');
const MIN_SAMPLE = MIN_CATEGORY_OBJECTIONS;

// ── the ruled numbers ─────────────────────────────────────────────────────
// Closing and objection targets carry over unchanged from the rep dials.
const CLOSING_TARGET_PCT = 25;
const CLOSING_SCALE_MAX = 50;

// ⚠ 35 IS STILL A WORKING BAR, NOT A SETTLED STANDARD (Justin, "for now",
// 2026-08-17). It is set where the dial can discriminate today and is meant to
// be RAISED as reps cluster at the top. His stated standard is 50, which put
// every real needle in red. Do not read 35 as the definition of good handling.
const OBJECTION_TARGET_PCT = 35;
const OBJECTION_SCALE_MAX = 100;

/**
 * ⚠⚠ DIRECTION IS A DECLARED PROPERTY OF EACH METRIC, NEVER A COMPARISON WRITTEN
 * INLINE. Two of these three want a number to go UP; the third wants it to stay
 * DOWN. Writing `value >= target` at each call site means a fourth metric added
 * by copying its neighbour silently inherits the wrong sense — and an inverted
 * band throws nothing, renders cleanly, and states the opposite of the truth.
 *
 * ⚠ THAT IS NOT HYPOTHETICAL. The first build of this panel treated 60 minutes
 * as a floor: the dial climbed toward it and the caption read "0 of 4 reps at or
 * above target", telling a manager the team was FAILING at a 46-minute average
 * when 46 minutes is good. It was reviewed and approved as correct, because the
 * NUMBER was right — only its meaning was upside down. Corrected 2026-08-18.
 */
const HIGHER_IS_BETTER = 'higher_is_better';
const LOWER_IS_BETTER = 'lower_is_better';

// ⚠ 60 MINUTES IS A CEILING, NOT A TARGET (Justin, 2026-08-18): "60min is the
// max, anything less than that is good, especially if it closed. On average
// sales calls are 30-60min; over that and you either have a long onboarding or
// the reps talk too much." 90 IS THE SCALE, AND IT WAS DERIVED — see
// test/team-averages.test.js for the measurement. Short version: a TEAM AVERAGE
// is far tighter than the calls it averages (live rep-weeks span 40.4-64.0 min),
// so the scale must be chosen against the average's range, not the call spread.
// 0-90 puts that band at 45-71% of the arc; 0-120 buries it in the lower third
// and 0-60 makes the target unreachable. 90 is p90 of individual real calls
// (89.7 min), so full scale is where the top decile begins rather than a round
// number picked for looks.
const CALLTIME_TARGET_MIN = 60;
const CALLTIME_SCALE_MAX = 90;

// Fraction of target at which yellow begins. Carried over unchanged.
const MID_BAND_FRACTION = 0.6;

// ⚠ 240°, and SEGMENTED — Justin's chosen design. Discrete blocks that light as
// the value climbs are what read as instrumentation; a smooth arc reads as a
// progress bar bent into a curve, which is what made the old dials "cartoony".
const SWEEP_DEG = 240;
const SEGMENT_COUNT = 40;
const SEGMENT_GAP_DEG = 1.4;   // the dark hairline between blocks

const WINDOW_DAYS = 7;

const METRIC_ORDER = ['closing', 'objections', 'calltime'];

const METRICS = {
  closing: {
    key: 'closing', label: 'Closing Rate',
    target: CLOSING_TARGET_PCT, scale: CLOSING_SCALE_MAX,
    unit: '%', unitName: 'prospect', numeratorName: 'closed',
    direction: HIGHER_IS_BETTER,
    targetCaption: 'Target ' + CLOSING_TARGET_PCT + '%',
    thresholdPhrase: 'at or above target',
  },
  objections: {
    key: 'objections', label: 'Objection Handling',
    target: OBJECTION_TARGET_PCT, scale: OBJECTION_SCALE_MAX,
    unit: '%', unitName: 'objection', numeratorName: 'handled',
    direction: HIGHER_IS_BETTER,
    targetCaption: 'Target ' + OBJECTION_TARGET_PCT + '%',
    thresholdPhrase: 'at or above target',
  },
  calltime: {
    key: 'calltime', label: 'Avg Call Time',
    target: CALLTIME_TARGET_MIN, scale: CALLTIME_SCALE_MAX,
    unit: 'min', unitName: 'call', numeratorName: null,
    // ⚠ THE INVERTED ONE. Under 60 is good.
    direction: LOWER_IS_BETTER,
    // "Max", not "Target" — the caption has to say which way it points, or the
    // dial is the only thing carrying that and a screenshot loses it.
    targetCaption: 'Max ' + CALLTIME_TARGET_MIN + ' min',
    thresholdPhrase: 'at or below ' + CALLTIME_TARGET_MIN + ' min',
  },
};

function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : null; }
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

/**
 * ⚠ THE WINDOW IS COMPUTED HERE AND TAKES NO CALLER INPUT — that is the whole
 * reason /team/averages is its own route rather than a widening of
 * /team/rep-series. "The date picker does not drive this panel" is now a
 * structural property of the endpoint instead of a convention the client is
 * trusted to honour. There is deliberately no `days` parameter to pass.
 */
function fixedWindow(now) {
  var to = (now instanceof Date && !isNaN(now)) ? now : new Date();
  var from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString(), days: WINDOW_DAYS };
}

/**
 * Semantic only. The categorical rep ramp is deliberately absent from this panel
 * and accent-palette.test.js fails if the two ever mix.
 *
 * ⚠ THE TWO DIRECTIONS ARE MIRROR IMAGES, and stating it that way is what keeps
 * them from being tuned apart:
 *   higher-is-better  good >= T   ·  mid [0.6T, T)   ·  bad < 0.6T
 *   lower-is-better   good <= C   ·  mid (C, 1.4C]   ·  bad > 1.4C
 * The mid band is 0.4 x the threshold wide in both cases — just on the other
 * side of it.
 *
 * ⚠ WHY 1.4C AND NOT C / 0.6. The obvious mirror of "60% of target" is
 * C / 0.6 = 100 minutes, which is OFF THE 0-90 SCALE — so "bad" could never
 * render and a 95-minute team average would still read as a warning. An
 * unreachable band is the same defect as a one-sided guard.
 */
function band(value, target, direction) {
  var v = num(value);
  if (v === null) return null;
  if (direction === LOWER_IS_BETTER) {
    if (v <= target) return 'good';
    if (v <= target * (2 - MID_BAND_FRACTION)) return 'mid';
    return 'bad';
  }
  if (v >= target) return 'good';
  if (v >= target * MID_BAND_FRACTION) return 'mid';
  return 'bad';
}

// Does one value clear its metric's bar? The ONLY place the comparison is
// written, so "clearing the bar" cannot mean two different things on one page.
function meetsThreshold(value, target, direction) {
  var v = num(value);
  if (v === null) return false;
  return (direction === LOWER_IS_BETTER) ? (v <= target) : (v >= target);
}

// Where a value sits on its own scale, 0..1. CLAMPED: an over-scale value parks
// at the end stop rather than sweeping past it, which would read as a LOWER
// number than it is.
function valueFraction(value, scale) {
  var v = num(value); if (v === null) v = 0;
  var s = (scale > 0) ? scale : 100;
  return Math.max(0, Math.min(1, v / s));
}

// The 40 discrete blocks, in degrees, zero at -SWEEP/2.
function segments() {
  var out = [];
  var step = SWEEP_DEG / SEGMENT_COUNT;
  for (var i = 0; i < SEGMENT_COUNT; i++) {
    var from = -(SWEEP_DEG / 2) + i * step;
    out.push({ index: i, from: from, to: from + step - SEGMENT_GAP_DEG });
  }
  // The last block ends exactly at the end stop — the gap is a separator between
  // blocks, and a trailing one would make the arc stop short of its own scale.
  out[out.length - 1].to = SWEEP_DEG / 2;
  return out;
}

/**
 * How many blocks light. ⚠ ANY VALUE ABOVE ZERO LIGHTS AT LEAST ONE: rounding
 * 0.4% of a 0-100 dial down to zero blocks would render an EMPTY dial for a
 * non-zero number, which is indistinguishable from having no data at all. A
 * true zero still renders empty, because that is what a zero is.
 */
function litCount(value, scale) {
  var v = num(value);
  if (v === null || v <= 0) return 0;
  var n = Math.round(valueFraction(v, scale) * SEGMENT_COUNT);
  return Math.max(1, Math.min(SEGMENT_COUNT, n));
}

/**
 * ⚠ POOL THE COUNTS, NEVER AVERAGE THE RATES. The counts printed beneath each
 * gauge are the pooled ones (house rule: a rate always renders with its raw
 * counts), so a mean-of-per-rep-rates would put a different number on screen
 * from the counts sitting under it. Measured on the live team: pooled 18/72 =
 * 25%, mean-of-rates = 23.7%.
 *
 * ⚠ BELOW THE FLOOR THE VALUE IS WITHHELD, NOT ZEROED. A dial reading 0% claims
 * the team closed nothing; "only 2 prospects" says the window is too thin to
 * judge. Those are different statements and only one of them is true.
 */
function poolRate(reps, metricKey) {
  var m = METRICS[metricKey] || METRICS.closing;
  var list = Array.isArray(reps) ? reps : [];
  var numerator = 0, total = 0;
  list.forEach(function (r) {
    var d = r && r[metricKey];
    if (!d) return;
    numerator += num(d.numerator) || 0;
    total += num(d.total) || 0;
  });
  var enough = total >= MIN_SAMPLE;
  return {
    numerator: numerator, total: total, enough: enough,
    value: enough ? Math.round((numerator / total) * 100) : null,
    reason: enough ? null
      : (total === 0 ? ('no ' + m.unitName + 's in the last ' + WINDOW_DAYS + ' days')
                     : ('only ' + plural(total, m.unitName) + ' in the last ' + WINDOW_DAYS + ' days')),
  };
}

// Avg call time, CALL-WEIGHTED — every call counts once, which is the plain
// reading of "average call time" and matches the raw call count shown beneath.
// Mean-of-rep-averages would give 43.7 against the true 46.0 on live data.
function poolDuration(reps) {
  var list = Array.isArray(reps) ? reps : [];
  var seconds = 0, calls = 0;
  list.forEach(function (r) {
    var d = r && r.calltime;
    if (!d) return;
    seconds += num(d.seconds) || 0;
    calls += num(d.calls) || 0;
  });
  var enough = calls >= MIN_SAMPLE;
  return {
    numerator: null, total: calls, enough: enough,
    value: enough ? Math.round((seconds / calls / 60) * 10) / 10 : null,
    reason: enough ? null
      : (calls === 0 ? ('no calls in the last ' + WINDOW_DAYS + ' days')
                     : ('only ' + plural(calls, 'call') + ' in the last ' + WINDOW_DAYS + ' days')),
  };
}

// One rep's value for a metric, or null when they are below the floor.
function repValue(rep, metricKey) {
  var d = rep && rep[metricKey];
  if (!d) return null;
  if (metricKey === 'calltime') {
    var calls = num(d.calls) || 0;
    if (calls < MIN_SAMPLE) return null;
    return (num(d.seconds) || 0) / calls / 60;
  }
  var total = num(d.total) || 0;
  if (total < MIN_SAMPLE) return null;
  return ((num(d.numerator) || 0) / total) * 100;
}

/**
 * ⚠⚠ THREE GROUPS, NOT TWO (ruling 2026-08-18, the same shape as the
 * closed/not-closed filter). A rep with 2 calls is UNMEASURED, not failing —
 * counting them as below target makes a quiet week look like a bad rep.
 *
 * `measured + unmeasured === total` by construction, so the sentence beneath the
 * gauge is an ACCOUNTING a manager can add up rather than a caveat they have to
 * take on trust. That property is asserted in the test, not just intended.
 */
function repCounts(reps, metricKey) {
  var list = Array.isArray(reps) ? reps : [];
  var m = METRICS[metricKey] || METRICS.closing;
  var at = 0, measured = 0;
  list.forEach(function (r) {
    var v = repValue(r, metricKey);
    if (v === null) return;
    measured++;
    // ⚠ Direction comes from the METRIC, not from a `>=` written here. On a
    // ceiling metric this counts reps who stay UNDER the bar.
    if (meetsThreshold(v, m.target, m.direction)) at++;
  });
  // `meeting` — deliberately NOT `at_or_above`, which was the old name and was
  // a lie on a ceiling metric. A field name that states one direction cannot
  // hold both, and renaming it is what forces every reader to be re-checked.
  return { meeting: at, measured: measured, unmeasured: list.length - measured, total: list.length };
}

/**
 * The sentence that makes the panel scale past 20 reps. Says the unmeasured
 * group IN WORDS rather than quietly dropping it from the denominator.
 *
 * ⚠ THE PHRASE COMES FROM THE METRIC. "at or above target" on a ceiling metric
 * reads as a failure when the team is doing well — which is exactly what shipped
 * and was approved before the direction was corrected.
 */
function countSentence(c, metricKey) {
  var m = METRICS[metricKey] || METRICS.closing;
  if (!c || !c.total) return 'no reps in the last ' + WINDOW_DAYS + ' days';
  if (!c.measured) return 'no reps with enough calls to measure yet';
  var s = c.meeting + ' of ' + c.measured + ' rep' + (c.measured === 1 ? '' : 's') + ' ' + m.thresholdPhrase;
  if (c.unmeasured > 0) s += ' · ' + c.unmeasured + ' not enough calls';
  return s;
}

module.exports = {
  HIGHER_IS_BETTER: HIGHER_IS_BETTER,
  LOWER_IS_BETTER: LOWER_IS_BETTER,
  meetsThreshold: meetsThreshold,
  MIN_SAMPLE: MIN_SAMPLE,
  WINDOW_DAYS: WINDOW_DAYS,
  SWEEP_DEG: SWEEP_DEG,
  SEGMENT_COUNT: SEGMENT_COUNT,
  SEGMENT_GAP_DEG: SEGMENT_GAP_DEG,
  MID_BAND_FRACTION: MID_BAND_FRACTION,
  CLOSING_TARGET_PCT: CLOSING_TARGET_PCT,
  OBJECTION_TARGET_PCT: OBJECTION_TARGET_PCT,
  CALLTIME_TARGET_MIN: CALLTIME_TARGET_MIN,
  CALLTIME_SCALE_MAX: CALLTIME_SCALE_MAX,
  METRICS: METRICS,
  METRIC_ORDER: METRIC_ORDER,
  fixedWindow: fixedWindow,
  band: band,
  valueFraction: valueFraction,
  segments: segments,
  litCount: litCount,
  poolRate: poolRate,
  poolDuration: poolDuration,
  repValue: repValue,
  repCounts: repCounts,
  countSentence: countSentence,
};
