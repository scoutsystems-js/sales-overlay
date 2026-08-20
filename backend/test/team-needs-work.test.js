// Tests for the "What needs work" deterministic counterfactual core
// (lib/team-needs-work._computeNeedsWork). Phase 1 formula was approved
// 2026-07-26; this guards the math + guardrails + degrade ladder so the money
// sentence can NEVER fire below threshold. The pure core takes already-fetched
// objection rows + analyses + a surface→bucket mapping (Claude's only job) and
// returns the card/detail envelope — no DB, no Claude.
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const nw = require('../lib/team-needs-work');

// Build N objection rows for one bucket/surface with a given handled + closed split.
// Each row: { call_id, surface, handled, quote }. Parent outcome comes from analyses.
function objs(spec) {
  // spec: [{surface, call_id, handled, quote}]
  return spec.map(function (s, i) {
    return { call_id: s.call_id, surface: s.surface, handled: !!s.handled, quote: s.quote || ('q' + i), observation: '', rep: 'rep@x.co', clip_url: null };
  });
}

// Helper: make an analyses array from a map of call_id → {outcome, cash}
function analysesFrom(map) {
  return Object.keys(map).map(function (cid) { return { fathom_call_id: cid, outcome: map[cid].outcome, cash_collected: map[cid].cash }; });
}

test('exports _computeNeedsWork + guardrail constants', function () {
  assert.strictEqual(typeof nw._computeNeedsWork, 'function');
  assert.strictEqual(nw._MIN_BUCKET, 6);
  assert.strictEqual(nw._MIN_GAP_PP, 5);
  assert.strictEqual(nw._MIN_ANALYZED, 10);
  // ⚠ _MIN_LINK_GROUP / _MIN_CLOSED / _MIN_DEALS_FOR_CASH / _computeLinkage were
  // removed with the money math (2026-08-17). Asserted ABSENT so a future edit
  // that reintroduces the money lane trips this test rather than passing quietly.
  assert.strictEqual(nw._MIN_LINK_GROUP, undefined);
  assert.strictEqual(nw._MIN_CLOSED, undefined);
  assert.strictEqual(nw._MIN_DEALS_FOR_CASH, undefined);
  assert.strictEqual(nw._computeLinkage, undefined);
});

test('no_volume when fewer than MIN_ANALYZED analyzed calls', function () {
  var o = objs([{ surface: 'too expensive', call_id: 'c1', handled: false }]);
  var a = analysesFrom({ c1: { outcome: 'lost', cash: 0 } });
  var r = nw._computeNeedsWork(o, a, { 'too expensive': 'Price' });
  assert.strictEqual(r.state, 'no_volume');
});

// A full money-path scenario mirroring the approved worked example shape.
// 20 analyzed calls, 10 closed (avg cash $4000). Two buckets:
//   "Think about it": 12 objections, 2 handled (rate ~17%)
//   "Price": 12 objections, 8 handled (rate ~67%)  → baseline_other high
// Linkage: handled objections mostly in closed calls; not-handled mostly not.
function moneyScenario() {
  var analysesMap = {};
  for (var i = 1; i <= 10; i++) analysesMap['closed' + i] = { outcome: 'closed', cash: 4000 };
  for (var j = 1; j <= 10; j++) analysesMap['open' + j] = { outcome: j <= 8 ? 'follow_up' : 'lost', cash: 0 };
  var spec = [];
  // Price bucket: 8 handled (in closed calls), 4 not-handled (in open calls)
  for (var p = 1; p <= 8; p++) spec.push({ surface: 'too expensive', call_id: 'closed' + p, handled: true });
  for (var p2 = 1; p2 <= 4; p2++) spec.push({ surface: 'too expensive', call_id: 'open' + p2, handled: false });
  // Think bucket: 2 handled (closed), 10 not-handled (mostly open)
  spec.push({ surface: 'needs to think', call_id: 'closed9', handled: true });
  spec.push({ surface: 'needs to think', call_id: 'closed10', handled: true });
  for (var t = 1; t <= 8; t++) spec.push({ surface: 'needs to think', call_id: 'open' + t, handled: false });
  spec.push({ surface: 'needs a few days', call_id: 'open9', handled: false });
  spec.push({ surface: 'needs a few days', call_id: 'open10', handled: false });
  return {
    objs: objs(spec),
    analyses: analysesFrom(analysesMap),
    mapping: { 'too expensive': 'Price', 'needs to think': 'Think about it', 'needs a few days': 'Think about it' },
  };
}

