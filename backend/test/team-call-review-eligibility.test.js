'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const team = require('../routes/team');

test('Call Review only surfaces completed sales conversations that can be coached', () => {
  const eligible = team._isCoachingReviewEligible;
  assert.equal(eligible({ status: 'done', outcome: 'follow_up', sales_call_verdict: 'sales' }), true);
  assert.equal(eligible({ status: 'done', outcome: 'lost', sales_call_verdict: null }), true,
    'older graded sales calls without a classifier verdict remain reviewable');
  assert.equal(eligible({ status: 'pending', outcome: null, sales_call_verdict: null }), false);
  assert.equal(eligible({ status: 'done', outcome: 'no_show', sales_call_verdict: 'sales' }), false);
  assert.equal(eligible({ status: 'done', outcome: 'follow_up', sales_call_verdict: 'not_sales' }), false);
});
