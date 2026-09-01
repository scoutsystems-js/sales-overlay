'use strict';
/* ⚠⚠ A SCORE IS COLOURED ONLY WHEN IT CROSSES A BAND (Justin, 2026-09-01).
   ⚠ AND THE PREMISE FOR ONE OF THE THREE SURFACES WAS WRONG: the Coach Summary
   bars were reported as "identical amber regardless of score". They are not —
   `scoreColor` has banded since it was written (>=70 good, >=50 mid, else bad).
   The five bars were amber because all five scores were 51-65, INSIDE ONE BAND.
   The colour CAN vary; it did not on that rep's data. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const live = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function fn(name, end) {
  const a = live.indexOf('function ' + name);
  assert.ok(a !== -1, 'anchor missing: ' + name);
  const b = live.indexOf(end, a);
  assert.ok(b !== -1, 'end marker missing');
  const t = live.slice(a, b + end.length);
  assert.ok(t.length > 80 && t.length < 4000, 'slice sane: ' + t.length);
  return t;
}

test('⚠⚠ ONE set of thresholds — the badge must not invent a second', () => {
  const sc = fn('scoreColor', '\n  }');
  assert.ok(/s >= 70/.test(sc) && /s >= 50/.test(sc), 'scoreColor bands at 70 and 50');
  const badge = fn('libraryStatusBadgeHtml', '\n  }');
  assert.ok(/overallScore >= 70/.test(badge), 'the badge uses the SAME upper threshold');
  assert.ok(/overallScore >= 50/.test(badge), 'and the SAME lower one');
  /* ⚠ A second set of thresholds for the same quantity is how two surfaces come
     to disagree about what a 69 means. */
});

test('the score badge is banded, not green at every score', () => {
  const badge = fn('libraryStatusBadgeHtml', '\n  }');
  ['score-good', 'score-mid', 'score-bad'].forEach((c) =>
    assert.ok(badge.indexOf(c) !== -1, 'must compute ' + c));
  /* ⚠⚠ AND THE BAND MUST REACH THE OUTPUT. My first version asserted only that
     the function CONTAINED the class names — which stayed true when the return
     was reverted to the un-banded form, because the `var band = ...` assignment
     was still sitting there computing a value nobody used. Fourth instance of
     a guard aimed at the helper rather than the call site. */
  assert.ok(/library-status-badge done ' \+ band \+ '/.test(badge),
    'the computed band must be in the rendered className, not merely computed');
  // ...and RUN it, which is the only check that cannot be satisfied by a dead variable
  const f = new Function('escapeHtml', 'return ' + badge + '; ');
  const build = f((x) => String(x));
  assert.ok(/score-good/.test(build('done', 75)), '75 -> good');
  assert.ok(/score-mid/.test(build('done', 52)),  '52 -> mid, not the same as 75');
  assert.ok(/score-bad/.test(build('done', 38)),  '38 -> bad');
  assert.strictEqual(/score-good/.test(build('done', 52)), false, '52 must NOT be green');
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  assert.ok(/score-mid\s*\{[^}]*var\(--mid\)/.test(css), 'mid renders amber');
  assert.ok(/score-bad\s*\{[^}]*var\(--bad\)/.test(css), 'bad renders red');
});

test('⚠⚠ the objection category is NEVER green — it names the WEAKEST area', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  const m = css.match(/\n\s*\.objsum-cat\s*\{([^}]*)\}/);
  assert.ok(m, '.objsum-cat rule missing');
  assert.strictEqual(/var\(--accent\)|var\(--good\)/.test(m[1]), false,
    'a negative finding must not wear the colour that means good: ' + m[1].trim());
  /* ⚠ AND IT IS NOT RED EITHER — the category is a LABEL, not a verdict; the
     rate beside it carries the judgement. */
  assert.strictEqual(/var\(--bad\)/.test(m[1]), false, 'nor is a label a verdict');
});

test('⚠ .review-why stays exempt — it is an OUTCOME, not a score', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  assert.ok(/\.review-why\.win\s*\{[^}]*var\(--good\)/.test(css),
    'green on a WIN is correct and is a ruled exemption');
});
