/**
 * The objection-handled predicate (Justin's ruling 2026-08-17).
 *
 * "Objections are just barriers to a close, so if they side-step the barrier and
 * still close, that's a win in my book."
 *
 *   handled = resolution === 'handled'  OR  the call's outcome === 'closed'
 *
 * ⚠ IT IS BINARY. `partial` scores ZERO. That is the ruling, not an oversight —
 * half-credit was considered and rejected.
 *
 * ⚠ THIS EXISTS AS ONE FUNCTION BECAUSE TEN SURFACES ASK THE QUESTION. Written
 * out ten times it would drift, and the drift would show up as two different
 * handle rates on one screen — which is how a manager stops trusting the page.
 */
const test = require('node:test');
const assert = require('node:assert');
const H = require('../lib/objection-handled');

test('strict resolution still counts, on any outcome', () => {
  ['closed', 'lost', 'follow_up', 'no_show', null, undefined].forEach(function (o) {
    assert.strictEqual(H.isHandled({ resolution: 'handled' }, o), true, String(o));
  });
});

test('⚠ PARTIAL DOES NOT COUNT — the ruling is binary', () => {
  assert.strictEqual(H.isHandled({ resolution: 'partial' }, 'lost'), false);
  assert.strictEqual(H.isHandled({ resolution: 'partial' }, 'follow_up'), false);
});

test('a CLOSED call credits every objection on it, whatever the resolution', () => {
  ['partial', 'unhandled', null, undefined, 'nonsense'].forEach(function (r) {
    assert.strictEqual(H.isHandled({ resolution: r }, 'closed'), true, String(r));
  });
});

test('a non-closed outcome credits nothing on its own', () => {
  ['lost', 'follow_up', 'no_show', null, undefined, ''].forEach(function (o) {
    assert.strictEqual(H.isHandled({ resolution: 'unhandled' }, o), false, String(o));
  });
});

test('⚠ CREDITED is distinguishable from strictly handled — the badge depends on it', () => {
  // The Objections view shows handled · partial · unhandled BESIDE the rate. If
  // credited moments were invisible the counts would not add up to the rate on
  // the same screen, and that is exactly what makes a number look wrong.
  assert.strictEqual(H.isCredited({ resolution: 'unhandled' }, 'closed'), true);
  assert.strictEqual(H.isCredited({ resolution: 'partial' }, 'closed'), true);
  assert.strictEqual(H.isCredited({ resolution: 'handled' }, 'closed'), false,
    'already handled on its own merit — not a credit');
  assert.strictEqual(H.isCredited({ resolution: 'unhandled' }, 'lost'), false);
});

test('handled = strict OR credited, with no overlap — the counts must reconcile', () => {
  const cases = [
    ['handled', 'closed'], ['handled', 'lost'], ['partial', 'closed'],
    ['partial', 'lost'], ['unhandled', 'closed'], ['unhandled', null],
  ];
  cases.forEach(function (c) {
    const row = { resolution: c[0] };
    const strict = c[0] === 'handled';
    const credited = H.isCredited(row, c[1]);
    assert.ok(!(strict && credited), 'a moment can never be both: ' + c.join('/'));
    assert.strictEqual(H.isHandled(row, c[1]), strict || credited, c.join('/'));
  });
});

test('a missing or malformed row is not handled — never throws', () => {
  [null, undefined, {}, 'x', 7].forEach(function (r) {
    assert.strictEqual(H.isHandled(r, 'lost'), false, String(r));
  });
  // ⚠ but a closed call still credits, even with a junk row — the credit comes
  // from the CALL, not from the moment.
  assert.strictEqual(H.isHandled({}, 'closed'), true);
});

test('outcomeMap builds a call→outcome lookup from analyses rows', () => {
  const m = H.outcomeMap([
    { fathom_call_id: 'a', outcome: 'closed' },
    { fathom_call_id: 'b', outcome: 'lost' },
    null, { outcome: 'closed' }, { fathom_call_id: 'c' },
  ]);
  assert.strictEqual(m.a, 'closed');
  assert.strictEqual(m.b, 'lost');
  assert.strictEqual(m.c, null, 'a row with no outcome maps to null, not undefined');
  assert.deepStrictEqual(H.outcomeMap(null), {}, 'never throws on bad input');
});

test('countObjections returns every count the badge and the rate both need', () => {
  const rows = [
    { fathom_call_id: 'a', resolution: 'handled' },    // strict
    { fathom_call_id: 'a', resolution: 'partial' },    // credited (a closed)
    { fathom_call_id: 'b', resolution: 'handled' },    // strict
    { fathom_call_id: 'b', resolution: 'unhandled' },  // not handled
    { fathom_call_id: 'b', resolution: 'partial' },    // not handled
  ];
  const c = H.countObjections(rows, { a: 'closed', b: 'lost' });
  assert.strictEqual(c.total, 5);
  assert.strictEqual(c.strict, 2);
  assert.strictEqual(c.credited, 1);
  assert.strictEqual(c.handled, 3, 'strict + credited');
  assert.strictEqual(c.partial, 1, 'partial NOT already credited');
  assert.strictEqual(c.unhandled, 1);
  assert.strictEqual(c.strict + c.credited + c.partial + c.unhandled, c.total,
    'the four displayed buckets must sum to the total, or the badge lies');
  assert.strictEqual(c.rate, 60);
});

test('an empty set yields a NULL rate, never 0%', () => {
  const c = H.countObjections([], {});
  assert.strictEqual(c.total, 0);
  assert.strictEqual(c.rate, null, '0% would claim "handled nothing" where there was nothing to handle');
});
