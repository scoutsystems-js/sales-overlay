'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const READER_FILE = path.join(__dirname, '..', 'lib', 'scout-ai-reader.js');

test('Scout AI has a bounded database reader before a question route can exist', () => {
  assert.ok(
    fs.existsSync(READER_FILE),
    'Scout AI must use a bounded reader instead of giving a model broad database access'
  );
});

const { readObjectionCohort, readTeamObjections, readCloserObjectionOverview, readTeamObjectionLeaderboard, readCloserCloseRate, readStagePerformance, readStageExamples, readCallExamples } = require('../lib/scout-ai-reader');
const { comparisonFromSavedCoaching } = require('../lib/scout-ai-coaching-comparison');

const CALLS = [
  { id: 'call-spouse', user_id: 'josh', fathom_call_id: 'real-spouse', prospect_id: 'prospect-spouse', title: 'Avery', call_date: '2026-10-02T12:00:00Z', recording_url: 'https://recording.example/spouse', not_a_sales_call: false, duplicate_of: null },
  { id: 'call-spouse-followup', user_id: 'josh', fathom_call_id: 'real-spouse-followup', prospect_id: 'prospect-spouse', title: 'Avery', call_date: '2026-10-10T12:00:00Z', recording_url: 'https://recording.example/followup', not_a_sales_call: false, duplicate_of: null },
  { id: 'call-partner', user_id: 'josh', fathom_call_id: 'real-partner', prospect_id: 'prospect-partner', title: 'Blake', call_date: '2026-10-03T12:00:00Z', recording_url: 'https://recording.example/partner', not_a_sales_call: false, duplicate_of: null },
  { id: 'call-open', user_id: 'josh', fathom_call_id: 'real-open', prospect_id: 'prospect-spouse', title: 'Casey', call_date: '2026-10-04T12:00:00Z', recording_url: 'https://recording.example/open', not_a_sales_call: false, duplicate_of: null },
  { id: 'call-no-show', user_id: 'josh', fathom_call_id: 'real-no-show', prospect_id: 'prospect-no-show', title: 'Morning meeting', call_date: '2026-10-05T12:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null },
  { id: 'demo-copy', user_id: 'josh', fathom_call_id: 'demo-copy', prospect_id: 'demo-prospect', title: 'Demo', call_date: '2026-10-03T12:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null },
];
const HIGHLIGHTS = [
  { id: 'm-spouse', fathom_call_id: 'call-spouse', type: 'objection', quote: 'My spouse needs to be part of this.', speaker: 'prospect', timestamp_seconds: 90, objection_surface: 'I need to speak with my spouse', objection_category: 'partner', objection_class: 'true_objection', resolution: 'handled' },
  { id: 'm-partner', fathom_call_id: 'call-partner', type: 'objection', quote: 'I need to speak with my business partner.', speaker: 'prospect', timestamp_seconds: 110, objection_surface: 'I need my partner', objection_category: 'partner', objection_class: 'true_objection', resolution: 'unhandled' },
  { id: 'm-discovery', fathom_call_id: 'call-spouse', type: 'strong_moment', section: 'discovery', quote: 'We are trying to find a better option.', speaker: 'prospect', timestamp_seconds: 60, coaching_evidence: { stage: 'discovery', prospect_context: { quote: 'We are trying to find a better option.' }, closer_probe: { quote: 'What has made the current option difficult?' }, prospect_detail: { quote: 'The lack of support has been the hardest part.' } } },
  { id: 'm-pitch', fathom_call_id: 'call-spouse', type: 'strong_moment', section: 'pitch', quote: 'How would this work?', speaker: 'prospect', timestamp_seconds: 130, coaching_evidence: { stage: 'pitch', prospect_question: { quote: 'How would this work?' }, closer_explanation: { quote: 'Here is how the support plan works.' }, prospect_confirmation: { quote: 'That makes sense.' } } },
  { id: 'm-intro', fathom_call_id: 'call-partner', type: 'strong_moment', section: 'intro', quote: 'Thanks for making the time today.', speaker: 'closer', timestamp_seconds: 10 },
];
const ANALYSES = [
  { fathom_call_id: 'call-spouse', outcome: 'lost', status: 'done' },
  { fathom_call_id: 'call-spouse-followup', outcome: 'closed', status: 'done' },
  { fathom_call_id: 'call-partner', outcome: 'lost', status: 'done' },
  { fathom_call_id: 'call-open', outcome: 'follow_up', status: 'done', why_outcome: 'The prospect wanted to review the payment option before deciding.', why_quote: 'Let me look over the payment option tonight.', why_timestamp_seconds: 245, overall_summary: 'The prospect was interested and asked for time to review the payment option.' },
  { fathom_call_id: 'call-no-show', outcome: 'no_show', status: 'done' },
];

function fakeAdmin(options) {
  const configuredAnalyses = (options && options.analyses) || ANALYSES;
  return {
    from(table) {
      const state = { table, filters: {}, in: {} };
      const chain = {
        select() { return chain; }, not() { return chain; }, is() { return chain; }, order() { return chain; },
        eq(column, value) { state.filters[column] = value; return chain; },
        gte(column, value) { state.filters['gte:' + column] = value; return chain; },
        lte(column, value) { state.filters['lte:' + column] = value; return chain; },
        in(column, values) { state.in[column] = values; return chain; },
        range() { return chain; },
        then(resolve, reject) {
          let rows = table === 'fathom_calls' ? CALLS : table === 'call_highlights' ? HIGHLIGHTS : table === 'call_analyses' ? configuredAnalyses : [];
          rows = rows.filter(row => {
            return Object.keys(state.filters).every(key => {
              if (key.startsWith('gte:')) return row[key.slice(4)] >= state.filters[key];
              if (key.startsWith('lte:')) return row[key.slice(4)] <= state.filters[key];
              return row[key] === state.filters[key];
            }) && Object.keys(state.in).every(key => state.in[key].includes(row[key]));
          });
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test('the bounded reader returns only exact spouse evidence and its linked close outcome', async () => {
  const result = await readObjectionCohort(fakeAdmin(), {
    userId: 'josh',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T23:59:59Z',
    filter: { phrase: 'spouse' },
  });
  assert.equal(result.matching_moments, 1);
  assert.equal(result.objection_handle_rate.total, 1);
  assert.equal(result.close_rate.closed, 1);
  assert.equal(result.close_rate.total, 1);
  assert.equal(result.handled_examples[0].prospect_name, 'Avery');
  assert.equal(result.handled_examples[0].timestamp_seconds, 90);
  assert.equal(result.handled_examples[0].recording_url, 'https://recording.example/spouse');
});

test('a coaching comparison withholds a claimed repeated pattern without two matching saved examples', () => {
  const comparison = comparisonFromSavedCoaching({
    userId: 'josh', name: 'Josh P', category: 'fear', window: { from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
    cohort: {
      window: { from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      objection_handle_rate: { handled: 1, total: 3, rate: 33 },
      handled_examples: [{ call_id: 'handled-1' }],
      not_handled_examples: [{ call_id: 'missed-1' }, { call_id: 'missed-2' }],
    },
    synthesis: { categories: [{
      category: 'fear',
      when_handled: 'The closer isolated the concern first.',
      when_not_handled: 'The closer answered before isolating.',
    }] },
  });
  assert.equal(comparison.when_handled, null);
  assert.equal(comparison.when_not_handled, 'The closer answered before isolating.');
});

test('the bounded reader returns a team objection overview from saved strict moments', async () => {
  const result = await readTeamObjections(fakeAdmin(), {
    userIds: ['josh'],
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T00:00:00Z',
  });
  assert.equal(result.kind, 'team_objection_overview');
  assert.equal(result.most_raised.category, 'partner');
  assert.equal(result.most_raised.total, 2);
  assert.equal(result.least_handled.rate, 50);
});

test('the bounded reader exposes one closer’s existing objection overview without a new calculation', async () => {
  const result = await readCloserObjectionOverview(fakeAdmin(), {
    userId: 'josh', name: 'Josh P',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T23:59:59Z',
  });
  assert.equal(result.kind, 'closer_objection_overview');
  assert.deepEqual(result.closer, { user_id: 'josh', name: 'Josh P' });
  assert.equal(result.most_raised.category, 'partner');
  assert.equal(result.most_raised.total, 2);
  assert.equal(result.least_handled.rate, 50);
});

test('the bounded reader returns a per-closer category leaderboard from saved facts', async () => {
  const result = await readTeamObjectionLeaderboard(fakeAdmin(), {
    userIds: ['josh'],
    namesByUserId: { josh: 'Josh P' },
    category: 'partner',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T00:00:00Z',
  });
  assert.equal(result.kind, 'team_objection_leaderboard');
  assert.deepEqual(result.leaders[0], { user_id: 'josh', name: 'Josh P', handled: 1, total: 2, rate: 50 });
  assert.equal(result.handled_examples.length, 1);
  assert.equal(result.handled_examples[0].prospect_name, 'Avery');
});

test('the bounded reader uses Scout’s canonical prospect close rate for a closer', async () => {
  const result = await readCloserCloseRate(fakeAdmin(), {
    userId: 'josh', from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z',
  });
  assert.deepEqual(result.close_rate, { closed: 1, total: 2, pct: 50 });
  assert.deepEqual(result.window, { from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z' });
});

function stageEligibility(score) {
  const stage = require('../lib/stage-eligibility');
  const sections = Object.fromEntries(stage.SECTIONS.map(function (section) {
    return [section, section === 'discovery'
      ? { state: 'evaluated', score: score, grade: stage.canonicalGrade(score) }
      : { state: 'not_applicable', score: null, grade: null }];
  }));
  return { summary: {
    version: stage.VERSION,
    review_version: require('../lib/stage-eligibility-review').VERSION,
    factual_version: require('../lib/stage-observation-review').VERSION,
    source_hash: 'verified-stage-fixture',
    sections: sections,
  } };
}

function stageAdmin() {
  const calls = ['ava', 'ben'].flatMap(function (userId) {
    return Array.from({ length: 10 }, function (_, index) {
      return { id: userId + '-' + index, user_id: userId, fathom_call_id: 'real-' + userId + '-' + index, call_date: '2026-10-0' + ((index % 8) + 1) + 'T12:00:00Z', not_a_sales_call: false, duplicate_of: null };
    });
  });
  const analyses = calls.map(function (call) {
    return { fathom_call_id: call.id, status: 'done', stage_eligibility: stageEligibility(call.user_id === 'ava' ? 60 : 80) };
  });
  return { from(table) {
    const state = { table, ids: [] };
    const chain = {
      select() { return chain; }, not() { return chain; }, is() { return chain; }, order() { return chain; },
      eq() { return chain; }, gte() { return chain; }, lte() { return chain; }, range() { return chain; },
      in(column, values) { state.ids = values; state.column = column; return chain; },
      then(resolve, reject) {
        const source = table === 'fathom_calls' ? calls : table === 'call_analyses' ? analyses : [];
        const rows = !state.ids.length ? source : source.filter(function (row) { return state.ids.includes(row[state.column]); });
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  } };
}

test('the bounded reader ranks only sufficiently measured Discovery scores in the authorized group', async () => {
  const result = await readStagePerformance(stageAdmin(), {
    userIds: ['ava', 'ben'], namesByUserId: { ava: 'Ava', ben: 'Ben' }, stage: 'discovery',
    from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z',
  });
  assert.equal(result.kind, 'stage_performance');
  assert.equal(result.stage, 'discovery');
  assert.deepEqual(result.closers.map(function (closer) { return [closer.name, closer.score, closer.graded_calls]; }), [['Ava', 60, 10], ['Ben', 80, 10]]);
});

test('the bounded reader returns one complete, tied-safe coaching priority across all earned stages', async () => {
  const result = await readStagePerformance(stageAdmin(), {
    userIds: ['ava', 'ben'], namesByUserId: { ava: 'Ava', ben: 'Ben' },
    from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z',
  });
  assert.equal(result.stage, null);
  assert.deepEqual(result.priority, {
    ties: [{ user_id: 'ava', name: 'Ava', stage: 'discovery', label: 'Discovery', score: 60, graded_calls: 10 }],
  });
});

test('the bounded reader returns only a saved, verified exchange for the requested stage', async () => {
  const result = await readStageExamples(fakeAdmin(), {
    userIds: ['josh'], namesByUserId: { josh: 'Josh P' }, stage: 'discovery',
    from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z',
  });
  assert.equal(result.kind, 'stage_examples');
  assert.equal(result.stage, 'discovery');
  assert.equal(result.examples.length, 1);
  assert.deepEqual(result.examples[0].exchange, [
    { label: 'Prospect context', speaker: 'PROSPECT', quote: 'We are trying to find a better option.' },
    { label: 'Closer digs deeper', speaker: 'CLOSER', quote: 'What has made the current option difficult?' },
    { label: 'Prospect detail', speaker: 'PROSPECT', quote: 'The lack of support has been the hardest part.' },
  ]);
  assert.equal(result.examples[0].prospect_name, 'Avery');
  assert.equal(result.examples[0].recording_url, 'https://recording.example/spouse');
});

test('the bounded reader can return a saved stage moment for Intro without inventing an exchange', async () => {
  const result = await readStageExamples(fakeAdmin(), {
    userIds: ['josh'], namesByUserId: { josh: 'Josh P' }, stage: 'intro',
    from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z',
  });
  assert.equal(result.stage, 'intro');
  assert.deepEqual(result.examples[0].exchange, [{ label: 'Saved Intro moment', speaker: 'closer', quote: 'Thanks for making the time today.' }]);
});

test('the bounded reader returns real not-handled Partner calls with their existing outcomes', async () => {
  const result = await readCallExamples(fakeAdmin(), {
    userId: 'josh',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T00:00:00Z',
    filter: { category: 'partner', handling: 'not_handled' },
    limit: 5,
  });
  assert.equal(result.kind, 'call_examples');
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0], {
    call_id: 'call-partner',
    prospect_name: 'Blake',
    call_date: '2026-10-03T12:00:00Z',
    recording_url: 'https://recording.example/partner',
    outcome: 'lost',
    outcome_evidence: null,
    objection: {
      quote: 'I need to speak with my business partner.',
      category: 'partner',
      resolution: 'unhandled',
      timestamp_seconds: 110,
    },
  });
});

test('the bounded reader treats a request for calls that did not close as Lost calls only', async () => {
  const result = await readCallExamples(fakeAdmin(), {
    userId: 'josh',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T00:00:00Z',
    filter: { outcome: 'lost' },
    limit: 5,
  });
  assert.equal(result.calls.length, 2);
  assert.equal(result.matching_call_count, 2);
  assert.deepEqual(result.calls.map(function (call) { return [call.call_id, call.outcome]; }).sort(), [
    ['call-partner', 'lost'], ['call-spouse', 'lost'],
  ]);
  assert.ok(result.calls.every(function (call) { return call.outcome === 'lost'; }));
  assert.ok(result.calls.every(function (call) { return call.call_id !== 'call-open' && call.call_id !== 'call-no-show'; }));
});

test('the bounded reader gives an open follow-up its saved reason and exact moment without inferring one', async () => {
  const result = await readCallExamples(fakeAdmin(), {
    userId: 'josh', from: '2026-10-01T00:00:00Z', to: '2026-10-05T23:59:59Z', filter: { outcome: 'follow_up' }, limit: 5,
  });
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].outcome_evidence, {
    label: 'What kept it open',
    reason: 'The prospect wanted to review the payment option before deciding.',
    quote: 'Let me look over the payment option tonight.',
    timestamp_seconds: 245,
  });
});

test('the bounded reader never carries a model reason forward after a manual outcome change', async () => {
  const manualAnalyses = ANALYSES.map(function (analysis) {
    return analysis.fathom_call_id === 'call-open' ? Object.assign({}, analysis, { outcome_source: 'manual' }) : analysis;
  });
  const result = await readCallExamples(fakeAdmin({ analyses: manualAnalyses }), {
    userId: 'josh', from: '2026-10-01T00:00:00Z', to: '2026-10-05T23:59:59Z', filter: { outcome: 'follow_up' }, limit: 5,
  });
  assert.equal(result.calls[0].outcome_evidence, null);
});

test('the bounded reader keeps an exact not-closed request as an outcome breakdown, not a blended list', async () => {
  const result = await readCallExamples(fakeAdmin(), {
    userId: 'josh',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-05T23:59:59Z',
    filter: { outcome: 'not_closed' },
    limit: 5,
  });
  assert.equal(result.matching_call_count, 4);
  assert.equal(result.needs_outcome_choice, true);
  assert.deepEqual(result.outcome_breakdown, { lost: 2, follow_up: 1, no_show: 1 });
  assert.deepEqual(result.calls, []);
});
