/**
 * THE "WHY" COPY — EVEN ONE OBJECTION IS DATA (Justin's ruling 2026-08-29).
 *
 * The panel used to DECLINE TO RANK whenever the sample was small and then
 * report the declining as though it were the finding: "not enough data to
 * pinpoint a focus area", "no single type has enough volume to rank", "no type
 * is more than 5 points below your average". Every one of those is a statement
 * about OUR OWN BAR, not about the rep — and the last one dresses a declined
 * ranking as an even distribution.
 *
 * Wherever there is any data at all the copy now says what it shows. A genuine
 * empty state is reserved for genuinely NO objections.
 *
 * ⚠ THIS GUARD EXISTS SO A FUTURE EDIT CANNOT PUT A THRESHOLD OR A MECHANISM
 * BACK INTO A CUSTOMER-FACING STRING. It drives the REAL function and reads the
 * real card_text — not the source — because what matters is what renders.
 */
const test = require('node:test');
const assert = require('node:assert');

const nw = require('../lib/team-needs-work');

/* The fixture shape the existing state tests use — a flat surface->label map
   and {call_id, surface, handled} rows. An invented shape silently produced
   ZERO counted objections and every case fell into the empty branch, which
   would have made this whole guard pass while measuring nothing. */
function mk(buckets, analyzedCount) {
  const objs = [];
  const mapping = {};
  let n = 0;
  Object.keys(buckets).forEach(function (label) {
    const b = buckets[label];
    const surface = label.toLowerCase();
    mapping[surface] = label;
    for (let i = 0; i < b.total; i++) {
      objs.push({ call_id: 'c' + (n % Math.max(1, analyzedCount)), surface: surface, handled: i < b.handled });
      n++;
    }
  });
  const analyses = [];
  for (let i = 0; i < analyzedCount; i++) analyses.push({ fathom_call_id: 'c' + i, outcome: 'lost', cash_collected: 0 });
  return { objs: objs, analyses: analyses, mapping: mapping };
}

const PERSONAL = { subject: 'personal', minBucket: nw._PERSONAL_MIN_BUCKET,
                   minAnalyzed: nw._PERSONAL_MIN_ANALYZED, windowDays: 30 };

function textFor(buckets, analysed, opts) {
  const f = mk(buckets, analysed);
  return nw._computeNeedsWork(f.objs, f.analyses, f.mapping, Object.assign({}, PERSONAL, opts || {}));
}

/* ── the three states ─────────────────────────────────────────────────────── */

test('A · genuinely NO objections is the only true empty state', () => {
  const r = textFor({}, 40);
  assert.strictEqual(r.state, 'no_volume');
  assert.match(r.card_text, /No objections came up/,
    'with zero objections, say so plainly');
  assert.match(r.card_text, /in the 30 days you selected/,
    'and name the window — it is a fact about the RANGE, not a verdict on the rep');
});

test('B · a FEW objections are still data — name the type and the rate', () => {
  // objections exist, but too few analysed calls to single one out
  const r = textFor({ 'Timing': { total: 3, handled: 1 } }, 4);
  assert.match(r.card_text, /only a few objections/, 'the smallness belongs to the DATA');
  assert.match(r.card_text, /The most common is Timing/, 'name the type');
  assert.match(r.card_text, /handled 1 of 3/, 'name the rate, with its counts');
  assert.ok(!/not enough|pinpoint a focus area/i.test(r.card_text),
    'it must not report the declining as the finding');
});

test('B · never asserts a ranking a tiny sample cannot support', () => {
  const r = textFor({ 'Timing': { total: 3, handled: 1 } }, 4);
  /* ⚠ Justin's addition: "your lowest" implies a ranking 3 calls cannot carry.
     FREQUENCY is countable at any n; "worst" or "weakest" is not. */
  assert.ok(!/your lowest|weakest|worst/i.test(r.card_text),
    'a tiny sample may report the MOST COMMON, never the worst');
});

test('C · level handling is a FINDING, stated with its evidence', () => {
  const r = textFor({ 'Price / too expensive': { total: 20, handled: 6 },
                      'Spouse / partner approval': { total: 20, handled: 6 },
                      'Trust / proof': { total: 20, handled: 6 } }, 60);
  assert.strictEqual(r.state, 'even_performance');
  assert.match(r.card_text, /running level across types/, 'state the result');
  /* the evidence clause — a ranking IS supported here, enough data was compared.
     ⚠ When the two rates are EQUAL after rounding the contrast is dropped, or
     the sentence contrasts a number with itself. Both forms are evidence. */
  assert.ok(/The lowest is .+ at \d+%, against \d+% everywhere else/.test(r.card_text)
            || /Every type is close to \d+%/.test(r.card_text),
    'it must state the evidence: ' + r.card_text);
});

/* ── the guard: no threshold, no mechanism, in any customer string ────────── */

const MECHANISM = [
  /points below/i, /\baverage\b/i, /\bbaseline\b/i,     // the threshold and its maths
  /enough volume/i, /to rank\b/i, /to compare\b/i,      // the declined comparison
  /\bbucket/i, /\bthreshold/i, /\bgap\b/i, /\bpp\b/,    // internal vocabulary
  /\bnull\b/i, /undefined/i, /\bstate\b/i,
];

test('no customer-facing string names a threshold or a mechanism', () => {
  const cases = [
    ['A  empty',        textFor({}, 40)],
    ['B  few calls',    textFor({ 'Timing': { total: 3, handled: 1 } }, 4)],
    ['B  thin types',   textFor({ 'Timing': { total: 3, handled: 1 },
                                  'Price / too expensive': { total: 2, handled: 1 } }, 40)],
    ['C  level',        textFor({ 'Price / too expensive': { total: 20, handled: 6 },
                                  'Spouse / partner approval': { total: 20, handled: 6 },
                                  'Trust / proof': { total: 20, handled: 6 } }, 60)],
    ['D  a real focus', textFor({ 'Price / too expensive': { total: 20, handled: 2 },
                                  'Spouse / partner approval': { total: 20, handled: 16 } }, 60)],
  ];
  // the check must be MEASURING something — a silent pass over empty strings is
  // the failure mode this whole file exists to prevent
  cases.forEach(([name, r]) => {
    assert.ok(typeof r.card_text === 'string' && r.card_text.length > 20,
      name + ': no card_text to check — the guard is not measuring');
    MECHANISM.forEach(re => {
      assert.ok(!re.test(r.card_text),
        name + ': customer copy names a mechanism ' + re + ' — "' + r.card_text + '"');
    });
  });
});

test('the TEAM lane keeps its own wording and never borrows the personal window', () => {
  const f = mk({ 'Timing': { total: 3, handled: 1 } }, 4);
  const r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, { subject: 'team', windowDays: 30 });
  assert.match(r.card_text, /this period/, 'the team lane says "this period"');
  assert.ok(!/you selected/.test(r.card_text),
    'and never the personal window phrase — pre-existing and deliberate');
});
