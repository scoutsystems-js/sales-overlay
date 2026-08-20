/**
 * THE LAYER MUST COVER THE VIEWPORT — no bare region, at any width.
 *
 * ⚠⚠ THE PROPERTY SURVIVED THE TREATMENT CHANGE; ITS MECHANISM DID NOT.
 * This suite was written for the mesh, where coverage was bought with
 * `background-size: 200% 200%` plus a per-view percentage offset — the field
 * rendered twice the element, so any offset in 0-100% still covered it. That
 * arithmetic existed because of a real bug: `cover` with PIXEL offsets pushed
 * the field off-screen and `no-repeat` left the vacated area BARE, and the
 * account view rendered ~95% empty while a per-view sweep called it fine.
 *
 * Under Justin's 2026-08-20 rulings there is ONE image at ONE position
 * (`cover`, `50% 50%`, no offsets at all), so coverage is guaranteed by the
 * definition of `cover` rather than by an offset budget. The old arithmetic
 * tests are therefore RETIRED — not because coverage stopped mattering, but
 * because the quantity they computed no longer exists.
 *
 * ⚠ WHAT STILL PROTECTS THE PROPERTY:
 *   - `background-size: cover` is pinned here and in team-background.test.js.
 *   - Offsets are pinned at ZERO (no per-view rules) in team-background.test.js.
 *   - `background-attachment` stays fixed to the viewport, which is what makes
 *     a percentage position well-defined in the first place.
 * ⚠ WHAT IS NO LONGER PROTECTED, STATED PLAINLY: nothing now checks an offset
 *   BUDGET, because there is no offset. If per-view positions are ever
 *   reintroduced, the 200%-or-cover arithmetic has to come back with them —
 *   reintroducing offsets under `cover` alone is the original bug.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = RAW.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function paintingRule() {
  const at = LIVE.indexOf('body[data-view]::before {');
  assert.ok(at > -1, 'the painting rule must exist');
  const rule = LIVE.slice(at, LIVE.indexOf('}', at) + 1);
  assert.ok(rule.length > 80 && rule.length < 3000, 'slice length ' + rule.length);
  return rule;
}

test('⚠⚠ COVER GUARANTEES COVERAGE — no bare region is possible at any width', () => {
  const rule = paintingRule();
  assert.ok(/background-size:\s*cover/.test(rule),
    'cover is what makes coverage width-independent now');
  // ⚠ and no offset may reintroduce the bare-area bug
  const pos = rule.match(/background-position:\s*([^;]+);/);
  assert.ok(pos, 'a position must be declared');
  assert.strictEqual(pos[1].trim(), '50% 50%',
    'centred; any other value needs the coverage arithmetic re-derived');
});

test('⚠ PERCENTAGES, NEVER PIXELS — a px offset covers at one width only', () => {
  const rule = paintingRule();
  const pos = rule.match(/background-position:\s*([^;]+);/)[1];
  assert.ok(!/px/.test(pos),
    'a px offset that covers at 1600 leaves a gap at 1440 — the rendered size ' +
    'follows the viewport, a px offset does not');
});

test('⚠ the layer is fixed to the VIEWPORT, which is what makes % well-defined', () => {
  const rule = paintingRule();
  assert.ok(/position:\s*fixed/.test(rule), 'fixed to the viewport');
  assert.ok(/inset:\s*0/.test(rule), 'and spans it');
});

test('⚠ NON-VACUITY — the position guard fires on a px offset', () => {
  const broken = paintingRule().replace('background-position: 50% 50%',
                                        'background-position: -1200px -667px');
  const pos = broken.match(/background-position:\s*([^;]+);/)[1];
  assert.ok(/px/.test(pos), 'the fixture must actually contain px');
  assert.notStrictEqual(pos.trim(), '50% 50%',
    'non-vacuity: a reintroduced px offset must be detectable');
});
