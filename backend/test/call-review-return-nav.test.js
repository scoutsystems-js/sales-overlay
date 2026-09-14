'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');

const page = stripComments(fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'));

function backFrom(origin) {
  const state = { callReviewOrigin: origin, selectedCallId: 'call-1', callReview: {}, callReviewError: 'old', expandedGradeCards: { intro: true }, followupCopied: true };
  const seen = [];
  const fn = new Function('state', 'render', 'syncHashFromState', 'window', fnBody(page, 'backFromCallReview') + ';return backFromCallReview;');
  fn(state, () => seen.push('render'), () => seen.push('hash'), { scrollTo: () => seen.push('scroll') })();
  return { state, seen };
}

test('a call opened from Team Call Review returns to that queue', () => {
  const r = backFrom('team-call-review');
  assert.equal(r.state.view, 'team-call-review');
  assert.equal(r.state.callReviewOrigin, null);
  assert.deepEqual(r.seen, ['render', 'hash', 'scroll']);
});

test('a normal call review still returns to Calls', () => {
  assert.equal(backFrom(null).state.view, 'call-library');
});
