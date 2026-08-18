/**
 * TEAM AVERAGES PANEL — replaces the per-rep speedometers (Josh's note, ruled
 * 2026-08-18). His reasoning: a dial per rep does not work at 20+ reps.
 *
 * THREE GAUGES, TEAM AVERAGES — closing rate (target 25, scale 0-50), objection
 * handling (35, 0-100), avg call time (60 min, 0-90).
 *
 * ⚠ THE SCALE FOR AVG CALL TIME WAS DERIVED FROM WHAT THE NEEDLE WILL ACTUALLY
 * SHOW, NOT FROM THE PER-CALL SPREAD. A team average is far tighter than the
 * calls it averages: measured on live rep-weeks with >=3 calls (n=14) the whole
 * observed range is 40.4-64.0 min. On 0-90 that lands at 45-71% of the arc and a
 * 5-minute move is ~2 of 40 segments; on 0-120 it never leaves the lower-middle
 * third and the top half of the dial is permanently dead. 90 is not a round
 * number — p90 of individual real calls is 89.7 min, so full scale is exactly
 * where the top decile begins.
 *
 * ⚠ "N of M" EXCLUDES UNMEASURED REPS AND SAYS SO (ruling 3, same shape as the
 * closed/not-closed filter): "8 of 20 at or above target · 2 not enough calls".
 * A rep with 2 calls is UNMEASURED, not failing — counting them as below target
 * makes a quiet week look like a bad rep. The three numbers reconcile to the
 * team size by construction, so a manager can add up what is on screen.
 */
const test = require('node:test');
const assert = require('node:assert');
const A = require('../lib/team-averages');

test('the three ruled metrics, with their targets and scales', () => {
  assert.strictEqual(A.METRICS.closing.target, 25);
  assert.strictEqual(A.METRICS.closing.scale, 50);
  assert.strictEqual(A.METRICS.objections.target, 35);
  assert.strictEqual(A.METRICS.objections.scale, 100);
  assert.strictEqual(A.METRICS.calltime.target, 60);
  assert.strictEqual(A.METRICS.calltime.scale, 90);
  assert.deepStrictEqual(A.METRIC_ORDER, ['closing', 'objections', 'calltime']);
});

test('⚠ the call-time scale keeps the LIVE rep-week band inside the readable arc', () => {
  // The measured range this dial will actually show. If someone "tidies" the
  // scale to 0-120 or 0-60 this fails and says why.
  const lo = A.valueFraction(40.4, A.METRICS.calltime.scale);
  const hi = A.valueFraction(64.0, A.METRICS.calltime.scale);
  assert.ok(lo > 0.40 && lo < 0.50, 'low end of the real band should sit near mid-arc, got ' + lo);
  assert.ok(hi > 0.65 && hi < 0.75, 'high end should sit in the upper arc, got ' + hi);
  // and the target must be reachable — on a 0-60 scale it never could be
  assert.ok(A.valueFraction(A.METRICS.calltime.target, A.METRICS.calltime.scale) < 1,
    'the target must sit INSIDE the scale or the needle can never exceed it');
});

// ── bands: semantic only ──────────────────────────────────────────────────
test('band is good at/above target, mid from 60% of target, bad below', () => {
  assert.strictEqual(A.band(25, 25), 'good');
  assert.strictEqual(A.band(30, 25), 'good');
  assert.strictEqual(A.band(15, 25), 'mid');   // 0.6 * 25
  assert.strictEqual(A.band(24.9, 25), 'mid');
  assert.strictEqual(A.band(14.9, 25), 'bad');
  assert.strictEqual(A.band(0, 25), 'bad');
  assert.strictEqual(A.band(null, 25), null, 'no value is not a band');
});

// ── the segmented arc ─────────────────────────────────────────────────────
test('the arc is built from discrete SEGMENTS, not a smooth sweep', () => {
  const segs = A.segments();
  assert.strictEqual(segs.length, A.SEGMENT_COUNT);
  assert.strictEqual(A.SEGMENT_COUNT, 40, 'Justin\'s spec: ~40 blocks');
  // first starts at -sweep/2, last ends at +sweep/2
  assert.strictEqual(Math.round(segs[0].from), -A.SWEEP_DEG / 2);
  assert.strictEqual(Math.round(segs[segs.length - 1].to), A.SWEEP_DEG / 2);
  // and they do not overlap: each begins where the previous ended, less the gap
  for (let i = 1; i < segs.length; i++) {
    assert.ok(segs[i].from >= segs[i - 1].to, 'segment ' + i + ' overlaps its predecessor');
  }
});

