// Tests for the true-objections-ONLY taxonomy (item #5). The bucketing pass now
// classifies each bucket as true_objection | logistical_barrier | disqualification.
// The objection MATH — handle rate, weakest-bucket selection, linkage Δ, and the
// counterfactual — counts TRUE OBJECTIONS ONLY. Logistical (e.g. a declined
// payment) and disqualification (e.g. "can't afford") are excluded from the math
// and returned as a context block ("also this period: N DQ, M payment failures").
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const nw = require('../lib/team-needs-work');

// A period with:
//   Price (true_objection): 8 objections, 2 handled  → weak, 25%
//   Trust (true_objection): 6 objections, 5 handled  → strong, 83%
//   Payment failure (logistical): 4 objections, 0 handled — NOT coachable
//   Can't afford (disqualification): 3 objections, 0 handled — NOT coachable
// The DQ + logistical buckets have the WORST rates, so if the math wrongly
// counted them, the weakest-bucket selection would pick one of them.
function taxonomyFixture() {
  var analyses = [];
  // 20 analyzed calls, 8 closed for a workable linkage/money sample.
  for (var i = 1; i <= 8; i++) analyses.push({ fathom_call_id: 'c' + i, status: 'done', outcome: 'closed', cash_collected: 4000 });
  for (var j = 9; j <= 20; j++) analyses.push({ fathom_call_id: 'c' + j, status: 'done', outcome: 'follow_up', cash_collected: 0 });
  var objs = [];
  function add(surface, callId, handled) { objs.push({ call_id: callId, surface: surface, handled: !!handled }); }
  // Price: 2 handled (in closed calls), 6 not (spread) — true objection
  add('too expensive', 'c1', true); add('too expensive', 'c2', true);
  ['c9', 'c10', 'c11', 'c12', 'c13', 'c14'].forEach(function (c) { add('too expensive', c, false); });
  // Trust: 5 handled, 1 not — true objection (the strong one, the baseline)
  ['c3', 'c4', 'c5', 'c6', 'c7'].forEach(function (c) { add('need proof', c, true); }); add('need proof', 'c15', false);
  // Payment failure (logistical): 4, all in CLOSED calls, 0 handled — if counted
  // in the linkage these would wrongly look like "unhandled yet closed".
  ['c1', 'c2', 'c3', 'c4'].forEach(function (c) { add('card declined', c, false); });
  // Can't afford (disqualification): 3, 0 handled
  ['c16', 'c17', 'c18'].forEach(function (c) { add('cant afford it', c, false); });
  var mapping = { 'too expensive': 'Price', 'need proof': 'Trust', 'card declined': 'Payment failure', 'cant afford it': "Can't afford" };
  var bucketClass = { 'Price': 'true_objection', 'Trust': 'true_objection', 'Payment failure': 'logistical_barrier', "Can't afford": 'disqualification' };
  return { objs: objs, analyses: analyses, mapping: mapping, opts: { bucketClass: bucketClass } };
}

test('objections count (detail.objections) counts TRUE objections only', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  assert.strictEqual(r.detail.objections, 14); // 8 Price + 6 Trust; NOT 21
});

test('context block reports disqualifications + payment failures separately', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  assert.ok(r.detail.context, 'detail.context must exist');
  assert.strictEqual(r.detail.context.disqualifications, 3);
  assert.strictEqual(r.detail.context.logistical, 4);
});

test('weakest-bucket selection ignores logistical + DQ (focus is Price, not the 0% DQ)', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  assert.notStrictEqual(r.state, 'insufficient');
  assert.strictEqual(r.bucket.label, 'Price'); // the weak TRUE objection, not "Can't afford" (0%)
  assert.strictEqual(r.bucket.handled, 2);
  assert.strictEqual(r.bucket.total, 8);
});

test('baseline uses OTHER true objections only (Trust), not context buckets', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  // Price rate 25% vs Trust 5/6=83% → baseline 83%, gap 58pp (context buckets excluded)
  assert.strictEqual(r.bucket.rate_pct, 25);
  assert.strictEqual(r.bucket.baseline_pct, 83);
});

test('the MATH counts TRUE objections only — context in closed calls is excluded', () => {
  // Was "linkage Δ counts TRUE objections only". The linkage went with the money
  // math (2026-08-17), but the property it protected did NOT: the 4 "card
  // declined" (logistical, and sitting in CLOSED calls) plus the 3 DQs must stay
  // out of the numbers entirely. Re-expressed through what survives, so the
  // coverage is kept rather than dropped with the feature.
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  assert.strictEqual(r.detail.linkage, undefined, 'linkage was removed with the money math');
  // true objs = 14 (7 handled: 2 Price + 5 Trust; 7 not).
  assert.strictEqual(r.detail.objections, 14);
  var totals = r.detail.buckets.reduce(function (a, b) {
    return { total: a.total + b.total, handled: a.handled + b.handled };
  }, { total: 0, handled: 0 });
  assert.strictEqual(totals.total, 14, 'the 4 logistical + 3 DQ must not appear in any bucket');
  assert.strictEqual(totals.handled, 7);
});

test('detail.buckets are the TRUE-objection buckets only (context rendered separately)', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  var labels = r.detail.buckets.map(function (b) { return b.label; }).sort();
  assert.deepStrictEqual(labels, ['Price', 'Trust']);
});

test('personal lane: same true-objections-only split applies (subject=personal)', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, Object.assign({ subject: 'personal', minBucket: 4 }, f.opts));
  assert.strictEqual(r.detail.objections, 14);
  assert.strictEqual(r.detail.context.disqualifications, 3);
  assert.strictEqual(r.bucket.label, 'Price');
});

test('backward compat: no bucketClass → every bucket is a true objection (unchanged math)', () => {
  var f = taxonomyFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, {}); // no bucketClass
  assert.strictEqual(r.detail.objections, 21); // all buckets counted
  assert.ok(!r.detail.context || (r.detail.context.disqualifications === 0 && r.detail.context.logistical === 0));
});
