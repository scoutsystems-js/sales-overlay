/**
 * ⚠ DIGEST DAY NAVIGATION — Prev Day / Next Day replaces the chip row.
 *
 * Justin: "the dates going backwards but moving to the right just looks off."
 *
 * ⚠⚠ THE WALK IS BOUNDED TO `recent_dates`, AND THAT IS THE LOAD-BEARING CHOICE.
 * 35 digest days exist for this account, back to 2026-07-21, but the chip row
 * only ever offered SEVEN — and days 8+ were generated before the manager-missing
 * fix, so they read "quiet day · 0 calls" for days the closer worked (08-17 had
 * 6 real calls, 08-16 had 4, 08-14 had 6). The 7-day cap was accidentally
 * shielding the user from 28 stale days. An UNBOUNDED walk would reach the first
 * of them in one click past the end and present it as the current view.
 *
 * So the control walks exactly the days the chips offered. Same exposure, new
 * shape — a navigation change must not smuggle in a data regression.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function stripComments(src) {
  const noLine = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}
const LIVE = stripComments(HTML);

function navSource() {
  const at = LIVE.indexOf('function digestDayNavHtml');
  assert.ok(at !== -1, 'stale anchor: digestDayNavHtml is gone');
  const end = LIVE.indexOf('\n  }', at);
  assert.ok(end !== -1, 'stale end marker');
  const src = LIVE.slice(at, end + 4);
  assert.ok(src.length > 400 && src.length < 3000, 'nav slice is ' + src.length + ' chars');
  return src;
}
/** run the real builder */
function nav(recents, date) {
  const f = new Function('escapeHtml', navSource() + '\n; return digestDayNavHtml;');
  return f((x) => String(x))(recents, date);
}

const WEEK = ['2026-08-24','2026-08-23','2026-08-22','2026-08-21','2026-08-20','2026-08-19','2026-08-18'];

test('THE CHIP ROW IS GONE', () => {
  assert.ok(!/digest-date-chip/.test(LIVE), 'the chips must not render any more');
  assert.ok(!/class="digest-date-row"/.test(LIVE), 'and neither must their row');
});

test('the date is still shown — a bare arrow is worse than the chips', () => {
  assert.match(nav(WEEK, '2026-08-22'), /2026-08-22/);
});

test('BOTH directions exist — a one-way control strands the reader', () => {
  const h = nav(WEEK, '2026-08-22');
  assert.match(h, /Prev Day/);
  assert.match(h, /Next Day/);
  assert.match(h, /selectDigestDate\('2026-08-23'\)/, 'Next steps toward the newer day');
  assert.match(h, /selectDigestDate\('2026-08-21'\)/, 'Prev steps toward the older day');
});

test('⚠ AT THE OLDEST DAY, PREV IS DISABLED — not silently dead', () => {
  const h = nav(WEEK, '2026-08-18');
  assert.match(h, /Prev Day/, 'still visible, so the end of history is legible');
  /* ⚠ Math.max(0, …): slice() with a NEGATIVE first argument counts from the
     END of the string and silently returns the wrong window — the same slice
     fault that has bitten twice already in this repo. */
  const pi = h.indexOf('Prev Day');
  const prev = h.slice(Math.max(0, pi - 220), pi);
  assert.ok(prev.length > 20, 'window too small to be meaningful: ' + prev.length);
  assert.match(prev, /disabled/, 'Prev must be disabled at the oldest day');
});

test('⚠ AT THE NEWEST DAY, NEXT IS DISABLED — it cannot walk into a day with no digest', () => {
  const h = nav(WEEK, '2026-08-24');
  const ni = h.indexOf('Next Day');
  const next = h.slice(Math.max(0, ni - 220), ni);
  assert.ok(next.length > 20, 'window too small to be meaningful: ' + next.length);
  assert.match(next, /disabled/, 'the digest is structurally a day behind; there is no newer day');
});

test('⚠ THE WALK CANNOT LEAVE recent_dates — 28 stale days sit just beyond it', () => {
  const older = ['2026-08-24','2026-08-23'];
  const h = nav(older, '2026-08-23');
  assert.ok(!/2026-08-22/.test(h), 'must not offer a day the API did not return');
});

test('an unknown current date degrades safely rather than throwing', () => {
  const h = nav(WEEK, '2026-07-04');
  assert.ok(typeof h === 'string' && h.length > 0);
  assert.match(h, /2026-07-04/, 'it still shows where you are');
});

test('empty or missing recents does not produce a broken control', () => {
  [[], null, undefined].forEach((r) => {
    const h = nav(r, '2026-08-24');
    assert.ok(typeof h === 'string', String(r));
    assert.match(h, /disabled/, 'with nowhere to go, both directions are disabled');
  });
});

test('Title Case labels, per the house rule', () => {
  const h = nav(WEEK, '2026-08-22');
  assert.ok(!/Prev day|Next day/.test(h), 'labels are Title Case');
});
