'use strict';
/* ⚠ THE TARGET NOTCH CARRIES ITS OWN NUMBER (Justin, 2026-09-01).
   A white mark on a ring says "a bar exists here" and not WHAT the bar is, so a
   reader had to find it in the caption underneath and map it back.

   ⚠ CONFIRMED BEFORE LABELLING IT, because the instruction was not to label an
   assumption: the notch is built from avgAngle(target, scale) and the code says
   so. The label is drawn from the SAME `ta`, so the two cannot drift apart. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function gauge() {
  const a = H.indexOf('  var AVG_SWEEP_DEG');
  const b = H.indexOf('\n  function avgCardHtml');
  assert.ok(a !== -1 && b > a, 'stale anchors');
  const src = H.slice(a, b);                       // ⚠ raw source: comments are fine to run
  assert.ok(src.length > 2000 && src.length < 9000, 'slice must cover it: ' + src.length);
  return new Function(src + '; return avgGaugeSvg;')();
}

const CASES = [[24, 25, 50], [31, 35, 100], [41.7, 60, 90]];

test('every dial labels its target, with the target\'s own number', () => {
  for (const [v, t, sc] of CASES) {
    const svg = gauge()(v, t, sc, 'good');
    const m = svg.match(/<text class="[^"]*avg-notch-label"[^>]*>([^<]*)</);
    assert.ok(m, 'no target label on the ' + t + '/' + sc + ' dial');
    assert.strictEqual(m[1], String(t), 'the label must be the target, not something else');
  }
});

test('⚠ the label is drawn from the notch\'s OWN angle, never a second computation', () => {
  const a = H.indexOf('  function avgGaugeSvg');
  const fn = H.slice(a, H.indexOf('\n  }', H.indexOf('avg-notch-label', a)));
  assert.ok(fn.length > 400, 'slice: ' + fn.length);
  assert.ok(/var ta = avgAngle\(target, scale\)/.test(fn), 'ta is the notch angle');
  assert.ok(/avgPoint\(cx, cy, rOuter \+ \d+, ta\)/.test(fn),
    'the label must be positioned from ta — deriving the angle again is two computations of one thing');
});

test('⚠ the label clears the notch AND stays inside the viewBox', () => {
  for (const [v, t, sc] of CASES) {
    const svg = gauge()(v, t, sc, 'good');
    /* ⚠ ONE global matchAll. A first version concatenated a NON-global matchAll
       with a global one — matchAll requires /g — and the check failed on code the
       standalone probe had already measured as correct at 8px of clearance. The
       extraction was wrong, not the gauge. */
    const L = [...svg.matchAll(/<text class="([^"]*)" x="([\d.]+)" y="([\d.]+)">/g)]
      .find(x => x[1].indexOf('notch') !== -1);
    const N = svg.match(/class="avg-notch" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
    assert.ok(L && N, 'label and notch must both render');
    const gap = Math.hypot(+L[2] - +N[3], (+L[3] - 3) - +N[4]);
    assert.ok(gap >= 6, 'label sits on the notch (' + gap.toFixed(1) + 'px) — it must clear it');
    // ⚠ measured: at rOuter+19 the top-of-arc label CLIPS. The viewBox is 230x168.
    assert.ok(+L[2] > 5 && +L[2] < 225, 'label off the side of the viewBox');
    assert.ok((+L[3] - 7) > 0 && +L[3] < 163, 'label clipped by the viewBox top/bottom');
  }
});

test('⚠ the notch still CROSSES the ring band — .avg-seg is stroke-width 12 at rOuter', () => {
  /* A tip at rOuter + 3 would stop INSIDE the band (rOuter ± 6) and read as a
     mark that fails to cross. This is why the label moved out rather than the
     notch shrinking further. */
  const css = H.match(/\.avg-seg \{[^}]*stroke-width:\s*(\d+)/);
  assert.ok(css, 'stale anchor — .avg-seg stroke-width');
  const half = Number(css[1]) / 2;
  const fn = H.slice(H.indexOf('  function avgGaugeSvg'), H.indexOf('\n  function avgCardHtml'));
  const tip = fn.match(/var t0 = avgPoint\(cx, cy, rOuter - 10, ta\), t1 = avgPoint\(cx, cy, rOuter \+ (\d+), ta\)/);
  assert.ok(tip, 'stale anchor — the notch endpoints');
  assert.ok(Number(tip[1]) > half, 'the notch tip (+' + tip[1] + ') must clear the band edge (+' + half + ')');
});

test('⚠ the gauge number is a NAMED EXCEPTION, not an eighth scale size', () => {
  assert.ok(/--fs-gauge-value:\s*\d+px/.test(H), 'the exception token must exist and be named');
  assert.ok(/\.avg-value \{ font-size: var\(--fs-gauge-value\)/.test(H),
    'the gauge value must use it');
  // it must NOT have been added to the scale itself
  const scale = H.slice(H.indexOf('--fs-display'), H.indexOf('--fs-eyebrow') + 60);
  assert.ok(!/--fs-gauge-value/.test(scale.slice(0, scale.indexOf('--fs-eyebrow'))),
    'the exception must sit AFTER the scale, never inside it');
  // and the dial is back to its pre-2026-09-01 width
  assert.ok(/\.avg-svg \{ width: 100%; max-width: 290px;/.test(H), 'the dial is back to 290');
});
