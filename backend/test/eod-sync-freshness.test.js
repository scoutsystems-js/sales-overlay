/**
 * EOD MUST SAY WHEN THE DAY IS INCOMPLETE.
 *
 * ⚠⚠ THE REPORT: "Josh's EOD for Aug 24 shows 3 calls. He has taken 6."
 * Investigated 2026-08-24 — THE NUMBER 3 IS CORRECT for what Scout holds:
 *
 *   17:0x  fathom   ✓ on his account
 *   18:0x  fathom   ✓
 *   19:01  ZOOM ONLY — no Fathom recording exists, and his account has no
 *                      Zoom connection, so it can never appear
 *   20:0x  fathom   ✓
 *   22:0x  fathom   NOT SYNCED YET (his last Fathom sync was 22:34)
 *   23:02  fathom   NOT SYNCED YET
 *
 * EOD reads `fathom_calls` and LEFT-joins analyses, so it counts SYNCED calls,
 * not analysed ones — the grading backlog is NOT the cause here.
 *
 * ⚠ SO THE FIX IS THE WORDING, NOT THE NUMBER. Inflating the count would make
 * the page show calls the data cannot support. What was missing is any
 * indication that the day is still filling up: "3" and "3, so far" look
 * identical, and only one of them is honest.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { syncFreshness } = require('../lib/eod-freshness');

const DAY = '2026-08-24';

test('⚠⚠ A DAY WITH CALLS NEWER THAN THE LAST SYNC IS FLAGGED INCOMPLETE', () => {
  /* Josh's exact shape: synced at 22:34, and the day runs to 04:00Z the next
     morning, so anything he records after 22:34 is missing and nothing on the
     page says so. */
  const f = syncFreshness({
    date: DAY,
    lastSyncAt: '2026-08-24T22:34:24Z',
    dayEndsIso: '2026-08-25T04:00:00Z',
    now: new Date('2026-08-25T00:30:00Z'),
  });
  assert.strictEqual(f.complete, false, 'the day is still open past the last sync');
  assert.ok(f.synced_through, 'it must say what it is complete UP TO');
  assert.strictEqual(f.synced_through, '2026-08-24T22:34:24Z');
});

test('⚠ A FINISHED DAY THAT WAS SYNCED AFTERWARDS IS COMPLETE — no false warning', () => {
  /* A warning on every historical day would be noise, and noise is how a real
     warning gets ignored. */
  const f = syncFreshness({
    date: '2026-08-20',
    lastSyncAt: '2026-08-24T23:54:59Z',
    dayEndsIso: '2026-08-21T04:00:00Z',
    now: new Date('2026-08-25T00:30:00Z'),
  });
  assert.strictEqual(f.complete, true, 'the sync happened after the day ended');
});

test('⚠⚠ NEVER SYNCED IS NOT THE SAME AS SYNCED-AND-EMPTY', () => {
  /* absent vs known-absent, the standing rule. A connection that has never
     synced cannot claim the day is complete. */
  const f = syncFreshness({ date: DAY, lastSyncAt: null, dayEndsIso: '2026-08-25T04:00:00Z', now: new Date() });
  assert.strictEqual(f.complete, false);
  assert.strictEqual(f.synced_through, null, 'and it must not invent a time');
});

test('⚠ NO CONNECTION AT ALL IS REPORTED AS SUCH, not as an incomplete sync', () => {
  const f = syncFreshness({ date: DAY, lastSyncAt: null, connected: false, dayEndsIso: '2026-08-25T04:00:00Z', now: new Date() });
  assert.strictEqual(f.connected, false);
  assert.strictEqual(f.complete, false);
});

test('degenerate input never throws', () => {
  [undefined, {}, { date: 'nope' }, null].forEach((v) => {
    const f = syncFreshness(v);
    assert.strictEqual(typeof f.complete, 'boolean');
  });
});

/* ── the route and the page must actually carry it ────────────────────────── */

test('⚠⚠ BOTH EOD EXITS RETURN sync — the EMPTY day is the one that misleads most', () => {
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'routes', 'eod.js'), 'utf8');
  const hits = (src.match(/sync:\s*freshness/g) || []).length;
  assert.strictEqual(hits, 2,
    'the early "no calls" return and the normal return must BOTH carry it; a '
    + 'day showing zero calls with no explanation is the worst version of this bug. Found ' + hits);
});

test('⚠ THE PAGE RENDERS THE NOTE, and above the list rather than under it', () => {
  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const live = html.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(/function eodSyncNoteHtml/.test(live), 'the helper must exist');
  assert.ok(/\+ eodSyncNoteHtml\(d\.sync\)/.test(live),
    'and be CALLED — a builder nothing calls is the defect shape this codebase keeps hitting');
  const i = live.indexOf('+ eodSyncNoteHtml(d.sync)');
  const j = live.indexOf('+ toolbar + body', i);
  assert.ok(j > i, 'the note must render ABOVE the toolbar and list');
});

test('⚠ THE NOTE NEVER INFLATES THE COUNT — it only adds the caveat', () => {
  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const i = html.indexOf('function eodSyncNoteHtml');
  const fn = html.slice(i, html.indexOf('\n  }', i));
  assert.ok(!/calls\.length|d\.calls/.test(fn),
    'the note must not touch the call list — the number is correct and only the '
    + 'wording was wrong');
});
