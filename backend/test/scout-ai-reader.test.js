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

const { readObjectionCohort, readTeamObjections, readTeamObjectionLeaderboard, readCloserCloseRate, readStagePerformance } = require('../lib/scout-ai-reader');

const CALLS = [
  { id: 'call-spouse', user_id: 'josh', fathom_call_id: 'real-spouse', prospect_id: 'prospect-spouse', title: 'Avery', call_date: '2026-10-02T12:00:00Z', recording_url: 'https://recording.example/spouse', not_a_sales_call: false, duplicate_of: null },
  { id: 'call-spouse-followup', user_id: 'josh', fathom_call_id: 'real-spouse-followup', prospect_id: 'prospect-spouse', title: 'Avery', call_date: '2026-10-10T12:00:00Z', recording_url: 'https://recording.example/followup', not_a_sales_call: false, duplicate_of: null },
  { id: 'call-partner', user_id: 'josh', fathom_call_id: 'real-partner', prospect_id: 'prospect-partner', title: 'Blake', call_date: '2026-10-03T12:00:00Z', recording_url: 'https://recording.example/partner', not_a_sales_call: false, duplicate_of: null },
  { id: 'demo-copy', user_id: 'josh', fathom_call_id: 'demo-copy', prospect_id: 'demo-prospect', title: 'Demo', call_date: '2026-10-03T12:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null },
];
const HIGHLIGHTS = [
  { id: 'm-spouse', fathom_call_id: 'call-spouse', type: 'objection', quote: 'My spouse needs to be part of this.', speaker: 'prospect', timestamp_seconds: 90, objection_surface: 'I need to speak with my spouse', objection_category: 'partner', objection_class: 'true_objection', resolution: 'handled' },
  { id: 'm-partner', fathom_call_id: 'call-partner', type: 'objection', quote: 'I need to speak with my business partner.', speaker: 'prospect', timestamp_seconds: 110, objection_surface: 'I need my partner', objection_category: 'partner', objection_class: 'true_objection', resolution: 'unhandled' },
];
const ANALYSES = [
  { fathom_call_id: 'call-spouse', outcome: 'lost', status: 'done' },
  { fathom_call_id: 'call-spouse-followup', outcome: 'closed', status: 'done' },
  { fathom_call_id: 'call-partner', outcome: 'lost', status: 'done' },
];

function fakeAdmin() {
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
          let rows = table === 'fathom_calls' ? CALLS : table === 'call_highlights' ? HIGHLIGHTS : table === 'call_analyses' ? ANALYSES : [];
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
    to: '2026-10-05T00:00:00Z',
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
