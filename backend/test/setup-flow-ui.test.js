'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const web = path.join(__dirname, '..', 'web');

test('recording setup keeps distinct Fathom and Zoom entry routes and OAuth actions', () => {
  const page = fs.readFileSync(path.join(web, 'connect.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(server, /\['\/connect', '\/connect\/fathom', '\/connect\/zoom'\]/);
  assert.match(page, /href="\/connect\/fathom"/);
  assert.match(page, /href="\/connect\/zoom"/);
  assert.match(page, /fetch\('\/auth\/' \+ which \+ '\/connect'/);
  assert.match(page, /login\?return=/);
});

test('calendar setup preserves its private-use disclosure before the connection action', () => {
  const page = fs.readFileSync(path.join(web, 'calendar.html'), 'utf8');
  assert.ok(page.indexOf('id="calendarDataUse"') < page.indexOf('id="calendarConnection"'));
  assert.match(page, /90 days before today through 90 days after today/i);
  assert.match(page, /does not save descriptions, meeting links, attendee names or arrays/i);
});

test('password and OAuth completion screens use the shared Observatory access treatment without replacing their flows', () => {
  const password = fs.readFileSync(path.join(web, 'set-password.html'), 'utf8');
  const connected = fs.readFileSync(path.join(web, 'connected.html'), 'utf8');
  assert.match(password, /<body class="password-observatory">/);
  assert.match(password, /function parseFragment\(\)/);
  assert.match(password, /fetch\('\/auth\/set-password'/);
  assert.match(connected, /<body class="cx-observatory">/);
  assert.match(connected, /BroadcastChannel\('scout-oauth'\)/);
  assert.match(connected, /document\.body\.dataset\.connectionStatus = status/);
});
