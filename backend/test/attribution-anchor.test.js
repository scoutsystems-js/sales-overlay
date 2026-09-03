/**
 * ATTRIBUTION (Justin's ruling 2026-09-03, H706): the rate's window is the BOOKED
 * call's date. A prospect booked in July and closed in August is closed IN JULY and
 * nowhere in August; a follow-up-marked first call does not anchor. Executed through
 * fetchProspectCloseRates against a range-aware fake carrying the live row shape.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchProspectCloseRates, windowByAnchor, anchorOf } = require('../lib/prospect-entity');

const CALLS = [
  { id: 'a1', user_id: 'A', fathom_call_id: 'f1', prospect_id: 'P1', call_date: '2026-07-20T10:00:00Z', call_kind: 'booked' },
  { id: 'a2', user_id: 'A', fathom_call_id: 'f2', prospect_id: 'P1', call_date: '2026-08-10T10:00:00Z', call_kind: 'follow_up' },   // the follow-up close
  { id: 'a3', user_id: 'A', fathom_call_id: 'f3', prospect_id: 'P2', call_date: '2026-08-05T10:00:00Z', call_kind: 'booked' },      // an August prospect, lost
  { id: 'a4', user_id: 'A', fathom_call_id: 'f4', prospect_id: 'P3', call_date: '2026-08-12T10:00:00Z', call_kind: null },          // pre-065 row: null kind anchors
];
const OUTCOMES = { a1: 'follow_up', a2: 'closed', a3: 'lost', a4: 'closed' };
function fakeAdmin() {
  return { from(table) {
    const chain = { _range: null, _in: null,
      select() { return chain; }, in(col, ids) { chain._in = ids; return chain; }, not() { return chain; }, is() { return chain; }, eq() { return chain; }, gte(c) { chain._gte = c; return chain; }, lte(c) { chain._lte = c; return chain; },
      range(a, b) { chain._range = [a, b]; return chain; },
      then(res) {
        let rows = [];
        if (table === 'fathom_calls') rows = CALLS.slice();
        if (table === 'call_analyses') rows = (chain._in || []).map((id) => ({ fathom_call_id: id, outcome: OUTCOMES[id] })).filter((r) => r.outcome);
        if (table === 'prospects') rows = [];
        if (chain._range) rows = rows.slice(chain._range[0], chain._range[1] + 1);
        res({ data: rows, error: null });
      } };
    return chain;
  } };
}

test('anchorOf: the earliest call that is not a follow-up; a null kind anchors; all follow-ups → the earliest of them', () => {
  assert.strictEqual(anchorOf(CALLS.slice(0, 2)), '2026-07-20T10:00:00Z');
  assert.strictEqual(anchorOf([CALLS[1]]), '2026-08-10T10:00:00Z');
  assert.strictEqual(anchorOf([CALLS[3]]), '2026-08-12T10:00:00Z');
});

test('⚠⚠ July window: the prospect booked in July is CLOSED in July — by its August follow-up close', async () => {
  const r = await fetchProspectCloseRates(fakeAdmin(), ['A'], '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z');
  assert.deepStrictEqual({ closed: r.A.closed, total: r.A.total, pct: r.A.pct }, { closed: 1, total: 1, pct: 100 });
});

test('⚠⚠ August window: the July prospect is NOWHERE; the August prospects count on their own', async () => {
  const r = await fetchProspectCloseRates(fakeAdmin(), ['A'], '2026-08-01T00:00:00Z', '2026-08-31T23:59:59Z');
  assert.deepStrictEqual({ closed: r.A.closed, total: r.A.total, pct: r.A.pct }, { closed: 1, total: 2, pct: 50 }, 'P2 lost + P3 closed; P1 attributed to July');
});

test('all-time is unchanged by attribution: every prospect once, any close wins', async () => {
  const r = await fetchProspectCloseRates(fakeAdmin(), ['A'], null, null);
  assert.deepStrictEqual({ closed: r.A.closed, total: r.A.total }, { closed: 2, total: 3 });
});

test('windowByAnchor keeps every call of a kept prospect, including calls outside the window (the close that attributes back)', () => {
  const kept = windowByAnchor(CALLS, '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z');
  assert.deepStrictEqual(kept.map((c) => c.id), ['a1', 'a2']);
  const plant = windowByAnchor(CALLS.map((c) => Object.assign({}, c, { call_kind: c.id === 'a1' ? 'follow_up' : c.call_kind })), '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z');
  assert.deepStrictEqual(plant.map((c) => c.id), ['a1', 'a2'], 'when every call is a follow-up the earliest still anchors');
});
