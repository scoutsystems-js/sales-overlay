'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Scout AI has a tool-only question engine', () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'lib', 'scout-ai-engine.js')),
    'a question engine must constrain the model to Scout fact tools'
  );
});

const { answerQuestion } = require('../lib/scout-ai-engine');

const DEFAULT_RANGE = { from: '2026-07-01T00:00:00Z', to: '2026-09-29T23:59:59Z' };
const PROFILES = [{ user_id: 'josh-id', name: 'Josh P' }];
const FACTS = {
  window: DEFAULT_RANGE,
  filter: { phrase: 'spouse', category: null },
  objection_handle_rate: { handled: 2, total: 4, rate: 50 },
  close_rate: { closed: 1, total: 3, rate: 33 },
  handled_examples: [{ call_id: 'call-1', quote: 'My spouse needs to be part of this.' }],
  not_handled_examples: [],
};

test('the model can request only a known closer and receives Scout facts before writing', async () => {
  const requests = [];
  const toolReads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-1', name: 'read_objection_cohort', input: { user_id: 'josh-id', phrase: 'spouse' } }] },
    { content: [{ type: 'text', text: 'For the last 90 days, Josh handled 2 of 4 documented spouse objections (50%). Among 3 matching prospects, 1 closed (33%).' }] },
  ];
  const result = await answerQuestion({
    question: 'What is Josh’s close rate when a spouse objection comes up?',
    profiles: PROFILES,
    defaultRange: DEFAULT_RANGE,
    model: 'fixture-model',
    create: async request => { requests.push(request); return responses.shift(); },
    readObjectionCohort: async request => { toolReads.push(request); return FACTS; },
  });
  assert.equal(result.status, 'answered');
  assert.equal(toolReads.length, 1);
  assert.deepEqual(toolReads[0], { userId: 'josh-id', from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to, filter: { phrase: 'spouse', category: null } });
  assert.equal(requests.length, 2);
  assert.match(requests[0].system, /Do not use Markdown/);
  assert.equal(requests[1].messages[2].content[0].type, 'tool_result');
  assert.equal(result.evidence.close_rate.rate, 33);
});

test('a hallucinated closer id is rejected before any fact read', async () => {
  let read = false;
  await assert.rejects(function () {
    return answerQuestion({
      question: 'How did Taylor do with spouse objections?',
      profiles: PROFILES,
      defaultRange: DEFAULT_RANGE,
      model: 'fixture-model',
      create: async () => ({ content: [{ type: 'tool_use', id: 'tool-1', name: 'read_objection_cohort', input: { user_id: 'made-up-id', phrase: 'spouse' } }] }),
      readObjectionCohort: async () => { read = true; return FACTS; },
    });
  }, /could not match that closer/);
  assert.equal(read, false);
});

test('the model can read the team objection overview without inventing a closer cohort', async () => {
  const requests = [];
  const reads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-team', name: 'read_team_objections', input: {} }] },
    { content: [{ type: 'text', text: 'In this date range, Timing was raised most often: 12 documented objections, with 3 handled. It was also the weakest-handled category at 25%.' }] },
  ];
  const facts = {
    kind: 'team_objection_overview', window: DEFAULT_RANGE, closer_count: 1,
    most_raised: { category: 'timing', total: 12, handled: 3, rate: 25 },
    least_handled: { category: 'timing', total: 12, handled: 3, rate: 25 },
    categories: {},
  };
  const result = await answerQuestion({
    question: 'What is the biggest objection our closers are facing?',
    profiles: PROFILES,
    defaultRange: DEFAULT_RANGE,
    model: 'fixture-model',
    create: async request => { requests.push(request); return responses.shift(); },
    readObjectionCohort: async () => { throw new Error('wrong reader'); },
    readTeamObjections: async request => { reads.push(request); return facts; },
  });
  assert.equal(result.status, 'answered');
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], { userIds: ['josh-id'], from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to });
  assert.equal(requests[0].tools.length, 3);
  assert.equal(result.evidence.most_raised.category, 'timing');
});

test('every requested tool use receives a result before the model writes again', async () => {
  const requests = [];
  const responses = [
    { content: [
      { type: 'tool_use', id: 'tool-1', name: 'read_objection_cohort', input: { user_id: 'josh-id', category: 'fear' } },
      { type: 'tool_use', id: 'tool-2', name: 'read_objection_cohort', input: { user_id: 'josh-id', category: 'timing' } },
    ] },
    { content: [{ type: 'text', text: 'Scout compared the requested saved facts.' }] },
  ];
  await answerQuestion({
    question: 'Compare Josh’s fear and timing objections.',
    profiles: PROFILES,
    defaultRange: DEFAULT_RANGE,
    model: 'fixture-model',
    create: async request => { requests.push(request); return responses.shift(); },
    readObjectionCohort: async input => Object.assign({}, FACTS, { filter: input.filter }),
  });
  assert.equal(requests[1].messages[2].content.length, 2);
  assert.deepEqual(requests[1].messages[2].content.map(block => block.tool_use_id), ['tool-1', 'tool-2']);
});

test('the model uses one team leaderboard for best handling by objection category', async () => {
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-rank', name: 'read_team_objection_leaderboard', input: { category: 'fear' } }] },
    { content: [{ type: 'text', text: 'Josh handled Fear objections best in this range.' }] },
  ];
  const reads = [];
  const result = await answerQuestion({
    question: 'What closers handle fear objections best?', profiles: PROFILES, defaultRange: DEFAULT_RANGE, model: 'fixture-model',
    create: async () => responses.shift(), readObjectionCohort: async () => FACTS,
    readTeamObjections: async () => { throw new Error('wrong reader'); },
    readTeamObjectionLeaderboard: async request => { reads.push(request); return { kind: 'team_objection_leaderboard', category: 'fear', window: DEFAULT_RANGE, leaders: [{ user_id: 'josh-id', name: 'Josh P', handled: 3, total: 4, rate: 75 }] }; },
  });
  assert.deepEqual(reads[0], { userIds: ['josh-id'], namesByUserId: { 'josh-id': 'Josh P' }, category: 'fear', from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to });
  assert.equal(result.evidence.leaders[0].rate, 75);
});

test('a follow-up gets prior user questions as context but still requires a fresh Scout tool read', async () => {
  const requests = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-follow-up', name: 'read_team_objection_leaderboard', input: { category: 'fear' } }] },
    { content: [{ type: 'text', text: 'Scout re-checked the saved Fear evidence.' }] },
  ];
  await answerQuestion({
    question: 'Show three of those calls.',
    priorQuestions: ['What closers handle Fear objections best?'],
    profiles: PROFILES,
    defaultRange: DEFAULT_RANGE,
    model: 'fixture-model',
    create: async request => { requests.push(request); return responses.shift(); },
    readObjectionCohort: async () => { throw new Error('wrong reader'); },
    readTeamObjectionLeaderboard: async () => ({ kind: 'team_objection_leaderboard', category: 'fear', window: DEFAULT_RANGE, leaders: [] }),
  });
  assert.match(requests[0].messages[0].content, /Earlier user question: What closers handle Fear objections best\?/);
  assert.match(requests[0].messages[0].content, /Current user question: Show three of those calls\./);
  assert.deepEqual(requests[0].tool_choice, { type: 'any' });
  assert.equal(requests[1].messages[2].content[0].type, 'tool_result');
});
