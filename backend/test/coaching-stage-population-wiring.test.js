'use strict';
// The Coaching cards, personal ranking, and drilldown must draw one verified
// population. This executes their gathers with rows whose old numeric columns
// would tell a different story, so a route shortcut cannot quietly re-admit one.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stage-eligibility');
const { loadCoachableTeam } = require('../lib/coachable-team');
const me = require('../routes/me');

function eligibility(state, score) {
  const sections = Object.fromEntries(S.SECTIONS.map(function (section) {
    return [section, section === 'discovery'
      ? { state: state, score: score, grade: score == null ? null : S.canonicalGrade(Math.round(score)) }
      : { state: 'not_applicable', score: null, grade: null }];
  }));
  return { summary: {
    version: S.VERSION,
    review_version: require('../lib/stage-eligibility-review').VERSION,
    factual_version: require('../lib/stage-observation-review').VERSION,
    source_hash: 'verified-stage-population',
    sections: sections,
  } };
}

const SCORES = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85];
const CURRENT_CALLS = SCORES.map(function (_score, index) {
  return { id: 'current-' + index, user_id: 'rep', call_date: '2026-09-10T10:00:00Z', source: 'fathom', recording_url: null };
}).concat([
  { id: 'not-applicable', user_id: 'rep', call_date: '2026-09-11T10:00:00Z', source: 'fathom', recording_url: null },
  { id: 'legacy', user_id: 'rep', call_date: '2026-09-12T10:00:00Z', source: 'fathom', recording_url: null },
]);
const CURRENT_ANALYSES = SCORES.map(function (score, index) {
  return {
    fathom_call_id: 'current-' + index, status: 'done', prospect_name: 'Verified ' + index,
    discovery_score: 1, discovery_notes: 'Closer asked about the current situation',
    stage_eligibility: eligibility(index === 0 ? 'expected_but_missed' : 'evaluated', score),
  };
}).concat([
  { fathom_call_id: 'not-applicable', status: 'done', prospect_name: 'Excluded', discovery_score: 0,
    discovery_notes: 'legacy zero must not show', stage_eligibility: eligibility('not_applicable', null) },
  { fathom_call_id: 'legacy', status: 'done', prospect_name: 'Legacy', discovery_score: 100,
    discovery_notes: 'legacy hundred must not show' },
]);
const PREVIOUS_CALLS = [{ id: 'previous-verified', user_id: 'rep', call_date: '2026-08-10T10:00:00Z' }, { id: 'previous-legacy', user_id: 'rep', call_date: '2026-08-11T10:00:00Z' }];
const PREVIOUS_ANALYSES = [
  { fathom_call_id: 'previous-verified', status: 'done', discovery_score: 1, stage_eligibility: eligibility('evaluated', 70) },
  { fathom_call_id: 'previous-legacy', status: 'done', discovery_score: 0 },
];
const HIGHLIGHTS = [
  { id: 'included', fathom_call_id: 'current-0', section: 'discovery', type: 'missed_opportunity', quote: 'included stage evidence', timestamp_seconds: 4 },
  { id: 'excluded', fathom_call_id: 'not-applicable', section: 'discovery', type: 'missed_opportunity', quote: 'excluded stage evidence', timestamp_seconds: 5 },
  { id: 'legacy', fathom_call_id: 'legacy', section: 'discovery', type: 'missed_opportunity', quote: 'legacy stage evidence', timestamp_seconds: 6 },
];

function fakeAdmin() {
  const reads = [];
  return { reads: reads, from: function (table) {
    const q = { table: table, ids: null, prior: false, columns: null,
      select: function (columns) { q.columns = columns; reads.push({ table: table, columns: columns }); return q; },
      in: function (_column, values) { q.ids = values; return q; },
      eq: function () { return q; }, gte: function () { return q; }, lte: function () { return q; },
      lt: function () { q.prior = true; return q; }, not: function () { return q; }, is: function () { return q; },
      order: function () { return q; }, range: function () { return q; },
      then: function (resolve, reject) {
        let data = [];
        if (table === 'fathom_calls') data = q.prior ? PREVIOUS_CALLS : CURRENT_CALLS;
        if (table === 'call_analyses') {
          const source = q.ids && q.ids.some(function (id) { return String(id).startsWith('previous-'); }) ? PREVIOUS_ANALYSES : CURRENT_ANALYSES;
          data = source.filter(function (row) { return !q.ids || q.ids.includes(row.fathom_call_id); });
        }
        if (table === 'call_highlights') data = HIGHLIGHTS.filter(function (row) { return !q.ids || q.ids.includes(row.fathom_call_id); });
        return Promise.resolve({ data: data, error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
}

test('all bounded Coaching gathers share the verified Discovery population and keep excluded calls out of stage evidence', async function () {
  const admin = fakeAdmin();
  const team = await loadCoachableTeam(admin, ['rep'], '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', 'kb', { periodOnly: true });
  const teamDiscovery = team.reps[0].period_summary.sections.find(function (section) { return section.section === 'discovery'; });
  assert.deepEqual({ score: teamDiscovery.score, calls: teamDiscovery.calls }, { score: 63, calls: 10 }, 'period card excludes not_applicable and legacy values');

  const needs = await me._computeNeedsWorkSections(admin, 'rep', '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z');
  const discovery = needs.sections.find(function (section) { return section.section === 'discovery'; });
  assert.deepEqual({ score: discovery.score, n: discovery.n, rank: discovery.rank }, { score: 63, n: 10, rank: 1 }, 'personal weakest-stage ranking uses the same ten rows');
  assert.deepEqual(discovery.moments.map(function (moment) { return moment.quote; }), ['included stage evidence'], 'personal score evidence excludes non-contributing calls');

  const drilldown = await me._computeSectionBreakdown(admin, 'rep', 'discovery', '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z');
  assert.deepEqual({ average: drilldown.average, scored: drilldown.scored_calls, min: drilldown.min_score, max: drilldown.max_score, prior: drilldown.prior_average }, { average: 63, scored: 10, min: 40, max: 85, prior: 70 }, 'average, distribution endpoints, and prior comparison use only explicit contributing records');
  assert.equal(drilldown.histogram.reduce(function (total, bucket) { return total + bucket.count; }, 0), 10, 'distribution shares the same population');
  assert.deepEqual(drilldown.bad.map(function (moment) { return moment.quote; }), ['included stage evidence'], 'drilldown highlights cannot re-admit excluded or legacy calls');
  assert.equal(drilldown.examples.best.prospect_name, 'Verified 9');
  assert.equal(drilldown.examples.worst.prospect_name, 'Verified 0');

  const analysisReads = admin.reads.filter(function (read) { return read.table === 'call_analyses'; });
  assert.ok(analysisReads.length >= 4, 'team, ranking, drilldown, and prior reads were executed');
  assert.ok(analysisReads.every(function (read) { return read.columns.includes('stage_eligibility'); }), 'every bounded Coaching analysis read selects the shared eligibility record');
});
