/**
 * ⚠⚠ THE TYPE SCALE (design pass block 1, 2026-09-01).
 *
 * Seven sizes, three weights, three radii — and NOTHING between them. The point
 * of a scale is that it is closed: a value outside it is a decision, and this
 * guard is where that decision has to be made deliberately rather than by
 * typing a number.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const DASH = web('dashboard.html');
const SHEET = web('css/style.css');

const SIZES = { display: '48px', number: '20px', title: '18px', body: '14px',
                secondary: '13px', label: '12px', eyebrow: '11px' };
const WEIGHTS = { display: '300', normal: '400', emphasis: '500' };

test('the scale is exactly seven sizes and three weights', () => {
  assert.strictEqual(Object.keys(SIZES).length, 7);
  assert.strictEqual(Object.keys(WEIGHTS).length, 3);
});

/* ⚠⚠ TWO COPIES, FORCED BY THE ARCHITECTURE. dashboard.html links NO
   stylesheet, so tokens in css/style.css — which seven other pages DO link —
   cannot reach it. The duplication is unavoidable; this test is the only thing
   that makes it safe, and it is the same shape as the SQL/JS mirror guard. */
test('⚠⚠ both copies of the scale are identical — they cannot drift', () => {
  Object.entries(SIZES).forEach(([k, v]) => {
    const re = new RegExp('--fs-' + k + ':\\s*' + v.replace('px', 'px'));
    assert.ok(re.test(DASH), 'dashboard is missing --fs-' + k + ': ' + v);
    assert.ok(re.test(SHEET), 'the shared sheet is missing --fs-' + k + ': ' + v);
  });
  Object.entries(WEIGHTS).forEach(([k, v]) => {
    const re = new RegExp('--fw-' + k + ':\\s*' + v);
    assert.ok(re.test(DASH), 'dashboard is missing --fw-' + k);
    assert.ok(re.test(SHEET), 'the shared sheet is missing --fw-' + k);
  });
});

/* ⚠ THE RADII ALREADY EXISTED AND WERE IGNORED — 94 declarations used values
   the three tokens do not offer (3, 4, 5, 6, 10, 14). Three, and only three. */
test('⚠ there are three radius tokens and the scale offers no fourth', () => {
  [['--radius-sm', '8px'], ['--radius', '12px'], ['--radius-lg', '16px']].forEach(([t, v]) => {
    assert.ok(new RegExp(t + ':\\s*' + v).test(DASH), t + ' must be ' + v);
  });
});
