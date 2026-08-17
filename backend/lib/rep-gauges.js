/**
 * The manager speedometer panel — pure maths (Justin's spec, 2026-08-17).
 *
 * One semicircular dial per rep, on a FIXED last-7-days window that the date
 * picker does NOT control. Two metrics, selector on the left.
 *
 * ⚠ THE NEEDLE IS A FIXED RED POINTER AND MEANS NOTHING. Justin: it is the
 * pointer on a car gauge. The BAND it points at carries the meaning — green at
 * or above target, yellow from 60% of target up to it, red below. Colouring the
 * needle by the band would say the same thing twice and make a red needle on a
 * green dial look like an error.
 *
 * ⚠ TARGETS ARE ABSOLUTE, not relative to the team. They are Justin's "bare
 * minimum", and each is ONE NAMED CONSTANT so changing a target is a one-line
 * change rather than a hunt through render code.
 *
 * ⚠ MEASURED AGAINST LIVE DATA BEFORE SHIPPING, and it decided the target: under
 * the handled-includes-closed ruling the platform's best 30-day objection rate is
 * 29.1% and Josh's is 21.3%. At a 50% target the red/yellow boundary is 30, so
 * EVERY real needle sat in red. Justin ruled 35 "for now" from the screenshots —
 * a WORKING BAR to raise later, not the settled definition of good.
 */

// ── the ruled numbers ─────────────────────────────────────────────────────
// ⚠ 35 IS A WORKING BAR, NOT A SETTLED STANDARD. Justin ruled it "for now":
// it is set where the dial can actually discriminate today, and is meant to be
// RAISED once reps cluster at the top. His stated standard is 50 — the bare
// minimum a closer should hit — and 50 put every real needle in red (Josh 21.3%
// over 30 days, platform best 29.1%, against a red/yellow boundary of 30), which
// teaches nothing. Do NOT read 35 as the definition of good handling.
const OBJECTION_TARGET_PCT = 35;   // ← the one line to change
const OBJECTION_SCALE_MAX = 100;
const CLOSING_TARGET_PCT = 25;
const CLOSING_SCALE_MAX = 50;

// ⚠ EXISTING thresholds, not new ones. MIN_OBJECTIONS is rep-card-metrics'
// MIN_CATEGORY_OBJECTIONS (and team-needs-work's MIN_BUCKET) — "is this enough
// objections to judge?" must not have two answers. MIN_PROSPECTS mirrors it
// because it is the same question about a different unit; no prospect-volume
// threshold existed anywhere before, and inventing a different number would have
// created exactly the second answer those constants exist to prevent.
const { MIN_CATEGORY_OBJECTIONS } = require('./rep-card-metrics');
const MIN_OBJECTIONS = MIN_CATEGORY_OBJECTIONS;
const MIN_PROSPECTS = MIN_CATEGORY_OBJECTIONS;

// Fraction of target at which yellow begins.
const MID_BAND_FRACTION = 0.6;

// ⚠ 240°, NOT 180° (Justin, 2026-08-17: the 180° version "looks too cartoony").
// A real instrument sweeps from lower-left to lower-right, which is why the ends
// sit BELOW the horizontal — the extra 60° is what makes it read as a dial
// rather than as a progress bar bent into a semicircle.
const SWEEP_DEG = 240;
// Ticks every 2.5% of scale (41 of them) with a labelled major every 20% —
// fine and frequent, the way an instrument face is.
const TICK_STEP_PCT = 2.5;
const MAJOR_EVERY_PCT = 20;

const METRICS = {
  objections: { key: 'objections', label: 'Objection handling', target: OBJECTION_TARGET_PCT, scale: OBJECTION_SCALE_MAX, axis: 'Handle rate' },
  closing: { key: 'closing', label: 'Closing rate', target: CLOSING_TARGET_PCT, scale: CLOSING_SCALE_MAX, axis: 'Closing rate' },
};

// Semantic only — the categorical rep ramp is deliberately absent from this
// panel, and accent-palette.test.js fails if the two ever mix.
function band(rate, target) {
  if (typeof rate !== 'number' || !isFinite(rate)) return null;
  if (rate >= target) return 'good';
  if (rate >= target * MID_BAND_FRACTION) return 'mid';
  return 'bad';
}

