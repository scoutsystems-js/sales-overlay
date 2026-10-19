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