test('segments light in proportion to the value, and CLAMP at both ends', () => {
  const s = A.METRICS.objections.scale;            // 0-100
  assert.strictEqual(A.litCount(0, s), 0);
  assert.strictEqual(A.litCount(50, s), 20);
  assert.strictEqual(A.litCount(100, s), 40);
  assert.strictEqual(A.litCount(140, s), 40, 'over-scale parks at full, never wraps');
  assert.strictEqual(A.litCount(-5, s), 0, 'negative cannot light a segment');
  assert.strictEqual(A.litCount(null, s), 0);
});

test('a value above zero always lights at least one segment', () => {
  // 0.4% of a 0-100 dial rounds to zero segments, which would render as an
  // EMPTY dial for a non-zero number — indistinguishable from no data.
  assert.strictEqual(A.litCount(0.4, 100), 1);
  assert.strictEqual(A.litCount(0, 100), 0, 'but a true zero stays empty');
});

test('the target notch sits at the target, on each metric\'s own scale', () => {
  assert.strictEqual(A.valueFraction(25, 50), 0.5);       // closing: mid-arc
  assert.strictEqual(A.valueFraction(35, 100), 0.35);
  assert.ok(Math.abs(A.valueFraction(60, 90) - 0.6667) < 0.001);
});

// ── pooled team maths ─────────────────────────────────────────────────────
test('⚠ RATES ARE POOLED, never the mean of per-rep rates', () => {
  // The counts printed beneath the gauge are the pooled ones (house rule: a rate
  // renders with its raw counts). A mean-of-rates would put a DIFFERENT number
  // on screen from the counts under it, which is how a panel loses trust.
  const reps = [
    { closing: { numerator: 11, total: 39 } },   // 28.2%
    { closing: { numerator: 1, total: 12 } },    //  8.3%
    { closing: { numerator: 4, total: 10 } },    // 40.0%
    { closing: { numerator: 2, total: 11 } },    // 18.2%
  ];
  const pooled = A.poolRate(reps, 'closing');
  assert.strictEqual(pooled.numerator, 18);
  assert.strictEqual(pooled.total, 72);
  assert.strictEqual(pooled.value, 25);          // 18/72 exactly
  // the mean of the four rates is 23.7 — a different number
  assert.notStrictEqual(pooled.value, 24);
});

test('avg call time is CALL-WEIGHTED, not the mean of per-rep averages', () => {
  const reps = [
    { calltime: { seconds: 44 * 49.4 * 60, calls: 44 } },
    { calltime: { seconds: 12 * 39.4 * 60, calls: 12 } },
    { calltime: { seconds: 12 * 42.8 * 60, calls: 12 } },
    { calltime: { seconds: 11 * 43.1 * 60, calls: 11 } },
  ];
  const pooled = A.poolDuration(reps);
  assert.strictEqual(pooled.total, 79);
  assert.ok(Math.abs(pooled.value - 46.0) < 0.15, 'expected ~46.0 min, got ' + pooled.value);
  // mean of the four rep averages is 43.7 — visibly different
  assert.ok(Math.abs(pooled.value - 43.7) > 1);
});

test('a pooled total below the floor withholds the value rather than showing zero', () => {
  const thin = A.poolRate([{ closing: { numerator: 0, total: 2 } }], 'closing');
  assert.strictEqual(thin.value, null, 'a dial reading 0% claims the team closed nothing');
  assert.strictEqual(thin.enough, false);
  assert.ok(/only 2 prospects/.test(thin.reason), thin.reason);
  const none = A.poolRate([], 'closing');
  assert.strictEqual(none.value, null);
  assert.ok(/no prospects/.test(none.reason), none.reason);
});

