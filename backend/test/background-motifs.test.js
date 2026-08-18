/**
 * (f) — the transparent background motifs.
 *
 * ⚠⚠ THE DEFECT THIS EXISTS FOR RENDERED NOTHING AT ANY OPACITY, INCLUDING 1.
 * The layer is `body::before { z-index: -1 }`, and a negative-z-index child
 * paints BEHIND its own parent's background. The stylesheet said
 * `html, body { background: var(--bg) }`, so BODY painted an opaque box over
 * the motifs. It looks completely correct in the CSS, throws nothing, and the
 * only symptom is that the graphics are absent — which reads as "too subtle"
 * rather than "broken". I spent a screenshot round adjusting opacity before
 * checking whether the layer painted at all.
 *
 * The background therefore lives on <html> ONLY (it propagates to the viewport
 * canvas, so the page looks identical). Putting it back on body re-hides the
 * motifs silently, which is exactly what these tests refuse to allow.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

// ⚠ fromIndex + a length assertion. Without both, the slice can run backwards
// and every check below passes against an empty string.
function rule(selector) {
  const at = LIVE.indexOf(selector + ' {');
  assert.ok(at !== -1, 'rule not found: ' + selector);
  const end = LIVE.indexOf('}', at);
  assert.ok(end > at, 'rule must close: ' + selector);
  const s = LIVE.slice(at, end);
  assert.ok(s.length > 10 && s.length < 4000, 'slice must cover the rule: ' + s.length);
  return s;
}

test('⚠ BODY MUST NOT PAINT A BACKGROUND — it would hide the motif layer', () => {
  const shared = rule('html, body');
  assert.ok(!/background\s*:/.test(shared),
    'the `html, body` rule must not set a background. A background on BODY paints '
    + 'over the z-index:-1 motif layer and the graphics vanish with no error.');
  assert.ok(/html\s*{\s*background:\s*var\(--bg\)/.test(LIVE),
    'the page background must live on <html>, which propagates to the canvas');
});

test('the layer is decorative and unreachable — never in front of content', () => {
  const r = rule('body[data-view]::before');
  assert.ok(/position:\s*fixed/.test(r), 'must be a fixed backdrop, not in the flow');
  assert.ok(/z-index:\s*-1\b/.test(r),
    'z-index MUST be negative — a fixed layer at 0 paints ABOVE static in-flow text');
  assert.ok(/pointer-events:\s*none/.test(r), 'decoration must never intercept a click');
  const op = r.match(/opacity:\s*([0-9.]+)/);
  assert.ok(op, 'the layer must declare an opacity');
  // ⚠ THE CAP WAS RE-DERIVED 2026-08-18, because the old one had become the
  // BLOCKER rather than the safeguard. 0.06 was set when the treatment was small
  // repeated motifs; a single large cropped shape at that value measured a green
  // delta of just +12/255 — invisible on a monitor, which is why Justin saw
  // nothing. The cap now comes from the APPROVED MOCKS' own upper bound: they
  // drew strokes at 16-30%, so 0.30 is the brightest anything signed off ever
  // was. Shipping at 0.20 (+42/255), mid-band.
  //
  // ⚠ STILL NOT THE SAFETY MECHANISM. Where ink lands on text, move the CROP or
  // POSITION — never turn the opacity down. The cap only stops decoration
  // creeping past what was approved.
  assert.ok(parseFloat(op[1]) <= 0.30,
    'decoration must not exceed the brightest value ever approved. Found ' + op[1]);
  assert.ok(parseFloat(op[1]) >= 0.16,
    'below the approved band the shape is invisible on a monitor — the bug this '
    + 'replaced. Found ' + op[1]);
});

test('the four styles are inline SVG — no asset, no request, no dependency', () => {
  // ⚠ ANCHOR ON SOMETHING UNIQUE. There are TWO `:root {` blocks — the colour
  // tokens and this one — and slicing on the first gave a block with no motifs
  // in it, so the test failed for a reason unrelated to the code. Anchor on the
  // declaration that only exists here.
  const at = LIVE.indexOf('--motif-a:');
  assert.ok(at !== -1, '--motif-a must be declared');
  const root = LIVE.slice(LIVE.lastIndexOf(':root {', at), LIVE.indexOf('}', at));
  assert.ok(root.length > 200 && root.length < 20000, 'slice must cover the styles: ' + root.length);
  const urls = root.match(/url\("data:image\/svg\+xml,/g) || [];
  assert.strictEqual(urls.length, 4, 'expected FOUR styles as inline data URIs');
  ['--motif-a', '--motif-b', '--motif-c', '--motif-d'].forEach(function (v) {
    assert.ok(root.indexOf(v) !== -1, 'missing style ' + v);
  });
  assert.ok(!/url\(["']?(https?:)?\/\//.test(root), 'no remote asset may be referenced');
  assert.ok(!/url\(["']?(https?:)?\/\//.test(LIVE.slice(LIVE.indexOf('body[data-view]::before'),
    LIVE.indexOf('@media (max-width: 1320px)'))), 'nor by any per-view rule');
});

test('⚠⚠ EVERY STYLE IS VALID SVG — the four shipped MALFORMED once and rendered NOTHING', () => {
  // The generator collapsed "\n\s*" to nothing, joining an attribute to the one
  // before it — fill='none'stroke='#4ade80'. All four were invalid, the browser
  // refused to decode them, and the page looked exactly like a treatment that
  // was simply too faint. Caught by LOOKING AT THE RENDERED PAGE, not the CSS.
  ['a', 'b', 'c', 'd'].forEach(function (k) {
    const m = LIVE.match(new RegExp('--motif-' + k + ': url\\("data:image/svg\\+xml,([^"]+)"\\)'));
    assert.ok(m, '--motif-' + k + ' must be declared');
    const svg = decodeURIComponent(m[1]);
    // An attribute must never begin immediately after a closing quote.
    const joins = svg.match(/['"][a-zA-Z-]+=/g) || [];
    assert.deepStrictEqual(joins, [],
      'motif-' + k + ' has attributes joined without a space — the SVG will not decode');
    assert.ok(svg.trim().startsWith('<svg'), 'motif-' + k + ' must start with <svg');
    assert.ok(svg.trim().endsWith('</svg>'), 'motif-' + k + ' must close its root element');
    assert.ok(svg.indexOf('#4ade80') !== -1, 'motif-' + k + ' must be Scout green');
  });
});

test('⚠ NON-VACUITY — the validity check catches a joined attribute', () => {
  const m = LIVE.match(/--motif-a: url\("data:image\/svg\+xml,([^"]+)"\)/);
  const broken = decodeURIComponent(m[1]).replace("' stroke='#4ade80'", "'stroke='#4ade80'");
  const joins = broken.match(/['"][a-zA-Z-]+=/g) || [];
  assert.ok(joins.length > 0,
    'the matcher must see a joined attribute, or this check proves nothing');
});

test('ONE layer, per-view ASSIGNMENT, and render() is what gates it', () => {
  // The ATTRIBUTE is still required: render() stamps it, so the layer cannot
  // paint over a page that has not rendered yet.
  assert.ok(/body\[data-view\]::before\s*{/.test(LIVE),
    'the shared layer must key on the data-view attribute render() stamps');
  // ⚠ Per-view rules now EXIST on purpose — a different style in a different
  // place on every page — but they may only set the image and its position.
  // Anything else re-declared per view is a second definition waiting to drift.
  const perView = [...LIVE.matchAll(/body\[data-view="[a-z-]+"\]::before\s*{([^}]*)}/g)];
  assert.ok(perView.length >= 12, 'expected the per-view assignment, found ' + perView.length);
  perView.forEach(function (m) {
    const props = m[1].split(';').map((x) => x.split(':')[0].trim()).filter(Boolean);
    props.forEach(function (prop) {
      assert.ok(prop === 'background-image' || prop === 'background-position',
        'a per-view rule may only assign the style and its position, got: ' + prop);
    });
  });
  // No view may declare its own image inline — they all reference a :root style.
  assert.strictEqual((LIVE.match(/body\[data-view="[a-z-]+"\]::before\s*{[^}]*data:image/g) || []).length, 0,
    'per-view rules must reference var(--motif-*), not re-embed an SVG');
  // render() is the single dispatch point for every view, so the attribute
  // cannot fall out of step with what is on screen.
  const at = LIVE.indexOf('function render()');
  assert.ok(at !== -1, 'render() must exist');
  const body = LIVE.slice(at, LIVE.indexOf('updateNavActiveStates();', at));
  assert.ok(body.length > 100 && body.length < 3000, 'slice must cover render(): ' + body.length);
  assert.ok(/document\.body\.dataset\.view\s*=\s*state\.view/.test(body),
    'render() must stamp the view onto <body> — otherwise the scope never matches');
});

test('⚠ NON-VACUITY — the body-background guard fires when the background returns', () => {
  const broken = LIVE.replace('html, body {', 'html, body {\n      background: var(--bg);');
  const at = broken.indexOf('html, body {');
  const shared = broken.slice(at, broken.indexOf('}', at));
  assert.ok(/background\s*:/.test(shared),
    'the matcher must detect a background on the shared rule, or this suite proves nothing');
});
