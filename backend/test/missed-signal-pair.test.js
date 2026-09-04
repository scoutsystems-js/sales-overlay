// The missed-signal pair (H720) — Justin's own coachable example, as a computation
// on stored rows: an EARLY risk signal or barrier the closer ignored or deflected,
// and a LATER disqualification on the same call. Both ends quoted and timestamped,
// the gap stated. "When she said she was living paycheck to paycheck you rolled
// over it, and later after the pitch you realised she was a financial DQ."
//
// The same move as tying back in, inverted: there a disclosure used well at the
// close; here a disclosure missed and paid for. One vocabulary, two outcomes.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/missed-signal-pair');

const H = (o) => Object.assign({ id: 'h' + Math.random(), speaker: 'PROSPECT', speaker_verified: true, section: 'discovery', quote: 'q', observation: 'o' }, o);

test('an ignored risk signal before a later DQ on the same call is a pair, both ends carried, gap stated', () => {
  const rows = [
    H({ id: 'a', type: 'risk_signal', handling: 'ignored', timestamp_seconds: 300, quote: 'we are living paycheck to paycheck honestly', closer_response: '__no_reply__' }),
    H({ id: 'b', type: 'buying_signal', timestamp_seconds: 900 }),
    H({ id: 'c', type: 'disqualify_signal', timestamp_seconds: 2400, section: 'close', quote: 'I just do not have the money for this right now' }),
  ];
  const pairs = P.findMissedSignalPairs(rows);
  assert.strictEqual(pairs.length, 1);
  const p = pairs[0];
  assert.strictEqual(p.signal.id, 'a'); assert.strictEqual(p.signal.timestamp_seconds, 300); assert.strictEqual(p.signal.handling, 'ignored');
  assert.strictEqual(p.dq.id, 'c'); assert.strictEqual(p.dq.timestamp_seconds, 2400);
  assert.strictEqual(p.gap_seconds, 2100);
  assert.strictEqual(p.signal.quote, 'we are living paycheck to paycheck honestly');
});

test('addressed is not a miss; a signal AFTER the DQ is not a miss; a signal too close to the DQ is not a miss (the floor)', () => {
  const dq = H({ id: 'dq', type: 'disqualify_signal', timestamp_seconds: 2400 });
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'risk_signal', handling: 'addressed', timestamp_seconds: 300 }), dq]).length, 0);
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'risk_signal', handling: 'ignored', timestamp_seconds: 2500 }), dq]).length, 0);
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 2400 - P.MIN_GAP_SECONDS + 1 }), dq]).length, 0);
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'risk_signal', handling: 'deflected', timestamp_seconds: 2400 - P.MIN_GAP_SECONDS }), dq]).length, 1);
});

test('a barrier counts; a NULL handling (pre-v8a) does not — absence is not "ignored"; a closer-spoken row never pairs', () => {
  const dq = H({ id: 'dq', type: 'disqualify_signal', timestamp_seconds: 2400 });
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'barrier', handling: 'deflected', timestamp_seconds: 300 }), dq]).length, 1);
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'risk_signal', handling: null, timestamp_seconds: 300 }), dq]).length, 0);
  assert.strictEqual(P.findMissedSignalPairs([H({ type: 'risk_signal', handling: 'ignored', timestamp_seconds: 300, speaker: 'CLOSER' }), dq]).length, 0);
});

test('several missed signals before one DQ each pair with it; two DQs pair with the signals before each; the same signal is never paired twice', () => {
  const rows = [
    H({ id: 's1', type: 'risk_signal', handling: 'ignored', timestamp_seconds: 100 }),
    H({ id: 's2', type: 'barrier', handling: 'deflected', timestamp_seconds: 600 }),
    H({ id: 'd1', type: 'disqualify_signal', timestamp_seconds: 1500 }),
    H({ id: 's3', type: 'risk_signal', handling: 'ignored', timestamp_seconds: 1600 }),
    H({ id: 'd2', type: 'disqualify_signal', timestamp_seconds: 2600 }),
  ];
  const pairs = P.findMissedSignalPairs(rows);
  assert.deepStrictEqual(pairs.map((p) => p.signal.id + '>' + p.dq.id), ['s1>d1', 's2>d1', 's3>d2']);
});

test('the pair carries no judgement of its own: what it says is derived from stored fields and the gap, nothing inferred', () => {
  const rows = [H({ id: 'a', type: 'risk_signal', handling: 'deflected', timestamp_seconds: 300, closer_response: 'Totally get it, so anyway the program is', closer_response_verified: true }), H({ id: 'c', type: 'disqualify_signal', timestamp_seconds: 2400 })];
  const p = P.findMissedSignalPairs(rows)[0];
  assert.strictEqual(p.signal.closer_response, 'Totally get it, so anyway the program is');
  assert.strictEqual(p.signal.closer_response_verified, true);
  assert.ok(!('coaching' in p), 'no coaching text is composed here');
  assert.strictEqual(P.gapLabel(2100), '35 min');
  assert.strictEqual(P.gapLabel(90), '1 min 30 s');
});

test('a DQ the CLOSER speaks is the closer acting on the flag, not missing it — never a pair', () => {
  const rows = [H({ type: 'risk_signal', handling: 'ignored', timestamp_seconds: 300 }), H({ id: 'dq', type: 'disqualify_signal', timestamp_seconds: 2400, speaker: 'CLOSER', quote: 'our conversation is a little premature right now' })];
  assert.strictEqual(P.findMissedSignalPairs(rows).length, 0);
});

test('pairSentence is assembled from the two ends and the gap and states no principle', () => {
  const p = { signal: { timestamp_seconds: 183, quote: 'I invested money in things that did not work out', closer_response: 'I am not just a salesperson', closer_response_verified: true }, dq: { timestamp_seconds: 2388, quote: 'even 20 grand, I do not have it' }, gap_seconds: 2205 };
  const s = P.pairSentence(p);
  assert.strictEqual(s, 'At 00:03:03 the prospect said "I invested money in things that did not work out". The closer replied "I am not just a salesperson" and moved on. At 00:39:48 the prospect said "even 20 grand, I do not have it". 36 min between the flag and the disqualification it foreshadowed.');
  assert.ok(!/gotta|should|must/.test(s));
  assert.strictEqual(P.pairSentence({ signal: { timestamp_seconds: 1, quote: 'q', closer_response: '__no_reply__' }, dq: { timestamp_seconds: 400, quote: 'd' }, gap_seconds: 399 }).indexOf('The closer did not reply.') > 0, true);
});
