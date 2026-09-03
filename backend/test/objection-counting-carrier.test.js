// ⚠⚠ ONE DEFINITION OF WHAT COUNTS AS AN OBJECTION, PINNED PER CALL SITE.
//
// Justin (2026-09-02): "An objection is someone's reasoning for not being able
// to purchase. This only comes at the end of a call, after pitch and price drop."
// The extractor already types pre-price doubt as risk_signal (v37 prompt). The
// COUNTING is the one definition: lib/objection-strict.js countsAsObjection —
// a row with no class (pre-v37) counts; a stored class counts only when it is
// 'true_objection'. Sweep block 6 (H671) found THREE answers: the shared
// predicate on two surfaces, an inline re-implementation with a classifier
// fallback on the team Objections page, and none at all on the personal
// Objections page — plus a select that never fetched the column it read.
//
// ⚠ EVERY TEST HERE EXECUTES THE SITE with four planted rows — no class, a
// true objection, a logistical barrier, a disqualification — and asserts the
// DENOMINATOR IS TWO. That assertion fails when the call is removed AND when
// the call is kept and its answer ignored (the standing rule, H666); both
// plants were run against this file before it shipped (see H674).
// The select pins run on the comment-STRIPPED source through the one shared
// stripper, so a commented-out column fails them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const ta = require('../lib/team-analytics');
const { buildRepSeries } = require('../lib/rep-series');
const { computeTeamObjections } = require('../lib/team-objections');
const { computeObjectionIntel } = require('../lib/session-analytics');

