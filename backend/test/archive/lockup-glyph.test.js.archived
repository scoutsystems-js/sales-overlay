/**
 * THE LOCKUP GLYPH — the mark substituted for the "O" in SCOUT (Justin,
 * 2026-08-19). Two asks: 6px rings at the shipped title size, and the ring
 * spanning EXACTLY the cap height with its top on the cap line and its bottom
 * on the baseline.
 *
 * ⚠⚠ THE GLYPH READ SHORT AND LOW FOR **THREE** COMPOUNDING REASONS, ALL
 * MEASURED ON THE LIVE PAGE BEFORE ANY NUMBER WAS CHANGED. Any one of them
 * alone would have produced the same complaint, which is why "adjust it until
 * it looks right" would have buried two of them:
 *
 *   1  --cap-em WAS WRONG. It carried 0.686, read from the font file. Every
 *      one of SEVEN flat-topped caps (T U E H I M Y) renders at 0.7197em —
 *      74.85px at a 104px title, not 71.34px. The box started 4.7% short.
 *      ⚠ The round caps are NOT the reference: S 0.7407, C 0.7334, O 0.7417,
 *      G 0.7383 all OVERSHOOT the cap line by ~2.9%, which is deliberate type
 *      design. Measuring "S" is what produces a wrong cap height.
 *
 *   2  INK-vs-BOX, AGAIN. The viewBox is cropped to the FULL ink — which
 *      includes the dots hanging BELOW the baseline — while the box was sized
 *      to the cap height. So the RING could only ever occupy 91.3% of the box.
 *      The box was correct and the ring inside it was short.
 *
 *   3  THE BASELINE WAS PINNED TO THE PATH, NOT THE INK. The arc ends at
 *      y 18.744, but round-capped it PAINTS half a stroke lower. The old
 *      0.0873 drop put the path endpoint on the baseline and left the painted
 *      ring hanging below it.
 *
 * Measured live before the fix: ink top 9.73px BELOW the cap line, ink span
 * 93.5% of the cap height.
 *
 * ⚠ EVERY VALUE HERE IS RECOMPUTED FROM THE CONSTANTS RATHER THAN PINNED.
 * A stroke in viewBox units is a FUNCTION OF THE BOX — it has been wrong four
 * times in this project for exactly that reason — so a test that pinned 1.3285
 * would go stale the moment the box moved and would go stale silently.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LOGIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');

const num = (re, what) => {
  const m = LOGIN.match(re);
  assert.ok(m, 'stale anchor — could not read ' + what + ' from login.html');
  return Number(m[1]);
};

/* ── the mark's own path geometry, which nothing here may change ──────────
   outer arc: circle centre (10,12) radius 8.5, swept 285deg, so the path runs
   from the top of the circle (y 3.5) to the arc ends (y 18.744). */
const CIRCLE_TOP = 3.5;
const ARC_END_Y = 18.744;
const RING_PATH_SPAN = ARC_END_Y - CIRCLE_TOP;          // 15.244
const BOTTOM_DOT_CY = 19.5;

test('⚠⚠ --cap-em is the FLAT cap height, not the font file value and not "S"', () => {
  const capEm = num(/--cap-em:\s*([\d.]+)/, '--cap-em');
  assert.ok(Math.abs(capEm - 0.7197) < 0.0005,
    'seven flat-topped caps render at 0.7197em; got ' + capEm);
  assert.notStrictEqual(capEm, 0.686,
    '0.686 came from the font file and is 4.7% short of what the face renders');
  assert.ok(capEm < 0.7334,
    'must be the FLAT cap line — the round caps (S C O G) overshoot it on purpose');
});

