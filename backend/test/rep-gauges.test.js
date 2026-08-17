/**
 * The manager speedometer panel (Justin's spec, 2026-08-17).
 *
 * ⚠ THE PANEL'S WHOLE POINT IS THAT IT DOES NOT FOLLOW THE DATE PICKER. It reads
 * a FIXED last-7-days window while every other surface on the page takes its
 * range from the picker below it. The shared-carrier failure has bitten this
 * codebase twice — `state.dateRange` changing meaning under `openBucketEvidence`,
 * and `init()` overwriting a hash-restored range — so the independence is pinned
 * by a test, not by intent.
 *
 * ⚠ THE NEEDLE IS A FIXED RED POINTER AND CARRIES NO MEANING (Justin). It is the
 * pointer on a car gauge. The BAND it points at carries the meaning: green at or
 * above target, yellow from 60% of target up to it, red below.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/rep-gauges');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// ── the targets and scales ────────────────────────────────────────────────
test("Justin's numbers, as SINGLE NAMED CONSTANTS so a target is a one-line change", () => {
  // 35 is Justin's WORKING BAR (ruled "for now"), not a settled standard —
  // it is meant to rise once reps cluster at the top. See the module header.
  assert.strictEqual(G.OBJECTION_TARGET_PCT, 35);
  assert.strictEqual(G.OBJECTION_SCALE_MAX, 100);
  assert.strictEqual(G.CLOSING_TARGET_PCT, 25);
  assert.strictEqual(G.CLOSING_SCALE_MAX, 50);
  // Both thresholds are the EXISTING ones — same question, same answer.
  assert.strictEqual(G.MIN_OBJECTIONS, 6);
  assert.strictEqual(G.MIN_PROSPECTS, 6);
});

test('the objection target matches the one the rest of the codebase already uses', () => {
  const { MIN_CATEGORY_OBJECTIONS } = require('../lib/rep-card-metrics');
  assert.strictEqual(G.MIN_OBJECTIONS, MIN_CATEGORY_OBJECTIONS,
    '"is this enough objections to judge?" must not have two answers');
});

// ── banding ───────────────────────────────────────────────────────────────
test('BANDS are semantic: green at/above target, yellow from 60% of it, red below', () => {
  assert.strictEqual(G.band(50, 50), 'good');
  assert.strictEqual(G.band(72, 50), 'good');
  assert.strictEqual(G.band(49.9, 50), 'mid');
  assert.strictEqual(G.band(30, 50), 'mid', '60% of 50 is exactly 30 — inclusive');
  assert.strictEqual(G.band(29.9, 50), 'bad');
  assert.strictEqual(G.band(0, 50), 'bad');
  // The closing dial's own target.
  assert.strictEqual(G.band(25, 25), 'good');
  assert.strictEqual(G.band(15, 25), 'mid');
  assert.strictEqual(G.band(14.9, 25), 'bad');
});

test('⚠ WHY THE TARGET IS 35 AND NOT 50 — measured, and pinned so it is not undone', () => {
  // Josh 30d = 21.3%, all users 30d = 29.1% under the handled-includes-closed
  // ruling. At a 50 target the red/yellow boundary is 30, so BOTH sit in red and
  // the dial reports failure every week regardless of what anyone does.
  assert.strictEqual(G.band(21.3, 50), 'bad');
  assert.strictEqual(G.band(29.1, 50), 'bad');
  // At the ruled 35, the same numbers discriminate — boundary 21.
  assert.strictEqual(G.band(21.3, G.OBJECTION_TARGET_PCT), 'mid');
  assert.strictEqual(G.band(29.1, G.OBJECTION_TARGET_PCT), 'mid');
});

// ── aggregation over the fixed window ─────────────────────────────────────
const SERIES = {
  buckets: [{ label: 'd1' }, { label: 'd2' }, { label: 'd3' }],
  reps: [
    { user_id: 'a', name: 'Ava',
      handle: [{ rate: 50, handled: 3, total: 6 }, { rate: null, handled: 0, total: 0 }, { rate: 25, handled: 1, total: 4 }],
      close:  [{ rate: 50, closed: 2, total: 4 }, { rate: null, closed: 0, total: 0 }, { rate: 0, closed: 0, total: 3 }] },
    { user_id: 'b', name: 'Ben',
      handle: [{ rate: null, handled: 0, total: 0 }, { rate: 0, handled: 0, total: 2 }, { rate: null, handled: 0, total: 0 }],
      close:  [{ rate: null, closed: 0, total: 0 }, { rate: 100, closed: 1, total: 1 }, { rate: null, closed: 0, total: 0 }] },
  ],
  team: { handle: [], close: [] },
};

test('daily buckets SUM to the window total — counts, never an average of rates', () => {
  const t = G.repGaugeTotals(SERIES);
  const ava = t.find((r) => r.user_id === 'a');
  assert.strictEqual(ava.objections.handled, 4);
  assert.strictEqual(ava.objections.total, 10);
  assert.strictEqual(ava.objections.rate, 40, '4/10 — NOT the mean of 50% and 25%');
  assert.strictEqual(ava.prospects.closed, 2);
  assert.strictEqual(ava.prospects.total, 7);
  assert.strictEqual(ava.prospects.rate, 29);
});

test('⚠ BELOW THRESHOLD THE DIAL IS EMPTY WITH A REASON — never a confident 0%', () => {
  const t = G.repGaugeTotals(SERIES);
  const ben = t.find((r) => r.user_id === 'b');
  assert.strictEqual(ben.objections.total, 2);
  assert.strictEqual(ben.objections.enough, false);
  assert.strictEqual(ben.objections.rate, null, 'a rate is withheld, not rendered as 0');
  assert.ok(/only 2 objections/.test(ben.objections.reason), ben.objections.reason);
  assert.strictEqual(ben.prospects.enough, false);
  assert.ok(/only 1 prospect\b/.test(ben.prospects.reason), ben.prospects.reason);
});

test('exactly at the threshold counts as enough — the floor is inclusive', () => {
  const s = { buckets: [{ label: 'd' }], reps: [{ user_id: 'x', name: 'X',
    handle: [{ rate: 50, handled: 3, total: 6 }], close: [{ rate: 50, closed: 3, total: 6 }] }], team: {} };
  const t = G.repGaugeTotals(s);
  assert.strictEqual(t[0].objections.enough, true);
  assert.strictEqual(t[0].prospects.enough, true);
});

test('the reason says "objection"/"prospect" correctly at 1, and reads as a WINDOW fact', () => {
  const s = { buckets: [{ label: 'd' }], reps: [{ user_id: 'x', name: 'X',
    handle: [{ rate: null, handled: 0, total: 1 }], close: [{ rate: null, closed: 0, total: 0 }] }], team: {} };
  const t = G.repGaugeTotals(s);
  assert.ok(/only 1 objection\b/.test(t[0].objections.reason), t[0].objections.reason);
  assert.ok(/no prospects/.test(t[0].prospects.reason), t[0].prospects.reason);
});

test('malformed input yields an empty list rather than throwing', () => {
  [null, undefined, {}, { reps: null }].forEach(function (s) {
    assert.deepStrictEqual(G.repGaugeTotals(s), []);
  });
});

// ── gauge geometry ────────────────────────────────────────────────────────
test('the needle angle maps 0→scale across a half turn, and CLAMPS', () => {
  assert.strictEqual(G.needleAngle(0, 100), -90);
  assert.strictEqual(G.needleAngle(50, 100), 0);
  assert.strictEqual(G.needleAngle(100, 100), 90);
  assert.strictEqual(G.needleAngle(25, 50), 0, 'the closing dial is 0–50');
  assert.strictEqual(G.needleAngle(120, 100), 90, 'over-scale clamps rather than spinning past');
  assert.strictEqual(G.needleAngle(-5, 100), -90);
});

test('ticks every 10% of scale, with labelled majors', () => {
  const t = G.ticks(100);
  assert.strictEqual(t.length, 11, '0..100 inclusive');
  // Majors are every OTHER tick, not every quarter: quarter points do not land
  // on tenths, and a label with no tick under it is worse than fewer labels.
  assert.deepStrictEqual(t.filter((x) => x.major).map((x) => x.value), [0, 20, 40, 60, 80, 100]);
  const c = G.ticks(50);
  assert.strictEqual(c.length, 11, 'the 0–50 dial keeps ELEVEN ticks — every 10% OF SCALE');
  assert.deepStrictEqual(c.filter((x) => x.major).map((x) => x.value), [0, 10, 20, 30, 40, 50]);
});

// ── the independence that is the panel's whole point ──────────────────────
test('⚠ THE GAUGE LANE NEVER READS THE PICKER — the failure that has bitten twice', () => {
  const at = HTML.indexOf('function gaugeWindow');
  assert.ok(at !== -1, 'gaugeWindow() must exist');
  const end = HTML.indexOf('\n  }', at);
  const src = HTML.slice(at, end);
  assert.ok(src.length > 60 && src.length < 2000, 'slice must cover the function: ' + src.length);
  assert.ok(!/state\.teamRange/.test(src), 'gaugeWindow must not read the picker');
  assert.ok(!/teamQP/.test(src), 'gaugeWindow must not use the picker query builder');

  const la = HTML.indexOf('repGauges:');
  assert.ok(la !== -1, 'the gauge loader lane must exist');
  const lane = HTML.slice(la, HTML.indexOf('\n', la));
  assert.ok(lane.length > 40, 'lane slice must cover the entry: ' + lane.length);
  assert.ok(!/teamQP/.test(lane),
    'the gauge lane must NOT build its URL with teamQP() — that injects state.teamRange '
    + 'and the panel would silently start following the picker');
  assert.ok(/gaugeWindow\(\)/.test(lane), 'it must take its range from gaugeWindow()');
});

test('the panel names its own window on screen, so it cannot be misread', () => {
  assert.ok(/Last 7 days/.test(HTML), 'the panel must state its fixed window');
  assert.ok(/not affected by the date filter/i.test(HTML),
    'and say plainly that the picker does not drive it');
});

test('the needle is a FIXED red pointer — it carries no meaning, the band does', () => {
  const at = HTML.indexOf('function gaugeSvg');
  assert.ok(at !== -1, 'gaugeSvg() must exist');
  const src = HTML.slice(at, HTML.indexOf('\n  }', at));
  assert.ok(src.length > 200, 'slice must cover the function: ' + src.length);
  assert.ok(/gauge-needle/.test(src), 'the needle must be a stable class, not a computed colour');
  assert.ok(!/var\(--good\)|var\(--mid\)|var\(--bad\)/.test(src.match(/gauge-needle[\s\S]{0,200}/)[0]),
    'the needle must never be coloured by the band');
});
