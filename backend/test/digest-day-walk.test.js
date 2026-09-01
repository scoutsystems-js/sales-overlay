'use strict';
/* ⚠⚠ THE DAY WALK STEPS BY DATE, NOT BY INDEX (2026-09-01).
   Justin, live: "31 Aug jumps to 29 Aug, and Next Day cannot be pressed."
   BOTH symptoms had ONE cause and it was NOT this function: the list holds only
   days that HAVE a digest, and 30 and 31 Aug had none, so the landing day was
   not in the list at all. The walk was right; the DATA was missing.

   ⚠ But the same branch carried a real inversion. `idx === -1` fell back to
   days[0] — the NEWEST day — so on a date OLDER than the whole list, "Prev Day"
   walked you FORWARD. Comparing dates answers every case with no special branch.

   ⚠⚠ THIS TEST EXISTS TO STOP SOMEONE "FIXING" THE SKIP. Landing on 31 Aug and
   stepping to 29 Aug is CORRECT when 30 Aug has no digest — the walk is bounded
   to real days on purpose (an unbounded walk reaches 28 stale days that read
   "quiet day · 0 calls" for days the closer worked). Missing days are a
   GENERATION problem. Do not make this function invent them. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function walker() {
  const a = H.indexOf('function digestDayNavHtml');
  assert.ok(a !== -1, 'stale anchor — the day nav is gone');
  const src = H.slice(a, H.indexOf('\n  }', a) + 4);   // ⚠ fromIndex, and assert the span
  assert.ok(src.length > 800 && src.length < 3000, 'slice must cover it: ' + src.length);
  return new Function('escapeHtml', src + '; return digestDayNavHtml;')(String);
}

// the two buttons, read back out of the markup the real builder produced
function step(html) {
  const prev = (html.match(/selectDigestDate\('(\d{4}-\d\d-\d\d)'[^]*?Prev Day/) || [])[1] || null;
  const next = (html.match(/Prev Day<\/button>[^]*?selectDigestDate\('(\d{4}-\d\d-\d\d)'/) || [])[1] || null;
  return { prev, next };
}

const DAYS = ['2026-08-29', '2026-08-28', '2026-08-27', '2026-08-26'];   // newest first

test('a day INSIDE the list steps one either way', () => {
  const s = step(walker()(DAYS, '2026-08-27'));
  assert.strictEqual(s.prev, '2026-08-26');
  assert.strictEqual(s.next, '2026-08-28');
});

test('the newest day has nothing newer, and the oldest nothing older', () => {
  assert.strictEqual(step(walker()(DAYS, '2026-08-29')).next, null, 'newest: Next must be disabled');
  assert.strictEqual(step(walker()(DAYS, '2026-08-26')).prev, null, 'oldest: Prev must be disabled');
});

test('⚠ JUSTIN\'S CASE — a landing day with no digest steps to the newest that HAS one', () => {
  /* This is the reported symptom and it is CORRECT. 30 Aug has no digest, so
     29 Aug is genuinely the previous day there is anything to show. */
  const s = step(walker()(DAYS, '2026-08-31'));
  assert.strictEqual(s.prev, '2026-08-29', 'must reach the newest day that exists');
  assert.strictEqual(s.next, null, 'nothing newer exists, so Next stays disabled');
});

test('⚠⚠ THE INVERSION: a date OLDER than the whole list must not walk FORWARD', () => {
  /* The defect the old `idx === -1 -> days[0]` fallback shipped: "Prev Day" on a
     deep-linked old date jumped to the NEWEST day in the list. */
  const s = step(walker()(DAYS, '2026-01-01'));
  assert.strictEqual(s.prev, null, 'nothing older exists — Prev must be disabled, never days[0]');
  assert.strictEqual(s.next, '2026-08-26', 'and Next must reach the OLDEST newer day, not the newest');
});

test('an empty or missing list disables both, rather than throwing', () => {
  const w = walker();
  assert.deepStrictEqual(step(w([], '2026-08-31')), { prev: null, next: null });
  assert.deepStrictEqual(step(w(undefined, '2026-08-31')), { prev: null, next: null });
});

test('the disabled end still RENDERS a button — a control that vanishes reads as a bug', () => {
  const html = walker()(DAYS, '2026-08-26');
  assert.ok(/Prev Day/.test(html) && /disabled/.test(html), 'greyed out, not removed');
  assert.ok(/Next Day/.test(html), 'both directions always present');
});
