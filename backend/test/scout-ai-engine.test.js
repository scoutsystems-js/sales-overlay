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
  assert.equal(requests[0].tools.length, 7);
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

test('the model reads Scout’s canonical close rate for a known closer', async () => {
  const reads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-close-rate', name: 'read_closer_close_rate', input: { user_id: 'josh-id' } }] },
    { content: [{ type: 'text', text: 'Josh closed 4 of 10 prospects (40%) in this date range.' }] },
  ];
  const result = await answerQuestion({
    question: 'What is Josh’s closing rate?', profiles: PROFILES, defaultRange: DEFAULT_RANGE, model: 'fixture-model',
    create: async () => responses.shift(), readObjectionCohort: async () => FACTS,
    readCloserCloseRate: async request => { reads.push(request); return { kind: 'closer_close_rate', window: DEFAULT_RANGE, close_rate: { closed: 4, total: 10, pct: 40 } }; },
  });
  assert.deepEqual(reads, [{ userId: 'josh-id', from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to }]);
  assert.equal(result.evidence.close_rate.pct, 40);
});

test('the model can rank the authorized group’s earned Discovery scores', async () => {
  const reads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-discovery', name: 'read_stage_performance', input: { stage: 'discovery' } }] },
    { content: [{ type: 'text', text: 'Josh has the lowest measured Discovery score in this group.' }] },
  ];
  const result = await answerQuestion({
    question: 'What closers need help with Discovery?', profiles: PROFILES, defaultRange: DEFAULT_RANGE, model: 'fixture-model',
    create: async () => responses.shift(), readObjectionCohort: async () => FACTS,
    readStagePerformance: async request => { reads.push(request); return { kind: 'stage_performance', stage: 'discovery', window: DEFAULT_RANGE, closers: [{ user_id: 'josh-id', name: 'Josh P', score: 62, graded_calls: 10 }] }; },
  });
  assert.deepEqual(reads, [{ userIds: ['josh-id'], namesByUserId: { 'josh-id': 'Josh P' }, userId: null, stage: 'discovery', from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to }]);
  assert.equal(result.evidence.stage, 'discovery');
});

test('the model uses one complete stage read for who needs the most coaching overall', async () => {
  const reads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-priority', name: 'read_stage_performance', input: {} }] },
    { content: [{ type: 'text', text: 'Ava needs the most help with Discovery.' }] },
  ];
  const result = await answerQuestion({
    question: 'What closer needs the most coaching and in which area?', profiles: PROFILES, defaultRange: DEFAULT_RANGE, model: 'fixture-model',
    create: async () => responses.shift(), readObjectionCohort: async () => FACTS,
    readStagePerformance: async request => {
      reads.push(request);
      return { kind: 'stage_performance', stage: null, window: DEFAULT_RANGE, priority: { ties: [{ user_id: 'josh-id', name: 'Josh P', stage: 'discovery', label: 'Discovery', score: 62, graded_calls: 10 }] }, closers: [] };
    },
  });
  assert.deepEqual(reads, [{ userIds: ['josh-id'], namesByUserId: { 'josh-id': 'Josh P' }, userId: null, stage: null, from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to }]);
  assert.equal(result.evidence.priority.ties[0].stage, 'discovery');
});

test('the model can return a closer’s saved Discovery exchange without inventing coaching', async () => {
  const reads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-discovery-example', name: 'read_stage_examples', input: { user_id: 'josh-id', stage: 'discovery' } }] },
    { content: [{ type: 'text', text: 'Scout found one saved Discovery exchange for Josh in this date range.' }] },
  ];
  const result = await answerQuestion({
    question: 'Show me a Discovery call for Josh.', profiles: PROFILES, defaultRange: DEFAULT_RANGE, model: 'fixture-model',
    create: async () => responses.shift(), readObjectionCohort: async () => FACTS,
    readStageExamples: async request => { reads.push(request); return { kind: 'stage_examples', stage: 'discovery', window: DEFAULT_RANGE, examples: [{ call_id: 'call-1', exchange: [] }] }; },
  });
  assert.deepEqual(reads, [{ userIds: ['josh-id'], namesByUserId: { 'josh-id': 'Josh P' }, userId: 'josh-id', stage: 'discovery', from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to }]);
  assert.equal(result.evidence.kind, 'stage_examples');
});

test('the model can compare one closer’s saved handled and not-handled objection patterns', async () => {
  const reads = [];
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-comparison', name: 'read_objection_coaching_comparison', input: { user_id: 'josh-id', category: 'fear' } }] },
    { content: [{ type: 'text', text: 'When Fear worked for Josh, he isolated the concern before offering a path forward. When it did not, he answered before confirming the real blocker.' }] },
  ];
  const facts = {
    kind: 'objection_coaching_comparison', window: DEFAULT_RANGE, closer: { user_id: 'josh-id', name: 'Josh P' }, category: 'fear',
    handle_rate: { handled: 2, total: 5, rate: 40 },
    when_handled: 'He confirmed the concern was the only blocker before offering a path forward.',
    when_not_handled: 'He answered the concern before confirming whether it was the real blocker.',
    handled_examples: [{ call_id: 'handled-1', quote: 'I cannot afford it.' }],
    not_handled_examples: [{ call_id: 'missed-1', quote: 'It is too expensive.' }],
  };
  const result = await answerQuestion({
    question: 'How does Josh handle Fear when it works, and what happens when he does not?', profiles: PROFILES, defaultRange: DEFAULT_RANGE, model: 'fixture-model',
    create: async () => responses.shift(), readObjectionCohort: async () => FACTS,
    readObjectionCoachingComparison: async request => { reads.push(request); return facts; },
  });
  assert.deepEqual(reads, [{ userId: 'josh-id', name: 'Josh P', category: 'fear', from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to }]);
  assert.equal(result.evidence.when_handled, facts.when_handled);
  assert.equal(result.evidence.not_handled_examples[0].call_id, 'missed-1');
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