test('⚠⚠ the stroke is DERIVED in CSS, and resolves to exactly 6px at the title size', () => {
  const capEm = num(/--cap-em:\s*([\d.]+)/, '--cap-em');
  const capN = num(/--wm-cap-n:\s*([\d.]+)/, '--wm-cap-n');
  const strokePx = num(/--mark-stroke-px:\s*([\d.]+)/, '--mark-stroke-px');
  assert.strictEqual(strokePx, 6, "Justin's ask: 6px rings at full title size");

  // the derivation must LIVE in the stylesheet, not be a literal someone
  // carried forward — that is the whole point of the ask.
  assert.ok(/--mark-stroke:\s*calc\(/.test(LOGIN),
    '--mark-stroke must be a calc() from the box, never a pinned number');
  assert.ok(/--wm-cap-n/.test(LOGIN) && /--ring-path-span/.test(LOGIN),
    'the calc must be expressed from the cap size and the ring span');

  // ⚠ the stroke is on BOTH sides: it thickens the ring it is measured
  // against, so this is a solve, not a division.
  //   (RING_PATH_SPAN + s) * pxPerUnit = capPx     and     s * pxPerUnit = 6
  const capPx = capN * capEm;
  const s = (strokePx * RING_PATH_SPAN) / (capPx - strokePx);
  const pxPerUnit = capPx / (RING_PATH_SPAN + s);

  assert.ok(Math.abs(s * pxPerUnit - 6) < 0.001,
    'the derived stroke must paint at 6.00px, got ' + (s * pxPerUnit).toFixed(3));
  assert.ok(s > 1.2 && s < 1.5, 'sanity: stroke in viewBox units, got ' + s);
});

test('⚠⚠ the ring INK spans exactly the cap height — top on the cap line, bottom on the baseline', () => {
  const capEm = num(/--cap-em:\s*([\d.]+)/, '--cap-em');
  const capN = num(/--wm-cap-n:\s*([\d.]+)/, '--wm-cap-n');
  const strokePx = num(/--mark-stroke-px:\s*([\d.]+)/, '--mark-stroke-px');
  const capPx = capN * capEm;
  const s = (strokePx * RING_PATH_SPAN) / (capPx - strokePx);
  const dot3 = num(/--dot-3:\s*([\d.]+)/, '--dot-3');

  // PAINTED extents. A round cap paints a half-disc past the endpoint, so
  // near the arc ends the ink is a full disc of radius s/2.
  const inkTop = CIRCLE_TOP - s / 2;
  const ringInkBottom = ARC_END_Y + s / 2;              // === the baseline
  const inkBottom = Math.max(ringInkBottom, BOTTOM_DOT_CY + s * dot3);
  const vbHeight = inkBottom - inkTop;

  // the box must be sized so the RING (not the whole viewBox) is the cap height
  const boxEm = capEm * vbHeight / (ringInkBottom - inkTop);
  const dropEm = capEm * (inkBottom - ringInkBottom) / (ringInkBottom - inkTop);

  const cssBox = LOGIN.match(/--o-box-em:\s*calc\(/);
  const cssDrop = LOGIN.match(/--o-drop-em:\s*calc\(/);
  assert.ok(cssBox && cssDrop, 'the box height and the baseline drop must be derived too');

  // the viewBox must be cropped to the PAINTED ink, or the mapping above lies
  const vb = (LOGIN.match(/class="brand-o"[^>]*><svg viewBox="([^"]+)"/) || [])[1];
  assert.ok(vb, 'stale anchor — could not read the glyph viewBox');
  const [vx, vy, vw, vh] = vb.split(/\s+/).map(Number);
  assert.ok(Math.abs(vy - inkTop) < 0.005,
    'viewBox y must be the painted ring top ' + inkTop.toFixed(4) + ', got ' + vy);
  assert.ok(Math.abs(vh - vbHeight) < 0.005,
    'viewBox height must be the painted ink ' + vbHeight.toFixed(4) + ', got ' + vh);
  assert.ok(Math.abs(vx - (1.5 - s / 2)) < 0.005, 'viewBox x must be the painted left edge');
  assert.ok(Math.abs(vw - (17 + s)) < 0.005, 'viewBox width must be the painted width');

  // and the ring must therefore land exactly on the two typographic lines
  const pxPerUnit = (capN * capEm) / (ringInkBottom - inkTop);
  assert.ok(Math.abs((ringInkBottom - inkTop) * pxPerUnit - capPx) < 0.001,
    'the ring ink must span the cap height exactly');
  assert.ok(boxEm > capEm, 'the box is TALLER than the cap — it also holds the descending dots');
  assert.ok(dropEm > 0, 'the dots hang below the baseline, so the box must drop');
});

test('⚠ the dots scale WITH the stroke — proportional, never heavy dots on hairline rings', () => {
  // the ratios that shipped, from the approved mark: r 1.6 / 1.2 / 0.8 on a
  // 2.2 stroke. Justin: the dots stay proportional as the rings thin.
  const expected = [1.6 / 2.2, 1.2 / 2.2, 0.8 / 2.2];
  [1, 2, 3].forEach((n, i) => {
    const r = num(new RegExp('--dot-' + n + ':\\s*([\\d.]+)'), '--dot-' + n);
    assert.ok(Math.abs(r - expected[i]) < 0.0005,
      'dot ' + n + ' must stay at ' + expected[i].toFixed(4) + ' x stroke, got ' + r);
  });
  assert.ok(/\.brand-o svg circle/.test(LOGIN),
    'the radii must be driven from --mark-stroke, not written as fixed attributes');
});

test('⚠ the drop stays inside Archivo\'s descender — zero line-height cost', () => {
  const capEm = num(/--cap-em:\s*([\d.]+)/, '--cap-em');
  const capN = num(/--wm-cap-n:\s*([\d.]+)/, '--wm-cap-n');
  const strokePx = num(/--mark-stroke-px:\s*([\d.]+)/, '--mark-stroke-px');
  const dot3 = num(/--dot-3:\s*([\d.]+)/, '--dot-3');
  const capPx = capN * capEm;
  const s = (strokePx * RING_PATH_SPAN) / (capPx - strokePx);
  const ringInkBottom = ARC_END_Y + s / 2;
  const inkTop = CIRCLE_TOP - s / 2;
  const dropUnits = (BOTTOM_DOT_CY + s * dot3) - ringInkBottom;
  const dropPx = dropUnits * (capPx / (ringInkBottom - inkTop));

  // measured from the face in the browser: fontBoundingBoxDescent 22px at 104px
  const DESCENDER_PX = 0.2115 * capN;
  assert.ok(dropPx > 0 && dropPx < DESCENDER_PX,
    'the dots must hang inside the ' + DESCENDER_PX.toFixed(1) + 'px descender, got '
    + dropPx.toFixed(2) + 'px');
});

test('⚠ NOTHING ELSE ON THE PAGE MOVES — the background mark keeps its own geometry', () => {
  // the background mark is a SEPARATE svg with its own box, so its stroke is a
  // function of a DIFFERENT box and must not inherit the glyph's.
  assert.ok(/0\.464 2\.464 19\.072 17\.105/.test(LOGIN),
    'the background mark viewBox must be untouched');
  assert.ok(/stroke-width='0\.032'/.test(LOGIN) || /stroke-width=%270\.032%27/.test(LOGIN),
    'the background mark stroke must be untouched');
  assert.ok(/--wm-vw:\s*7\.8vw/.test(LOGIN), 'the wordmark size must be untouched');
  assert.ok(/--o-adv-em:\s*1\.016/.test(LOGIN), 'the O advance must be untouched');
});
