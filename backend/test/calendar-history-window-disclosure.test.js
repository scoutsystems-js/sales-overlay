'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'web');
const DISCLOSURES = [
  path.join(WEB, 'js', 'scout-calendar.js'),
  path.join(WEB, 'js', 'scout-calendar-account.js'),
  path.join(WEB, 'privacy.html'),
  path.join(WEB, 'calendar.html'),
];

test('every calendar data-use disclosure states both 90-day capture directions', () => {
  for (const file of DISCLOSURES) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /90(?: calendar)? days before today/i, file + ' states the past capture boundary');
    assert.match(source, /90(?: calendar)? days after today/i, file + ' states the future capture boundary');
  }
});