// ── ⚠ the three-group count ───────────────────────────────────────────────
test('⚠⚠ "N of M" EXCLUDES unmeasured reps — three groups, and they reconcile', () => {
  const reps = [
    { closing: { numerator: 11, total: 39 } },   // 28% → at or above 25
    { closing: { numerator: 1, total: 12 } },    //  8% → below
    { closing: { numerator: 4, total: 10 } },    // 40% → at or above
    { closing: { numerator: 0, total: 2 } },     // 2 prospects → UNMEASURED
    { closing: { numerator: 0, total: 0 } },     // no prospects → UNMEASURED
  ];
  const c = A.repCounts(reps, 'closing');
  assert.strictEqual(c.at_or_above, 2);
  assert.strictEqual(c.measured, 3);
  assert.strictEqual(c.unmeasured, 2);
  assert.strictEqual(c.total, 5);
  // the property that makes it an accounting rather than a caveat
  assert.strictEqual(c.measured + c.unmeasured, c.total,
    'the three numbers must reconcile to the team size or the panel is lying by omission');
});

test('the count SENTENCE names the unmeasured group in words', () => {
  assert.strictEqual(
    A.countSentence({ at_or_above: 8, measured: 18, unmeasured: 2, total: 20 }),
    '8 of 18 reps at or above target · 2 not enough calls');
  // no unmeasured reps → no dangling clause
  assert.strictEqual(
    A.countSentence({ at_or_above: 3, measured: 4, unmeasured: 0, total: 4 }),
    '3 of 4 reps at or above target');
  // singular reads correctly
  assert.strictEqual(
    A.countSentence({ at_or_above: 1, measured: 1, unmeasured: 1, total: 2 }),
    '1 of 1 rep at or above target · 1 not enough calls');
  // nobody measurable at all
  assert.strictEqual(
    A.countSentence({ at_or_above: 0, measured: 0, unmeasured: 3, total: 3 }),
    'no reps with enough calls to measure yet');
});

test('⚠ SHIPS AT "0 of 4" — that is correct, not a bug (ruling 3)', () => {
  // Only one rep-week in the entire live corpus has ever averaged >= 60 minutes.
  // A future session must not read this as a broken gauge and "fix" it.
  const reps = [
    { calltime: { seconds: 49.4 * 60 * 44, calls: 44 } },
    { calltime: { seconds: 39.4 * 60 * 12, calls: 12 } },
    { calltime: { seconds: 42.8 * 60 * 12, calls: 12 } },
    { calltime: { seconds: 43.1 * 60 * 11, calls: 11 } },
  ];
  const c = A.repCounts(reps, 'calltime');
  assert.strictEqual(c.at_or_above, 0);
  assert.strictEqual(c.measured, 4);
  assert.strictEqual(A.countSentence(c), '0 of 4 reps at or above target');
});

// ── the window is the SERVER's, not the caller's ──────────────────────────
test('⚠ the 7-day window is computed here, never accepted from a caller', () => {
  const w = A.fixedWindow(new Date('2026-08-18T12:34:56.000Z'));
  assert.strictEqual(w.days, 7);
  assert.strictEqual(w.to, '2026-08-18T12:34:56.000Z');
  assert.strictEqual(w.from, '2026-08-11T12:34:56.000Z');
  assert.strictEqual(A.WINDOW_DAYS, 7);
  // fixedWindow takes ONE argument — there is no parameter through which a
  // caller could widen it. That is the whole point of the dedicated route.
  assert.strictEqual(A.fixedWindow.length, 1);
});

test('the shared floor is the EXISTING one — "enough to judge" must not have two answers', () => {
  const { MIN_CATEGORY_OBJECTIONS } = require('../lib/rep-card-metrics');
  assert.strictEqual(A.MIN_SAMPLE, MIN_CATEGORY_OBJECTIONS);
});

test('malformed input never throws', () => {
  [null, undefined, {}, [], [null], [{}], [{ closing: null }]].forEach(function (r) {
    const reps = Array.isArray(r) ? r : [];
    assert.doesNotThrow(() => A.poolRate(reps, 'closing'));
    assert.doesNotThrow(() => A.poolDuration(reps));
    assert.doesNotThrow(() => A.repCounts(reps, 'closing'));
  });
  assert.doesNotThrow(() => A.segments());
  [null, undefined, NaN, Infinity, 'x'].forEach((v) => {
    assert.strictEqual(A.litCount(v, 100), 0, String(v));
  });
});
