'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eod.js'), 'utf8');

test('EOD starts independent source-status and day-call reads together', function () {
  assert.match(source, /Promise\.all\(\[fq, zq, callsQ\]\)/,
    'the three independent reads must not form a serial first-paint chain');
});

test('EOD starts independent analysis and edit reads together after calls are known', function () {
  assert.match(source, /Promise\.all\(\[anQ, edQ\]\)/,
    'the two per-call enrichments must not wait on one another');
});
