'use strict';

// The Objections drilldown is an evidence page. Category selection must filter
// the already-scoped response, not trigger its retired coaching-synthesis lane
// or a second request with a different scope.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const live = stripComments(source);

test('Objections drilldown uses its category chart as an instant evidence filter', () => {
  const render = fnBody(live, 'renderObjectionsIntel');
  assert.doesNotMatch(render, /loadObjectionsSynthesis\(/,
    'the evidence drilldown must not load the retired Coaching Synthesis panel');
  assert.match(render, /setObjectionCategoryFilter/,
    'populated category rows must be selectable');
  assert.match(render, /aria-pressed/,
    'the selected category needs an accessible active state');
  assert.match(render, /var feedOrder = selectedCategory \? \[selectedCategory\] : order/,
    'a selected category must be the only group rendered below the chart');
  assert.match(render, /Show all objections/,
    'the user must be able to return to the full evidence list');
});

test('category selection cannot change the evidence scope or select an empty category', () => {
  const setter = fnBody(live, 'setObjectionCategoryFilter');
  assert.match(setter, /OBJ_DRILL_ORDER\.indexOf\(category\)/,
    'selection must use canonical category keys');
  assert.match(setter, /!bucket \|\| !bucket\.total/,
    'zero-count categories stay visible but cannot create a fake empty drilldown');
  assert.doesNotMatch(setter, /fetch\(/,
    'selection must filter the already-loaded response rather than issue a new request');
});

test('changing the coaching range clears a category selection', () => {
  const rangeSetter = fnBody(live, 'setCoachingRange');
  const presetSetter = fnBody(live, 'applyCoachingRangeChange');
  assert.match(rangeSetter, /state\.objectionCategoryFilter = null/,
    'custom-range changes cannot leave the prior window\'s category selected');
  assert.match(presetSetter, /state\.objectionCategoryFilter = null/,
    'preset-range changes cannot leave the prior window\'s category selected');
});
