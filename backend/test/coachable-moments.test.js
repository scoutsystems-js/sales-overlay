/**
 * COACHABLE MOMENTS (H726, Justin's rulings 2026-09-04): ONE panel, mixed kinds. His filter — did this
 * move the call forward, or did it cost the call — asked both ways. Five per rep · one moment per call ·
 * up to three from the cost side, two from the forward side, either filling the other's shortfall ·
 * TIER BEFORE RECENCY (newest-first buried the pairs: one in the whole panel; tiered, fifteen).
 * Cost order: a missed-signal pair · an objection left unhandled on a call that did not close · a missed
 * opportunity on one. Forward order: a buying signal the closer earned · an objection handled · a signal
 * addressed · a verified strong moment. The pair's floor, closer-DQ exclusion and leaving exclusion survive.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../lib/coachable-moments');

const H = (o) => Object.assign({ id: 'h' + Math.random().toString(36).slice(2, 7), speaker: 'PROSPECT', speaker_verified: true, section: 'discovery', quote: 'q', observation: 'o', timestamp_seconds: 100 }, o);
const CAUSE = { move: 'digging for pain', none_reason: null, evidence: [{ timestamp_seconds: 10, quote: 'a', located: true }, { timestamp_seconds: 20, quote: 'b', located: true }], summary: 'Built up the pain until he admitted it.' };
const call = (id, date, outcome, highlights) => ({ id, user_id: 'rep', title: 'Call ' + id, call_date: date, recording_url: null, outcome, highlights });

test('tier before recency: an older pair outranks a newer unhandled objection; a newer missed opportunity comes last', () => {
  const calls = [
    call('c-new', '2026-09-04', 'lost', [H({ type: 'missed_opportunity', speaker: 'CLOSER' })]),
    call('c-mid', '2026-09-03', 'lost', [H({ type: 'objection', resolution: 'unhandled' })]),
    call('c-old', '2026-09-01', 'lost', [H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 100 }), H({ type: 'disqualify_signal', timestamp_seconds: 2000, quote: 'I do not have it' })]),
  ];
  const out = C.selectCoachableMoments(calls);
  assert.deepStrictEqual(out.map((i) => i.kind), ['missed_signal_pair', 'objection_unhandled', 'missed_opportunity']);
  assert.deepStrictEqual(out.map((i) => i.direction), ['cost', 'cost', 'cost']);
  assert.strictEqual(out[0].pair.gap_seconds, 1900);
});

test('forward order: earned signal · objection handled · signal addressed · verified strong moment; an unearned signal and an unverified strong moment never qualify', () => {
  const calls = [
    call('c1', '2026-09-04', 'closed', [H({ type: 'strong_moment', speaker: 'CLOSER', speaker_verified: true })]),
    call('c2', '2026-09-03', 'closed', [H({ type: 'risk_signal', handling: 'addressed' })]),
    call('c3', '2026-09-02', 'closed', [H({ type: 'objection', resolution: 'handled' })]),
    call('c4', '2026-09-01', 'closed', [H({ type: 'buying_signal', cause: CAUSE })]),
    call('c5', '2026-08-31', 'closed', [H({ type: 'buying_signal', cause: { move: 'none', none_reason: 'arrived_pre_sold' } }), H({ type: 'strong_moment', speaker: 'CLOSER', speaker_verified: false })]),
  ];
  const out = C.selectCoachableMoments(calls, { perRep: 5, cost: 3, forward: 2 });
  assert.deepStrictEqual(out.map((i) => i.kind), ['earned_signal', 'objection_handled', 'signal_addressed', 'strong_moment'], 'the forward side fills the cost side\'s shortfall, in tier order');
  assert.strictEqual(out[0].move, 'digging for pain');
  assert.ok(!out.some((i) => i.call_id === 'c5'), 'nothing on c5 qualifies');
});

test('five per rep, ONE moment per call: a call with a pair and a handled objection contributes once, on the cost side first', () => {
  const both = call('c-both', '2026-09-04', 'lost', [H({ type: 'risk_signal', handling: 'ignored', timestamp_seconds: 60 }), H({ type: 'disqualify_signal', timestamp_seconds: 900 }), H({ type: 'objection', resolution: 'handled' })]);
  const calls = [both].concat(['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => call('c-' + k, '2026-09-0' + (3 - Math.min(i, 2)), 'lost', [H({ type: 'objection', resolution: 'unhandled' }), H({ type: 'objection', resolution: 'handled' })])));
  const out = C.selectCoachableMoments(calls);
  assert.strictEqual(out.length, 5);
  assert.strictEqual(new Set(out.map((i) => i.call_id)).size, 5, 'one moment per call');
  assert.strictEqual(out.filter((i) => i.direction === 'cost').length, 3);
  assert.strictEqual(out.filter((i) => i.direction === 'forward').length, 2);
  assert.strictEqual(out[0].kind, 'missed_signal_pair');
});

test('the cost side needs a consequence: an unhandled objection or a missed opportunity on a CLOSED call does not qualify; the pair\'s floor, closer-DQ and leaving exclusions hold', () => {
  const calls = [
    call('c1', '2026-09-04', 'closed', [H({ type: 'objection', resolution: 'unhandled' }), H({ type: 'missed_opportunity', speaker: 'CLOSER' })]),
    call('c2', '2026-09-03', 'lost', [H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 100 }), H({ type: 'disqualify_signal', timestamp_seconds: 200 })]),
    call('c3', '2026-09-02', 'lost', [H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 100 }), H({ type: 'disqualify_signal', timestamp_seconds: 2000, speaker: 'CLOSER' })]),
    call('c4', '2026-09-01', 'lost', [H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 100 }), H({ type: 'prospect_left', timestamp_seconds: 2000 })]),
  ];
  assert.deepStrictEqual(C.selectCoachableMoments(calls), []);
});

test('the consequence is stated in code, never a principle; the wording guard holds', () => {
  const calls = [
    call('c1', '2026-09-04', 'lost', [H({ type: 'objection', resolution: 'unhandled', quote: 'I need to think about it' })]),
    call('c2', '2026-09-03', 'lost', [H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 100 }), H({ type: 'disqualify_signal', timestamp_seconds: 2000 })]),
    call('c3', '2026-09-02', 'closed', [H({ type: 'buying_signal', cause: CAUSE })]),
  ];
  const out = C.selectCoachableMoments(calls);
  const byKind = {}; out.forEach((i) => { byKind[i.kind] = i; });
  assert.strictEqual(byKind.objection_unhandled.consequence, 'The call did not close.');
  assert.match(byKind.missed_signal_pair.consequence, /^31 min later, a disqualification\.$/);
  assert.strictEqual(byKind.earned_signal.consequence, 'The call closed.');
  out.forEach((i) => assert.ok(!/foreshadow|caused|led to|because/.test(JSON.stringify(i)), 'wording guard: ' + i.kind));
});

test('an empty input is an empty list — the caller renders the rep with zero, never drops them', () => {
  assert.deepStrictEqual(C.selectCoachableMoments([]), []);
  assert.deepStrictEqual(C.selectCoachableMoments([call('c1', '2026-09-04', 'lost', [H({ type: 'rapport_moment' })])]), []);
});

test('the kinds carry plain-language labels and the tiers are the approved orders', () => {
  assert.deepStrictEqual(C.COST_ORDER, ['missed_signal_pair', 'objection_unhandled', 'missed_opportunity']);
  assert.deepStrictEqual(C.FORWARD_ORDER, ['earned_signal', 'objection_handled', 'signal_addressed', 'strong_moment']);
  C.COST_ORDER.concat(C.FORWARD_ORDER).forEach((k) => assert.ok(C.KIND_LABELS[k] && !/_/.test(C.KIND_LABELS[k]), 'label for ' + k));
  assert.deepStrictEqual(C.DEFAULTS, { perRep: 5, cost: 3, forward: 2 });
});
