'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');

test('shared-manager save keeps the chosen checks visible and reports success', function () {
  const start = html.indexOf('function sharedManagersControlHtml');
  const end = html.indexOf('// Save-on-change for role', start);
  assert.ok(start !== -1 && end > start, 'shared-manager control block must exist');
  const source = html.slice(start, end);
  assert.match(source, /shared-managers-status-/, 'the manager cell needs a visible save-status location');
  assert.match(source, /✓ Saved/, 'a successful save must say so in the cell');
  assert.doesNotMatch(source, /renderUsersTable\(\);/, 'a successful save must not redraw away the chosen checks');
  assert.match(source, /button\.textContent = 'Saving…'/, 'the button must show an in-flight save');
  assert.match(source, /✗ network/, 'a failed save must say it failed instead of silently clearing the selection');
});
