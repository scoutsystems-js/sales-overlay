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
  assert.ok(/calc\(\(100vw - 1200px\) \/ 4\)/.test(r),
    'the band must be calc((100vw - 1200px) / 4) — half a gutter');
  assert.ok(/max\(0px,/.test(r),
    'below 1200px the gutter is negative — the band must clamp to 0, not invert');
});

test('⚠ it is a HARD EDGE, not a fade — the mesh is not being dimmed', () => {
  const r = meshRule().code;
  const at = r.indexOf('linear-gradient(to left');
  assert.ok(at !== -1, 'the horizontal mask is missing');
  const horiz = r.slice(at, r.indexOf(');', at));
  /* the same offset appears twice — opaque up to it, transparent from it — which
     is what makes the boundary a cut rather than a ramp. */
  const stops = (horiz.match(/max\(0px, calc\(\(100vw - 1200px\) \/ 4\)\)/g) || []).length;
  assert.strictEqual(stops, 2, 'both stops must sit at the same offset, or the edge fades');
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
