'use strict';
/* ⚠⚠ THE MESH IS A RIGHT-HAND BAND, HALF A GUTTER WIDE (Justin, 2026-09-01).
   ⚠ SAFETY IS LAYOUT, NOT FAINTNESS — the standing ruling. This change removes
   artwork from the left; it does NOT dim what remains, and a future edit must
   not "improve" it by lowering the layer opacity. Text is kept off the artwork
   by opaque containers and, on the five team views, by the ground.

   ⚠⚠ IT IS DONE ON THE MESH, NOT BY WIDENING THE GROUND, AND THE REASON IS
   MEASURED: the ground (`.page { background: var(--bg) }`) exists on FIVE views
   only — the other seven have a transparent .page. Widening the ground would
   have fixed five pages and left seven two-sided. What sits behind the layer is
   <html>, whose background IS var(--bg) — the same colour the ground paints —
   so clipping the artwork off the left vacates that gutter to the ground colour
   on EVERY view, for free. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function meshRule() {
  // ⚠ the FIRST body[data-view]::before is archived in a comment block; take the
  //   live one by stripping comments before locating it
  const live = H.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const at = live.indexOf('body[data-view]::before {');
  assert.ok(at !== -1, 'stale anchor — the mesh layer is gone');
  const end = H.indexOf('\n    }', at);
  const rule = H.slice(at, end);
  /* ⚠ ASSERT ON THE COMMENT-STRIPPED LENGTH. This rule is 91% comment (12,589
     raw against 1,077 of actual CSS), so a raw bound is meaningless here — a
     first version capped at 6000 and failed on correct code. The stripped size
     is what "did the slice cover one rule" actually means. */
  const code = rule.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(code.length > 400 && code.length < 2500, 'slice must cover one rule: ' + code.length);
  assert.strictEqual((code.match(/\{/g) || []).length, 1, 'the slice must hold exactly one rule');
  return { rule: rule, code: code };
}

test('the band is derived from the column, not a picked pixel value', () => {
  const r = meshRule().code;
  /* half a gutter: the column is 1200, each gutter (100vw - 1200px)/2, half of
     one is /4. A hard-coded px band would be wrong at every other viewport. */
  /* ⚠ THE FORMULA GAINED THE SIDEBAR (2026-09-01) AND HAD TO. The band is half
     a gutter, and the gutter is the space the COLUMN sits in — which a fixed
     190px sidebar has just narrowed. Left on (100vw - 1200px)/4 the band would
     be sized against a gutter that no longer exists and slide artwork under the
     content. ONE token feeds both the page margin and this. */
  /* 2026-09-02 — BOTH GUTTERS. The mask's stops are the column's OWN layout
     tokens (--page-left / --page-w), so the artwork is cut exactly where the
     .page column begins and ends and cannot slide under text however the
     viewport moves. Asserting the TOKENS, not a formula: the formula lives in
     ONE place (:root) and this guard checks the three consumers read it. */
  assert.ok(/rgba\(0,0,0,1\) var\(--page-left\)/.test(r) && /rgba\(0,0,0,0\) var\(--page-left\)/.test(r),
    'the LEFT edge of the black centre must sit at var(--page-left)');
  assert.ok(/calc\(var\(--page-left\) \+ var\(--page-w\)\)/.test(r),
    'the RIGHT edge must sit at page-left + page-w — the column\'s own width');
  const tokAt = H.indexOf('--rail-total:'); assert.ok(tokAt > -1, 'stale anchor — the rail tokens');
  const root = H.slice(tokAt - 200, tokAt + 600);
  assert.ok(/--page-left:\s*max\(var\(--rail-total\), calc\(\(100vw - 1200px\) \/ 2\)\)/.test(root),
    '--page-left must be derived: packed against the rail, or centred when there is room');
  assert.ok(/--page-w:\s*min\(1200px, calc\(100vw - var\(--rail-total\) - 24px\)\)/.test(root),
    '--page-w must leave the 24px right band by construction');
  const page = H.slice(H.indexOf('.page {\n      /* ⚠ --page-left'), H.indexOf('.page {\n      /* ⚠ --page-left') + 900);
  assert.ok(/margin-left:\s*var\(--page-left\)/.test(page) && /max-width:\s*var\(--page-w\)/.test(page),
    'the .page column must read the SAME tokens the mask reads');
});

test('⚠ it is a HARD EDGE, not a fade — the mesh is not being dimmed', () => {
  const r = meshRule().code;
  const at = r.indexOf('linear-gradient(to right');
  assert.ok(at !== -1, 'the horizontal mask is missing');
  const horiz = r.slice(at, r.indexOf(');', at));
  /* the same offset appears twice — opaque up to it, transparent from it — which
     is what makes the boundary a cut rather than a ramp. */
  const left = (horiz.match(/\) var\(--page-left\)/g) || []).length;
  const right = (horiz.match(/calc\(var\(--page-left\) \+ var\(--page-w\)\)/g) || []).length;
  assert.strictEqual(left, 2, 'the left edge needs two stops at the same offset, or it fades');
  assert.strictEqual(right, 2, 'the right edge needs two stops at the same offset, or it fades');
});

test('⚠⚠ it INTERSECTS the vertical fade, never replaces it', () => {
  const r = meshRule().code;
  /* The vertical gradient is the derived smoothstep top-fade — its slope is zero
     at both ends so the ramp has no corner for Mach banding to catch. Replacing
     mask-image instead of compositing would silently delete it. */
  assert.ok(/mask-composite:\s*intersect/.test(r), 'standard mask-composite must be intersect');
  assert.ok(/-webkit-mask-composite:\s*source-in/.test(r), 'and the -webkit- form');
  assert.ok(/22%/.test(r) && /96%/.test(r), 'the vertical smoothstep stops must survive');
  assert.ok(/linear-gradient\(to bottom/.test(r), 'the vertical layer must still be there');
});

test('⚠ the layer is NOT dimmed to achieve this', () => {
  const r = meshRule().code;
  const m = r.match(/\n\s*opacity:\s*([\d.]+)/);
  assert.ok(m, 'stale anchor — the layer opacity');
  assert.strictEqual(m[1], '1',
    'the mesh renders at full strength; narrowing is layout, dimming is the thing the ruling forbids');
});