/* ⚠ REMOVED 2026-08-17 with the money math it tested. Archived, not deleted —
   these asserted the counterfactual that Justin removed; the feature is gone,
   so the test goes with it rather than being loosened to keep passing.

test('money state: features the weakest bucket with the largest extra cash', function () {
  var s = moneyScenario();
  var r = nw._computeNeedsWork(s.objs, s.analyses, s.mapping);
  assert.strictEqual(r.state, 'money');
  assert.strictEqual(r.bucket.label, 'Think about it'); // the weak one, not Price
  // rate < baseline
  assert.ok(r.bucket.rate_pct < r.bucket.baseline_pct);
  // money numbers present and positive
  assert.ok(r.extra.extra_deals > 0);
  assert.ok(r.extra.extra_cash > 0);
  assert.ok(r.extra.delta > 0);
  // card text carries the dollar figure
  assert.ok(/\$\d/.test(r.card_text), 'money card_text must contain a $ figure: ' + r.card_text);
  assert.ok(r.card_text.indexOf('Think about it') !== -1);
});
*/

/* ⚠ REMOVED 2026-08-17 with the money math it tested. Archived, not deleted —
   these asserted the counterfactual that Justin removed; the feature is gone,
   so the test goes with it rather than being loosened to keep passing.

test('extra_cash = additional_handled × delta × avg_cash (deterministic)', function () {
  var s = moneyScenario();
  var r = nw._computeNeedsWork(s.objs, s.analyses, s.mapping);
  var e = r.extra;
  var recomputed = e.additional_handled * e.delta * e.avg_cash;
  // r.extra.extra_cash is the raw (pre-rounding) product; allow tiny fp slack
  assert.ok(Math.abs(recomputed - e.extra_cash) < 1e-6, recomputed + ' vs ' + e.extra_cash);
});
*/

test('rate_gap is now the ONLY state, and the card never contains a $', function () {
  // Was "rate_gap when the linkage groups are too small". There is no longer a
  // money state to fall back FROM, so this now pins the single surviving path.
  var analysesMap = {};
  for (var i = 1; i <= 12; i++) analysesMap['c' + i] = { outcome: i <= 5 ? 'closed' : 'follow_up', cash: i <= 5 ? 3000 : 0 };
  var spec = [];
  for (var k = 1; k <= 6; k++) spec.push({ surface: 'needs to think', call_id: 'c' + (k + 6), handled: false }); // weak bucket, 6, all unhandled
  spec.push({ surface: 'too expensive', call_id: 'c1', handled: true });
  spec.push({ surface: 'too expensive', call_id: 'c2', handled: true });
  var r = nw._computeNeedsWork(objs(spec), analysesFrom(analysesMap), { 'needs to think': 'Think about it', 'too expensive': 'Price' });
  assert.strictEqual(r.state, 'rate_gap');
  assert.strictEqual(r.extra.extra_cash, undefined, 'money fields are gone, not nulled');
  assert.ok(!/\$/.test(r.card_text), 'the card must NOT contain a $: ' + r.card_text);
  assert.ok(r.card_text.indexOf('Think about it') !== -1);
});

test('thin_types when no bucket clears MIN_BUCKET', function () {
  var analysesMap = {};
  for (var i = 1; i <= 15; i++) analysesMap['c' + i] = { outcome: 'closed', cash: 1000 };
  // 3 tiny buckets, none >= 6
  var spec = [
    { surface: 'a', call_id: 'c1', handled: false }, { surface: 'a', call_id: 'c2', handled: false },
    { surface: 'b', call_id: 'c3', handled: false }, { surface: 'c', call_id: 'c4', handled: true },
  ];
  var r = nw._computeNeedsWork(objs(spec), analysesFrom(analysesMap), { a: 'A', b: 'B', c: 'C' });
  assert.strictEqual(r.state, 'thin_types');
});

test('detail carries per-bucket rates, the surface→bucket mapping, and grounding quotes', function () {
  var s = moneyScenario();
  var r = nw._computeNeedsWork(s.objs, s.analyses, s.mapping);
  assert.ok(Array.isArray(r.detail.buckets) && r.detail.buckets.length >= 2);
  var think = r.detail.buckets.find(function (b) { return b.label === 'Think about it'; });
  assert.ok(think && typeof think.rate_pct === 'number' && think.is_focus === true);
  // mapping visibility: every distinct surface appears with its bucket
  var surfaces = r.detail.mapping.map(function (m) { return m.surface; });
  assert.ok(surfaces.indexOf('needs to think') !== -1);
  assert.ok(surfaces.indexOf('needs a few days') !== -1);
  assert.ok(r.detail.mapping.every(function (m) { return typeof m.bucket === 'string'; }));
  // grounding quotes from the focus bucket, capped
  assert.ok(Array.isArray(r.detail.quotes) && r.detail.quotes.length >= 1 && r.detail.quotes.length <= 2);
});
