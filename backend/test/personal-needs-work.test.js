// Tests for the PERSONAL "What needs work" math (A-2.1) — the core run with
// subject:'personal', the softer bucket floor (4), the TEAM-BORROWED money
// coefficients (injected), the degrade ladder (money → rate_gap → insufficient),
// and the raw-counts-beside-rates copy (ruling 4). Pure core, no DB/Claude.
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const nw = require('../lib/team-needs-work');

// One closer: a weak "Think" bucket (1 of 4 handled = 25%) vs a strong "Price"
// bucket (4 of 5 = 80%). 8 analyzed calls, only 2 closed → the closer's OWN
// linkage can't back a money claim (groups < 10, closed < 5).
function personalFixture() {
  var analyses = [];
  for (var i = 1; i <= 8; i++) analyses.push({ fathom_call_id: 'c' + i, status: 'done', outcome: (i === 1 || i === 5) ? 'closed' : 'follow_up', cash_collected: (i === 1 || i === 5) ? 4000 : 0 });
  var objs = [
    { call_id: 'c1', surface: 'think', handled: true, quote: 'let me think' },
    { call_id: 'c2', surface: 'think', handled: false, quote: 'need to think about it' },
    { call_id: 'c3', surface: 'think', handled: false, quote: 'a few days' },
    { call_id: 'c4', surface: 'think', handled: false, quote: 'sleep on it' },
    { call_id: 'c5', surface: 'price', handled: true },
    { call_id: 'c6', surface: 'price', handled: true },
    { call_id: 'c7', surface: 'price', handled: true },
    { call_id: 'c8', surface: 'price', handled: true },
    { call_id: 'c1', surface: 'price', handled: false },
  ];
  var mapping = { think: 'Think about it', price: 'Price' };
  var opts = { subject: 'personal', minBucket: nw._PERSONAL_MIN_BUCKET, minAnalyzed: nw._PERSONAL_MIN_ANALYZED };
  return { analyses: analyses, objs: objs, mapping: mapping, opts: opts };
}

test('personal exports + softer floors', () => {
  assert.strictEqual(typeof nw.computePersonalNeedsWork, 'function');
  assert.strictEqual(nw._PERSONAL_MIN_BUCKET, 4);
  assert.strictEqual(nw._PERSONAL_MIN_ANALYZED, 3);
});

test('personal rate-gap when own data cannot back a money claim (no borrow)', () => {
  var f = personalFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  assert.strictEqual(r.state, 'rate_gap');
  assert.strictEqual(r.bucket.label, 'Think about it');
  assert.strictEqual(r.bucket.handled, 1);
  assert.strictEqual(r.bucket.total, 4);
  assert.strictEqual(r.bucket.rate_pct, 25);
  assert.strictEqual(r.extra.extra_cash, null); // no money without backing
  assert.match(r.card_text, /You handled/);          // personal voice
  assert.match(r.card_text, /1 of 4 times \(25%\)/);  // raw counts beside the rate (ruling 4)
  assert.ok(!/\$/.test(r.card_text));                 // no money figure
});

test('personal MONEY via TEAM-BORROWED coefficients (own data too thin)', () => {
  var f = personalFixture();
  // Team pooled: strong sample that passes every money gate.
  var injected = { delta: 0.30, avgCash: 5000, handledN: 40, notHandledN: 60, closedCount: 15, pH: 0.5, pN: 0.2 };
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, Object.assign({ injected: injected }, f.opts));
  assert.strictEqual(r.state, 'money');
  assert.strictEqual(r.extra.borrowed, true);
  assert.strictEqual(r.detail.linkage.borrowed, true);
  assert.ok(r.extra.extra_cash > 0);
  // addHandled = 0.8*4 - 1 = 2.2 ; deals = round(2.2*0.30)=1 ; cash = round(0.66*5000/100)*100 = 3300
  assert.strictEqual(nw._computeNeedsWork(f.objs, f.analyses, f.mapping, Object.assign({ injected: injected }, f.opts)).bucket.rate_pct, 25);
  assert.match(r.card_text, /1 of 4 times \(25%\)/);           // raw counts still shown
  assert.match(r.card_text, /based on your team’s typical deal size/); // plain borrow phrasing (ruling 3)
  assert.match(r.card_text, /\$\d/);
});

test('personal MIN_BUCKET=4: a bucket of exactly 4 qualifies (team floor of 6 would reject)', () => {
  var f = personalFixture(); // Think bucket is exactly 4
  var personal = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, f.opts);
  assert.notStrictEqual(personal.state, 'insufficient'); // 4 clears personal floor
  var team = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, {}); // default team floor 6
  assert.strictEqual(team.state, 'insufficient');        // 4 < 6 → team rejects
});

test('personal insufficient when no bucket reaches 4', () => {
  var analyses = [];
  for (var i = 1; i <= 6; i++) analyses.push({ fathom_call_id: 'c' + i, status: 'done', outcome: 'follow_up', cash_collected: 0 });
  var objs = [
    { call_id: 'c1', surface: 'a', handled: false }, { call_id: 'c2', surface: 'a', handled: false }, { call_id: 'c3', surface: 'a', handled: false },
    { call_id: 'c4', surface: 'b', handled: false }, { call_id: 'c5', surface: 'b', handled: true },
  ];
  var r = nw._computeNeedsWork(objs, analyses, { a: 'A', b: 'B' }, { subject: 'personal', minBucket: 4, minAnalyzed: 3 });
  assert.strictEqual(r.state, 'insufficient');
  assert.match(r.card_text, /weak spot for you yet|Not enough of your objections/);
});

test('computeLinkage: delta = P(closed|handled) − P(closed|not-handled)', () => {
  var analyses = [
    { fathom_call_id: 'k1', outcome: 'closed', cash_collected: 1000 },
    { fathom_call_id: 'k2', outcome: 'follow_up', cash_collected: 0 },
  ];
  var objs = [
    { call_id: 'k1', handled: true },   // handled → closed
    { call_id: 'k2', handled: false },  // not-handled → not closed
  ];
  var lk = nw._computeLinkage(objs, analyses);
  assert.strictEqual(lk.pH, 1);   // 1/1 handled closed
  assert.strictEqual(lk.pN, 0);   // 0/1 not-handled closed
  assert.strictEqual(lk.delta, 1);
  assert.strictEqual(lk.avgCash, 1000);
});

test('team path unchanged: default opts still say "Your team" + no personal floor', () => {
  var f = personalFixture();
  var r = nw._computeNeedsWork(f.objs, f.analyses, f.mapping, {}); // team defaults
  // Think(4) < team MIN_BUCKET(6) → insufficient (proves team floor intact)
  assert.strictEqual(r.state, 'insufficient');
  assert.match(r.card_text, /objection volume this period/); // team copy, not personal
});