const FROM = '2026-08-03T00:00:00Z', TO = '2026-08-23T00:00:00Z', WK1 = '2026-08-05T10:00:00Z';
function fourRows(callId) {
  return [
    { id: 'h0', fathom_call_id: callId, type: 'objection', resolution: 'unhandled', objection_category: 'fear', objection_surface: 'too expensive', objection_class: null, timestamp_seconds: 100, quote: 'q0', speaker: 'prospect' },
    { id: 'h1', fathom_call_id: callId, type: 'objection', resolution: 'unhandled', objection_category: 'fear', objection_surface: 'need to think', objection_class: 'true_objection', timestamp_seconds: 200, quote: 'q1', speaker: 'prospect' },
    { id: 'h2', fathom_call_id: callId, type: 'objection', resolution: 'unhandled', objection_category: 'logistical', objection_surface: 'travelling next month', objection_class: 'logistical_barrier', timestamp_seconds: 300, quote: 'q2', speaker: 'prospect' },
    { id: 'h3', fathom_call_id: callId, type: 'objection', resolution: 'unhandled', objection_category: 'fear', objection_surface: 'cant afford it', objection_class: 'disqualification', timestamp_seconds: 400, quote: 'q3', speaker: 'prospect' },
  ];
}
// Every chain method returns the chain; awaiting resolves the table's seeded rows
// (filters ignored — the fixtures are pre-scoped). maybeSingle resolves the first
// row so a seeded cache row can be served to the team page.
function fakeAdmin(tables) {
  return {
    from(table) {
      var data = tables[table] || [];
      var cols = null;   // ⚠ the fake PROJECTS the selected columns — an unselected column is undefined, exactly as on the wire (the ④a-1 defect)
      var project = function (rows) { if (!cols) return rows; return rows.map(function (r) { var o = {}; cols.forEach(function (c) { if (c in r) o[c] = r[c]; }); return o; }); };
      var chain = {
        select(list) { if (typeof list === 'string' && list.trim() !== '*') cols = list.split(',').map(function (c) { return c.trim().split(':')[0].split('(')[0].trim(); }).filter(Boolean); return chain; }, in() { return chain; }, eq() { return chain; }, neq() { return chain; },
        not() { return chain; }, is() { return chain; }, gte() { return chain; }, lte() { return chain; }, lt() { return chain; }, gt() { return chain; },
        order() { return chain; }, range() { return chain; }, limit() { return chain; },
        maybeSingle() { return Promise.resolve({ data: project(data)[0] || null, error: null }); },
        upsert() { return Promise.resolve({ error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: project(data), error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}
const CALLS = [{ id: 'c1', user_id: 'A', fathom_call_id: 'real-1', call_date: WK1, duration_seconds: 1800, title: 'Call', recording_url: null, source: 'fathom', prospect_id: 'p1' }];
const ANALYSES = [{ fathom_call_id: 'c1', analyzed_at: WK1, overall_score: 70, outcome: 'lost', status: 'done', cash_collected: 0 }];

test('team-analytics (Performance cards, graph, gauges): 4 planted rows → denominator 2', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: fourRows('c1'), user_profiles: [], fathom_connections: [], call_connections: [] });
  var out = await ta.computeTeamAnalytics(admin, ['A'], FROM, TO, {});
  var rep = out.per_rep.find(function (r) { return r.user_id === 'A'; });
  assert.ok(rep, 'the rep row must exist');
  assert.strictEqual(rep.obj_total, 2, 'no-class + true_objection count; logistical_barrier and disqualification do not');
});

test('rep-series (the manager line graph): 4 planted rows → total 2 on the week', () => {
  var out = buildRepSeries({ reps: [{ user_id: 'A', name: 'Ava' }], calls: [{ id: 'c1', user_id: 'A', call_date: WK1 }], analyses: [{ fathom_call_id: 'c1', outcome: 'lost' }], objections: fourRows('c1'), from: FROM, to: TO, bucket: 'week' });
  var p = out.reps[0].handle[0];
  assert.strictEqual(p.total, 2);
});

test('team-objections (the team Objections page): a seeded classifier bucket that calls the no-class row a DQ must NOT exclude it — the one definition counts it', async () => {
  var cache = [{ synthesis: { mapping: { 'too expensive': 'Money' }, bucketClass: { Money: 'disqualification' }, generated_at: WK1 } }];
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: fourRows('c1'), objection_synthesis_cache: cache, user_profiles: [] });
  var out = await computeTeamObjections(admin, ['A'], FROM, TO, { keyId: 'A', emailMap: { A: 'a@x.io' }, nameMap: { A: 'Ava' } });
  assert.strictEqual(out.totals.total, 2, 'no-class + true_objection');
  assert.strictEqual(out.excluded.disqualifications, 1, 'the STORED disqualification is excluded and reported');
  assert.strictEqual(out.excluded.logistical, 1, 'the STORED logistical barrier is excluded and reported');
});

test('session-analytics (the personal Objections page): 4 planted rows → metrics.total 2', async () => {
  var admin = fakeAdmin({ fathom_calls: CALLS, call_analyses: ANALYSES, call_highlights: fourRows('c1') });
  var out = await computeObjectionIntel(admin, 'A', FROM, TO);
  assert.strictEqual(out.metrics.total, 2);
});

// ── the column reaches every site: select pins on STRIPPED source ─────────
[
  ['lib/team-analytics.js', /from\('call_highlights'\)\.select\('[^']*\bobjection_class\b[^']*'\)/],
  ['routes/team.js', /from\('call_highlights'\)\.select\('[^']*\bobjection_class\b[^']*'\)/],
  ['lib/session-analytics.js', /\.select\('[^']*\bobjection_class\b[^']*'\)/],
].forEach(function (pair) {
  test('⚠ ' + pair[0] + ' selects objection_class on the objection rows it counts (stripped source)', () => {
    var src = stripComments(fs.readFileSync(path.join(__dirname, '..', pair[0]), 'utf8'));
    assert.ok(pair[1].test(src), pair[0] + ' must name objection_class in the call_highlights select');
  });
});
test('⚠ every counting site calls the ONE predicate and none re-implements it (stripped source)', () => {
  ['lib/team-analytics.js', 'lib/rep-series.js', 'lib/team-objections.js', 'lib/session-analytics.js'].forEach(function (f) {
    var src = stripComments(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    assert.ok(/countsAsObjection\(/.test(src), f + ' must call countsAsObjection');
    assert.ok(!/objection_class\s*===\s*'true_objection'/.test(src), f + ' must not compare the class by hand');
  });
});
