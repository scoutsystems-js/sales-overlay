'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Scout AI has a private question page, not a new dashboard metric', () => {
  const file = path.join(__dirname, '..', 'web', 'scout-ai.html');
  assert.ok(fs.existsSync(file), 'Scout AI needs its own question page');
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /Ask Scout/i);
  assert.match(source, /\/scout-ai\/ask/);
  assert.match(source, /Evidence/i);
  assert.match(source, /Most raised objection/);
  assert.match(source, /Best documented handlers/);
  assert.doesNotMatch(source, /spouse-objection cohort close rate/i);
});
