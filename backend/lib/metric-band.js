/**
 * lib/metric-band.js — THE THIRD SHAPE: a metric with a SWEET SPOT.
 *
 * ⚠⚠ THE CATALOG HAD TWO SHAPES AND NEITHER WAS TRUE FOR CALL LENGTH. Justin,
 * 2026-09-01: "a good sales call lasts anywhere from 20 min to over an hour, it
 * just depends on the prospect, but typically 35-45 min is the sweet spot."
 * `higher_is_better` awards first place to the shortest call and
 * `lower_is_better` to the longest — and the ceiling was ALREADY doing it:
 *
 *     Nathan   28.8 min average, 13 of his 27 calls UNDER 20 MINUTES  -> ranked FIRST
 *     Gabriel  67.1 min average                                       -> the only one "failing"
 *
 * Excluding no-shows moved those 28.8 -> 29.9 and 67.1 -> 67.7, which is what
 * makes it the MODEL rather than the data.
 *
 * ⚠⚠ TWO EDGES, NOT ONE PAIR. The ruling contains two bands — "20 min to over an
 * hour" (acceptable) and "35-45 the sweet spot" (ideal) — and one pair of
 * numbers loses that. It matters: a strict 35-45 puts SIX OF EIGHT reps outside,
 * and an alarm that fires on almost everyone gets ignored. The two edges map
 * onto the three colour zones the gauge already had, so this is a third branch
 * rather than a new mechanism:
 *
 *     inside good  -> 'good'      inside ok (but not good) -> 'mid'      outside -> 'bad'
 *
 * ⚠⚠ ONE DEFINITION, TWO CONSUMERS, AND THAT IS THE POINT OF THIS FILE.
 * `lib/team-averages.js` (the gauge) and `lib/widget-catalog.js` (the cards and
 * the ranked list) each declared call time's direction SEPARATELY. They agreed,
 * which is exactly how a shared-carrier failure hides — so the band lives here
 * and both import it, rather than two copies being moved together and trusted
 * to stay in step.
 */
'use strict';

/* ⚠ WHERE EACH NUMBER CAME FROM, because a future reader must be able to tell a
   MEASURED threshold from a RULED one and they are not the same kind of claim.

   avg_call_time — RULED, both edges. Justin's experience, stated above. The
   corpus is consistent with it (1,546 real graded calls: median 48.5, and 292 —
   19% — under 20 minutes, mostly NOT no-shows) but did not produce the numbers.

   time_to_price — the two edges have DIFFERENT provenance and that is recorded
   deliberately:
     LOWER 20  MEASURED. Discovery items established (of six) by when the price
               landed, 427 calls: 15-20 min averages 2.60, 20-25 averages 3.23,
               and it plateaus at ~3.2-3.4 above that. The step sits AT 20.
               ⚠ It coincides with call time's lower edge and was NOT copied from
               it — it was derived here, independently, from that table.
               ⚠ AND IT IS PARTLY MECHANICAL: a call that prices at minute 10 has
               had ten minutes in which to do discovery. The relationship is real
               and it is not evidence of causation. That caveat belongs beside
               the band, not hidden behind it.
     UPPER 45  RULED, NOT MEASURED. Justin: "if you're price dropping after 45
               min you're moving slow." ⚠ THE DATA COULD NOT HAVE SHOWN THIS —
               coverage rises monotonically to the end of the sample with no
               turning point, and the buckets above 55 minutes hold 13 calls
               between them. A limit of the data, not a finding. He supplied it.
     ⚠ NO OUTER `ok` BAND IS DECLARED for time to price, because nobody has ruled
       one and inventing a tolerance would be the same error as inventing a
       direction. Outside 20-45 is simply outside. */
var BANDS = {
  avg_call_time: { good: [35, 45], ok: [20, 60], unit: 'min' },
  time_to_price: { good: [20, 45], ok: null,     unit: 'min' },
};

function bandFor(key) { return BANDS[key] || null; }

function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : null; }

/* good / mid / bad for a banded metric. `mid` only exists where an outer
   tolerance was ruled; without one a value is inside or it is not. */
function classify(value, band) {
  var v = num(value);
  if (v === null || !band) return null;
  if (v >= band.good[0] && v <= band.good[1]) return 'good';
  if (band.ok && v >= band.ok[0] && v <= band.ok[1]) return 'mid';
  return 'bad';
}

/* Does one value sit inside the band? The gauge caption's "N of M reps" counts
   this, so it is written once. */
function meets(value, band) { return classify(value, band) === 'good'; }

/* ⚠⚠ WHICH SIDE, AND IT IS NOT DECORATION. Distance alone puts a rep at 28.8 and
   one at 67.1 ADJACENT — both ~16 minutes outside — while they need OPPOSITE
   coaching: one is rushing, one is rambling. A ranked list that loses the side
   reproduces the exact defect the band was built to fix. */
function sideOf(value, band) {
  var v = num(value);
  if (v === null || !band) return null;
  if (v < band.good[0]) return 'under';
  if (v > band.good[1]) return 'over';
  return 'in';
}

/* How far outside, in the metric's own unit. Zero inside the band — there is no
   honest ordering between 38 and 42 minutes, so everything inside ties and the
   caller lists them rather than ranking them. */
function distance(value, band) {
  var v = num(value);
  if (v === null || !band) return null;
  if (v < band.good[0]) return band.good[0] - v;
  if (v > band.good[1]) return v - band.good[1];
  return 0;
}

module.exports = { BANDS: BANDS, bandFor: bandFor, classify: classify,
                   meets: meets, sideOf: sideOf, distance: distance };
