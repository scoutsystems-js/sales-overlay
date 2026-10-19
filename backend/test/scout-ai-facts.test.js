// Scout AI must answer a phrase-specific question from the matching saved
// moments only.  A Partner objection is not automatically a spouse objection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FACTS_FILE = path.join(__dirname, '..', 'lib', 'scout-ai-facts.js');

test('Scout AI has one evidence-only fact helper', () => {
  assert.ok(
    fs.existsSync(FACTS_FILE),
    'Scout AI needs a fact helper before it can answer data questions'
  );
});

const facts = require('../lib/scout-ai-facts');

const ROWS = [
  { id: 'spouse', type: 'objection', fathom_call_id: 'call-1', objection_category: 'partner', objection_class: 'true_objection', objection_surface: 'I need to speak with my spouse first', quote: 'My spouse needs to be part of this', resolution: 'handled', timestamp_seconds: 81 },
  { id: 'partner', type: 'objection', fathom_call_id: 'call-2', objection_category: 'partner', objection_class: 'true_objection', objection_surface: 'I need to speak with my business partner', quote: 'Let me ask my partner', resolution: 'unhandled', timestamp_seconds: 97 },
  { id: 'dq', type: 'objection', fathom_call_id: 'call-3', objection_category: 'partner', objection_class: 'disqualification', objection_surface: 'My spouse cannot fund this', quote: 'We cannot afford it', resolution: 'handled', timestamp_seconds: 125 },
];

test('an exact spouse cohort does not silently include all Partner objections', () => {
  const result = facts.summarizeObjectionCohort(ROWS, { 'call-1': 'lost', 'call-2': 'lost' }, { phrase: 'spouse' });
  assert.deepEqual(result, {
    kind: 'objection_handle_cohort',
    category: null,
    phrase: 'spouse',
    total: 1,
    handled: 1,
    rate: 100,
    definition: 'handled objections divided by documented objections in this requested cohort',
  });
});

test('Scout AI examples use the saved resolution, not a closed call as proof', () => {
  const examples = facts.selectObjectionExamples(
    ROWS,
    { 'call-1': { prospect_name: 'Casey', call_date: '2026-10-01', recording_url: 'https://recording.example/1' } },
    { phrase: 'spouse' },
    'handled'
  );
  assert.equal(examples.length, 1);
  assert.equal(examples[0].prospect_name, 'Casey');
  assert.equal(examples[0].timestamp_seconds, 81);
});

test('Scout AI has a separately labelled close-rate calculation for a requested objection cohort', () => {
  assert.equal(
    typeof facts.summarizeCohortCloseRate,
    'function',
    'a cohort close rate must be explicit rather than masquerading as Scout’s normal close rate'
  );
});

test('a spouse-objection cohort close rate is shown only for matching prospects', () => {
  const result = facts.summarizeCohortCloseRate(
    ROWS,
    [
      { id: 'call-1', user_id: 'josh', prospect_id: 'prospect-spouse', outcome: 'lost' },
      { id: 'call-1-follow-up', user_id: 'josh', prospect_id: 'prospect-spouse', outcome: 'closed' },
      { id: 'call-2', user_id: 'josh', prospect_id: 'prospect-partner', outcome: 'lost' },
    ],
    { phrase: 'spouse' }
  );
  assert.equal(result.kind, 'objection_cohort_close_rate');
  assert.equal(result.closed, 1);
  assert.equal(result.total, 1);
  assert.equal(result.rate, 100);
  assert.equal(result.phrase, 'spouse');
});

test('a team objection overview separates the most raised objection from the weakest-handled one', () => {
  const result = facts.summarizeTeamObjections([
    { type: 'objection', fathom_call_id: 'fear-1', objection_category: 'fear', objection_class: 'true_objection', resolution: 'handled' },
    { type: 'objection', fathom_call_id: 'fear-2', objection_category: 'fear', objection_class: 'true_objection', resolution: 'unhandled' },
    { type: 'objection', fathom_call_id: 'timing-1', objection_category: 'timing', objection_class: 'true_objection', resolution: 'unhandled' },
    { type: 'objection', fathom_call_id: 'timing-2', objection_category: 'timing', objection_class: 'true_objection', resolution: 'unhandled' },
    { type: 'objection', fathom_call_id: 'timing-3', objection_category: 'timing', objection_class: 'true_objection', resolution: 'unhandled' },
    { type: 'objection', fathom_call_id: 'dq', objection_category: 'timing', objection_class: 'disqualification', resolution: 'handled' },
  ], {});
  assert.deepEqual(result.most_raised, { category: 'timing', total: 3, handled: 0, rate: 0 });
  assert.deepEqual(result.least_handled, { category: 'timing', total: 3, handled: 0, rate: 0 });
  assert.equal(result.categories.fear.total, 2);
  assert.equal(result.categories.timing.total, 3);
});
