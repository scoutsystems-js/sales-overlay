// lib/prospect-entity.js — the PROSPECT entity (3d-1).
//
// Close rate is now `closed PROSPECTS / TOTAL PROSPECTS`, so the grouping key
// and the rollup are load-bearing on the headline number. Two things must hold:
//   • nameKey groups the same person and separates different ones
//   • the rollup implements the ruling: a prospect is CLOSED if ANY of their
//     calls closed; open prospects COUNT in the denominator as not-closed.
const test = require('node:test');
const assert = require('node:assert');
const { nameKey, closeRate, prospectOutcome } = require('../lib/prospect-entity');

// ── nameKey ──────────────────────────────────────────────────────────────
test('nameKey normalizes case, whitespace and punctuation', () => {
  assert.strictEqual(nameKey('  Katina   GOSS '), nameKey('katina goss'));
  assert.strictEqual(nameKey("O'Brien"), nameKey('OBrien'));
  assert.strictEqual(nameKey('Mark-Anthony'), nameKey('mark anthony'));
});

test('nameKey keeps genuinely different people apart', () => {
  assert.notStrictEqual(nameKey('Jane Smith'), nameKey('John Smith'));
  assert.notStrictEqual(nameKey('Sam'), nameKey('Sam Walker'));  // merge candidate, NOT an auto-group
});

test('nameKey returns null for an unusable name — such calls get NO prospect', () => {
  // Governing principle: never invent an identity. A call with no resolved name
  // must have prospect_id NULL rather than joining an "Unknown" bucket, which
  // would merge every unidentified prospect into one and wreck the denominator.
  for (const v of [null, undefined, '', '   ', 42]) assert.strictEqual(nameKey(v), null);
});

// ── prospectOutcome — the ruling ─────────────────────────────────────────
test('a prospect is CLOSED if ANY of their calls closed', () => {
  assert.strictEqual(prospectOutcome(['follow_up', 'closed', 'follow_up']), 'closed');
  assert.strictEqual(prospectOutcome(['closed']), 'closed');
  // Even if a later call went badly — the deal was won.
  assert.strictEqual(prospectOutcome(['closed', 'lost']), 'closed');
});

test('else the most recent DECIDED outcome (arrays arrive oldest→newest)', () => {
  assert.strictEqual(prospectOutcome(['lost', 'follow_up']), 'lost');
  assert.strictEqual(prospectOutcome(['follow_up', 'lost']), 'lost');
});

test('else OPEN — and open is a real state, not a missing one', () => {
  assert.strictEqual(prospectOutcome(['follow_up', 'follow_up']), 'open');
  assert.strictEqual(prospectOutcome(['no_show']), 'open');
  assert.strictEqual(prospectOutcome([]), 'open');
  assert.strictEqual(prospectOutcome([null, undefined]), 'open');
});

// ── closeRate — the headline number ──────────────────────────────────────
test('RULING: closed prospects / TOTAL prospects (open counts as not-closed)', () => {
  const r = closeRate([
    { outcomes: ['closed'] }, { outcomes: ['closed'] },
    { outcomes: ['lost'] },
    { outcomes: ['follow_up'] }, { outcomes: ['follow_up'] },
  ]);
  assert.strictEqual(r.closed, 2);
  assert.strictEqual(r.total, 5);
  assert.strictEqual(r.pct, 40);
});

test('open prospects are NOT excluded — this is what removes the aging rule', () => {
  // Under the OLD decided-only formula this would read 100%. The whole point of
  // the redefinition is that a prospect who goes dark counts against you without
  // anyone having to judge when a deal died.
  const r = closeRate([{ outcomes: ['closed'] }, { outcomes: ['follow_up'] }, { outcomes: ['follow_up'] }]);
  assert.strictEqual(r.pct, 33);
  assert.strictEqual(r.closed + '/' + r.total, '1/3');
});

test('multi-call prospects count ONCE — Justin’s framing', () => {
  // "if 1 prospect takes 3 calls to close that SHOULDN'T count as 3 calls".
  const r = closeRate([{ outcomes: ['follow_up', 'follow_up', 'closed'] }, { outcomes: ['follow_up'] }]);
  assert.strictEqual(r.closed, 1);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.pct, 50);
});

test('closeRate is total and never divides by zero', () => {
  for (const v of [[], null, undefined, 'nope']) {
    const r = closeRate(v);
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.pct, null);   // null, never 0% — no prospects is not a 0% rate
  }
});

test('the display contract: counts always travel with the percentage', () => {
  // House rule — rates render with their raw counts ("12 of 37 prospects").
  const r = closeRate([{ outcomes: ['closed'] }, { outcomes: ['follow_up'] }]);
  assert.ok(typeof r.closed === 'number' && typeof r.total === 'number',
    'closeRate must return the counts, not just a percentage');
});

// ── rollupProspects — the shared computation every surface routes through ──
const { rollupProspects } = require('../lib/prospect-entity');

const call = (id, user, prospect, outcome, date) => ({ id, user_id: user, prospect_id: prospect, call_date: date, outcome });

test('rollup collapses a multi-call prospect into ONE entry', () => {
  const r = rollupProspects([
    call('c1', 'u1', 'p1', 'follow_up', '2026-07-01'),
    call('c2', 'u1', 'p1', 'follow_up', '2026-07-05'),
    call('c3', 'u1', 'p1', 'closed', '2026-07-09'),
  ], {});
  assert.strictEqual(r.u1.total, 1);
  assert.strictEqual(r.u1.closed, 1);
  assert.strictEqual(r.u1.pct, 100);
});

test('rollup follows merged_into so a merged prospect counts ONCE', () => {
  // p2 was merged into p1 by the review. Both its calls must roll into p1,
  // or the merge would silently fail to affect the headline number.
  const r = rollupProspects([
    call('c1', 'u1', 'p1', 'follow_up', '2026-07-01'),
    call('c2', 'u1', 'p2', 'closed', '2026-07-02'),
  ], { p2: 'p1' });
  assert.strictEqual(r.u1.total, 1);
  assert.strictEqual(r.u1.closed, 1);
});

test('rollup EXCLUDES calls with no prospect — never an Unknown bucket', () => {
  // Lumping unnamed calls together would merge every unidentified prospect into
  // one row and corrupt both halves of the rate.
  const r = rollupProspects([
    call('c1', 'u1', 'p1', 'closed', '2026-07-01'),
    call('c2', 'u1', null, 'closed', '2026-07-02'),
  ], {});
  assert.strictEqual(r.u1.total, 1);
  assert.strictEqual(r.u1.closed, 1);
});

test('rollup keeps users separate', () => {
  const r = rollupProspects([
    call('c1', 'u1', 'p1', 'closed', '2026-07-01'),
    call('c2', 'u2', 'p2', 'follow_up', '2026-07-01'),
  ], {});
  assert.strictEqual(r.u1.pct, 100);
  assert.strictEqual(r.u2.pct, 0);
  assert.strictEqual(r.u2.total, 1);
});

test('rollup returns counts with the percentage, and null pct when empty', () => {
  const r = rollupProspects([], {});
  assert.deepStrictEqual(r, {});
  const r2 = rollupProspects([call('c1', 'u1', 'p1', 'follow_up', '2026-07-01')], {});
  assert.strictEqual(r2.u1.pct, 0);      // an open prospect IS 0%, not null
  assert.strictEqual(r2.u1.total, 1);
});

test('rollup is total on junk', () => {
  for (const v of [null, undefined, 'nope', [null], [{}]]) {
    assert.strictEqual(typeof rollupProspects(v, null), 'object');
  }
});