// Zero at -SWEEP/2, full scale at +SWEEP/2 — so a 240° dial runs -120°..+120°.
// CLAMPED: an over-scale value parks at the end stop rather than sweeping past
// it, which would read as a LOWER number than it is.
function needleAngle(value, scale) {
  var v = (typeof value === 'number' && isFinite(value)) ? value : 0;
  var s = (scale > 0) ? scale : 100;
  var f = Math.max(0, Math.min(1, v / s));
  return -(SWEEP_DEG / 2) + f * SWEEP_DEG;
}

// Every TICK_STEP_PCT of scale — 41 fine ticks — with a labelled major every
// MAJOR_EVERY_PCT. Both dials carry the same tick count so they read alike; the
// 0–50 dial's labels run 0/10/20/30/40/50, honest about its own scale rather
// than borrowing the 0–100 dial's numbers.
function ticks(scale) {
  var s = (scale > 0) ? scale : 100;
  var n = Math.round(100 / TICK_STEP_PCT);
  var majorEvery = Math.round(MAJOR_EVERY_PCT / TICK_STEP_PCT);
  var out = [];
  for (var i = 0; i <= n; i++) {
    var value = (s * i) / n;
    out.push({ value: value, major: (i % majorEvery === 0), angle: needleAngle(value, s) });
  }
  return out;
}

function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

// ⚠ SUM THE COUNTS, NEVER AVERAGE THE RATES. The series arrives in daily
// buckets; a mean of daily percentages weights a 1-objection day the same as a
// 9-objection day. Summing numerator and denominator is the same arithmetic a
// single-window query would do, which is why no second definition is introduced.
//
// A prospect is attributed to the day of their FIRST call, so summing daily
// buckets counts each prospect exactly once across the window.
function repGaugeTotals(series) {
  var reps = (series && Array.isArray(series.reps)) ? series.reps : [];
  return reps.map(function (r) {
    var h = { handled: 0, total: 0 }, c = { closed: 0, total: 0 };
    (Array.isArray(r.handle) ? r.handle : []).forEach(function (b) {
      if (!b) return; h.handled += b.handled || 0; h.total += b.total || 0;
    });
    (Array.isArray(r.close) ? r.close : []).forEach(function (b) {
      if (!b) return; c.closed += b.closed || 0; c.total += b.total || 0;
    });
    return {
      user_id: r.user_id, name: r.name || null,
      objections: measure(h.handled, h.total, MIN_OBJECTIONS, 'objection', 'handled'),
      prospects: measure(c.closed, c.total, MIN_PROSPECTS, 'prospect', 'closed'),
    };
  });
}

// ⚠ BELOW THE FLOOR THE RATE IS WITHHELD, NOT ZEROED. A dial reading 0% claims
// the rep handled nothing; "only 3 objections" says the window is too thin to
// judge. Those are different statements and only one of them is true.
function measure(numerator, total, floor, unit, numeratorName) {
  var enough = total >= floor;
  var out = {
    // Both spellings on purpose: `numerator` for code that does not care which
    // dial it is looking at, and the DOMAIN name so the render site reads
    // "4 of 10 handled" rather than "4 of 10 numerator".
    numerator: numerator, total: total, enough: enough,
    rate: enough ? Math.round((numerator / total) * 100) : null,
    reason: enough ? null
      : (total === 0 ? ('no ' + unit + 's in the last 7 days')
                     : ('only ' + plural(total, unit) + ' in the last 7 days')),
  };
  out[numeratorName] = numerator;
  return out;
}

module.exports = {
  OBJECTION_TARGET_PCT: OBJECTION_TARGET_PCT,
  OBJECTION_SCALE_MAX: OBJECTION_SCALE_MAX,
  CLOSING_TARGET_PCT: CLOSING_TARGET_PCT,
  CLOSING_SCALE_MAX: CLOSING_SCALE_MAX,
  MIN_OBJECTIONS: MIN_OBJECTIONS,
  MIN_PROSPECTS: MIN_PROSPECTS,
  MID_BAND_FRACTION: MID_BAND_FRACTION,
  SWEEP_DEG: SWEEP_DEG,
  TICK_STEP_PCT: TICK_STEP_PCT,
  MAJOR_EVERY_PCT: MAJOR_EVERY_PCT,
  METRICS: METRICS,
  band: band,
  needleAngle: needleAngle,
  ticks: ticks,
  repGaugeTotals: repGaugeTotals,
};
