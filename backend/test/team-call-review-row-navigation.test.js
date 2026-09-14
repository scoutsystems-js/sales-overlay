'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody, stripComments } = require('./helpers/strip-comments');

const page = stripComments(fs.readFileSync(path.join(__dirname, '../web/dashboard.html'), 'utf8'));
const renderQueue = fnBody(page, 'teamCallReviewHtml');

test('each Call Review queue row opens the existing full review', () => {
  assert.match(renderQueue, /class="team-review-row" role="link" tabindex="0"/);
  assert.match(renderQueue, /onclick="' \+ open \+ '"/);
  assert.match(renderQueue, /onkeydown="if\(event\.key===\\'Enter\\'\|\|event\.key===\\' \\'\)/);
  assert.match(renderQueue, /openCallReview\('/);
  assert.match(renderQueue, /<span class="team-review-open" aria-hidden="true">Open review →<\/span>/);
  assert.doesNotMatch(renderQueue, /<button[^>]+team-review-open/);
});
