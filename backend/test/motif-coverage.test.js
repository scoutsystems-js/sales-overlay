/**
 * ⚠⚠ THE GUARD THAT DID NOT EXIST — IT ASSERTS THE **PAINTED** RESULT.
 *
 * Fifteen windows were swept individually and every one passed while FOURTEEN
 * rendered mostly bare. The account view was ~95% empty with the mesh in one
 * corner, and the sweep called it fully covered.
 *
 * WHY THE OLD SWEEP COULD NOT SEE IT: it sampled FIELD COORDINATES. It measured
 * what the ARTWORK contains in a region — correctly, every time — and the defect
 * lived in the TRANSFORM between field and screen (background-size + position +
 * repeat). No amount of sampling the artwork could ever have reached it.
 *
 * So this guard reasons in the SCREEN's space: given the declared size, the
 * per-view position and the repeat mode, does the image still cover the element
 * at every view and at every width we support?
 *
 * ⚠ Without this, the next offset change re-opens the same hole silently.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '');

function layerRule() {
  const at = LIVE.indexOf('body[data-view]::before {');
  assert.ok(at !== -1, 'stale anchor — the layer rule moved');
  const rule = LIVE.slice(at, LIVE.indexOf('\n    }', at));
  assert.ok(rule.length > 100 && rule.length < 2000, 'slice suspicious: ' + rule.length);
  return rule;
}

/** Resolve background-size to a multiple of the element, per axis. */
function sizeMultiple(rule) {
  const m = rule.match(/background-size:\s*([^;]+);/);
  assert.ok(m, 'the layer must declare a background-size');
  const v = m[1].trim();
  assert.ok(!/cover|contain/.test(v),
    '`' + v + '` sizes the image FROM the element, so an offset cannot stay '
    + 'covered — this is the exact bug that left the account view 95% bare');
  const pcts = v.match(/(\d+)%/g);
  assert.ok(pcts && pcts.length >= 1, 'size must be expressed in % of the element: ' + v);
  const x = parseInt(pcts[0], 10) / 100;
  const y = parseInt(pcts[pcts.length - 1], 10) / 100;
  return { x, y };
}

const VIEW_POS = [...LIVE.matchAll(
  /body\[data-view="([a-z-]+)"\]::before \{ background-position: (\d+)% (\d+)%; \}/g)];

test('⚠⚠ the layer COVERS the element at every view — computed in the screen\'s space', () => {
  const rule = layerRule();
  const size = sizeMultiple(rule);
  assert.ok(/background-repeat:\s*no-repeat/.test(rule),
    'this guard assumes no-repeat — with repeat, coverage is trivially true and '
    + 'the check must be rewritten rather than silently passing');
  /* ⚠ 14, NOT 15, SINCE 2026-08-20 — a CORRECTION, not a weakening. The `team`
   view is raster-backed now and has no mesh window to own; every remaining
   mesh view must still have its own. Raise this if a view is added. */
  assert.ok(VIEW_POS.length >= 14, 'expected a window per mesh-backed view, got ' + VIEW_POS.length);

  VIEW_POS.forEach((m) => {
    const [, view, xs, ys] = m;
    const px = Number(xs) / 100, py = Number(ys) / 100;
    /* CSS percentage positioning aligns the p-point of the IMAGE with the
       p-point of the ELEMENT. With image = size × element, the image's left edge
       lands at  -(size - 1) × p × element  and its right edge at that + size.
       Coverage requires left <= 0 AND right >= 1 (in element widths). */
    const leftX = -(size.x - 1) * px, rightX = leftX + size.x;
    const topY = -(size.y - 1) * py, botY = topY + size.y;
    assert.ok(leftX <= 1e-9 && rightX >= 1 - 1e-9,
      view + ': horizontal gap at ' + xs + '% — image spans ' + leftX.toFixed(2)
      + '..' + rightX.toFixed(2) + ' element-widths, needs 0..1');
    assert.ok(topY <= 1e-9 && botY >= 1 - 1e-9,
      view + ': vertical gap at ' + ys + '% — image spans ' + topY.toFixed(2)
      + '..' + botY.toFixed(2) + ' element-heights, needs 0..1');
  });
});

test('⚠⚠ coverage is WIDTH-INDEPENDENT — px offsets are the trap in miniature', () => {
  /* A px offset that covers at 1600px wide leaves a bare band at 1440px, because
     the RENDERED SIZE follows the viewport while the offset does not. Percent
     offsets scale with the element and therefore cannot fail at one width and
     pass at another — which is why the assertion above needs no width loop. */
  VIEW_POS.forEach((m) => {
    assert.ok(!/px/.test(m[0]),
      m[1] + ' uses a px offset: ' + m[0].trim());
  });
  const rule = layerRule();
  assert.ok(!/background-size:[^;]*\dpx/.test(rule),
    'background-size must be element-relative too, or width-independence is lost');
});

test('⚠ the layer is fixed to the VIEWPORT, which is what makes % well-defined', () => {
  const rule = layerRule();
  assert.ok(/position:\s*fixed/.test(rule), 'the layer must be viewport-fixed');
  assert.ok(/inset:\s*0/.test(rule), 'and fill it, or the percentages resolve against something else');
});
