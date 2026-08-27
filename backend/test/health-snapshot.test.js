/**
 * THE ACCOUNT HEALTH SNAPSHOT — it must answer the two tickets we actually got.
 *
 * ⚠⚠ THE ORDERING IS THE DESIGN: it leads with WHAT THE USER CAN SEE. Both
 * tickets were reported as broken syncs and neither was one. Godwin's was a
 * WORKING sync — 121 fetched, 121 inserted, 20 graded by the first-sync cap —
 * with nothing on screen about the other 101. A snapshot reporting system state
 * alone answers that "everything is fine", which is what a human already said.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const hs = require('../lib/health-snapshot');

const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

const GODWIN = {
  connected: true, providers: ['Zoom'], total: 124, graded: 21, waiting: 101,
  failed_retryable: 0, failed_permanent: 2, first_sync_capped: true,
  last_sync: { status: 'ok', fetched: 121, inserted: 121, analyzed: 20 },
};

test('⚠⚠ THE GODWIN TICKET: working, and incomplete on screen — not "fine"', () => {
  const v = hs.verdict(GODWIN);
  assert.match(v, /WORKING/, 'the sync did work — saying it is broken would be wrong too');
  assert.match(v, /INCOMPLETE ON SCREEN/, 'and the gap he reported must be the headline');
  assert.match(v, /101 waiting/, 'with the number, so nobody has to query for it');
});

test('and it names the CAP, which is why 121 synced and 20 graded', () => {
  const seen = hs.visibleState(GODWIN).join(' ');
  assert.match(seen, /FIRST sync/, 'the cap is the explanation and must be stated');
  assert.match(seen, /121/);
  assert.match(seen, /graded 20/);
});

test('⚠ "working but invisible" is its OWN verdict — collapsing it into WORKING is the bug', () => {
  const healthy = hs.verdict({ connected: true, providers: ['Fathom'], total: 119, graded: 119, waiting: 0,
    failed_retryable: 0, failed_permanent: 0, last_sync: { status: 'ok', fetched: 5, inserted: 0 } });
  assert.match(healthy, /HEALTHY/);
  assert.notStrictEqual(healthy, hs.verdict(GODWIN), 'the two states must not read the same');
});

test('⚠⚠ THE JOSH TICKET: a working sync that returns nothing points at THEIR settings', () => {
  const v = hs.verdict({ connected: true, providers: ['Zoom'], total: 0, graded: 0, waiting: 0,
    failed_retryable: 0, failed_permanent: 0, last_sync: { status: 'ok', fetched: 0, inserted: 0 } });
  assert.match(v, /NOTHING TO READ/);
  assert.match(v, /recording settings, not Scout/, 'it must say whose side to look at');
});

test('a genuinely failed sync says BROKEN and carries the reason', () => {
  const v = hs.verdict({ connected: true, providers: ['Zoom'], total: 3, graded: 3, waiting: 0,
    failed_retryable: 0, failed_permanent: 0, last_sync: { status: 'error', error: 'token expired' } });
  assert.match(v, /BROKEN/);
  assert.match(v, /token expired/, 'the reason must travel with the verdict');
});

test('no connection is ACTION NEEDED, not an error', () => {
  const o = { connected: false, providers: [], total: 0, graded: 0, waiting: 0,
    failed_retryable: 0, failed_permanent: 0, last_sync: {} };
  assert.match(hs.verdict(o), /ACTION NEEDED/);
  assert.match(hs.visibleState(o).join(' '), /No recording source connected/);
});

test('⚠ FAILED CALLS STAY SPLIT — an action and a fact are different things', () => {
  const seen = hs.visibleState(GODWIN).join(' ');
  assert.match(seen, /cannot be graded at all/, 'permanent failures must not read as a to-do');
  assert.match(seen, /Retrying will not help/,
    'or the number never reaches zero and stops being read');
});

test('⚠⚠ THE ROUTE IS OWNER-ONLY, ENFORCED SERVER-SIDE', () => {
  const at = ADMIN.indexOf("router.get('/users/:user_id/health'");
  assert.ok(at !== -1, 'stale anchor: the health route');
  const head = ADMIN.slice(at, at + 200);
  assert.ok(/requireAuth/.test(head) && /requireRole\('owner'\)/.test(head),
    'it reports another person\'s account state — never gated by hiding a control');
});

test('⚠ classifyFailure is IMPORTED — a called-but-undeclared identifier passes every static check', () => {
  assert.ok(/require\('\.\.\/lib\/failure-class'\)/.test(ADMIN),
    'this exact omission took down add-user for days with a silent ReferenceError');
});
