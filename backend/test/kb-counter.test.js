/**
 * KNOWLEDGE BASE — "data points collected today" (2026-08-20).
 *
 * ⚠⚠ ZERO IS THE WHOLE DESIGN PROBLEM. "0 collected today" reads identically
 * whether nothing was harvested or the harvester is broken, and a data problem
 * rendering as good news is the failure this module exists to prevent.
 */
const test = require('node:test');
const assert = require('node:assert');
const kb = require('../lib/kb-counter');

test('⚠⚠ a REAL zero is distinguished from NOTHING TO HARVEST FROM', () => {
  const nothingAnalysed = kb.buildCounter({ analysedToday: 0, closedToday: 0, harvested: 0 });
  assert.strictEqual(nothingAnalysed.state, 'no_calls');
  assert.notStrictEqual(nothingAnalysed.headline, '0');

  const analysedNoneClosed = kb.buildCounter({ analysedToday: 5, closedToday: 0, harvested: 0 });
  assert.strictEqual(analysedNoneClosed.state, 'none_eligible',
    'harvest gates on outcome=closed, so 5 analysed and 0 closed is not a real zero');
  assert.notStrictEqual(analysedNoneClosed.state, nothingAnalysed.state);
});

test('⚠⚠ CLOSED CALLS BUT NOTHING COLLECTED IS AMBIGUOUS AND MUST SAY SO', () => {
  /* Phase 7b is fire-and-forget with a SWALLOWED catch — nothing records that a
     harvest was attempted. So "a closed call was analysed and produced no rows"
     is EITHER "it had no good moments" OR "the harvest errored", and the two
     are INDISTINGUISHABLE from what is stored. It must not render as a plain
     zero, which would report a possible failure as good news. */
  const r = kb.buildCounter({ analysedToday: 3, closedToday: 2, harvested: 0 });
  assert.strictEqual(r.state, 'unexplained_zero');
  assert.strictEqual(r.needsAttention, true,
    'this state is not good news and must not be styled as if it were');
  assert.ok(/couldn't be confirmed|not confirmed|check/i.test(r.detail),
    'the copy must say the number is unconfirmed, not assert nothing was found');
});

test('a genuine collection reports the count with its context', () => {
  const r = kb.buildCounter({ analysedToday: 4, closedToday: 2, harvested: 7 });
  assert.strictEqual(r.state, 'collected');
  assert.strictEqual(r.headline, '7');
  assert.strictEqual(r.needsAttention, false);
  assert.ok(/2 closed/.test(r.detail), 'raw counts beside the number, per the house rule');
});

test('⚠ the four states are exhaustive and mutually exclusive', () => {
  const seen = new Set();
  [[0,0,0],[5,0,0],[3,2,0],[4,2,7],[2,1,1]].forEach(([a,c,h]) => {
    const r = kb.buildCounter({ analysedToday:a, closedToday:c, harvested:h });
    assert.ok(kb.STATES.indexOf(r.state) !== -1, 'unknown state ' + r.state);
    seen.add(r.state);
  });
  assert.strictEqual(seen.size, 4, 'all four states reachable');
});

test('⚠⚠ the ET day convention is REUSED, never redefined', () => {
  const digest = require('../lib/team-digest');
  assert.strictEqual(kb.etDateOf, digest.etDateOf,
    'the counter must import the digest\'s ET helper — two surfaces disagreeing '
    + 'about when a day starts is two defensible answers on one screen');
  assert.strictEqual(kb.dayBoundsUtc, digest.etDayBoundsUtc);
});

test('⚠ PER-USER, never account-wide (standing ruling: features are per-person)', () => {
  assert.strictEqual(kb.COUNTER_SCOPE, 'per_user');
});
