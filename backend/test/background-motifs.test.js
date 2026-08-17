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
  assert.ok(parseFloat(op[1]) <= 0.04,
    'ruling 2026-08-17: under ~4%. Found ' + op[1]);
});

test('it is inline SVG — no asset, no request, no dependency', () => {
  const r = rule('body[data-view]::before');
  const urls = r.match(/url\("data:image\/svg\+xml,/g) || [];
  assert.strictEqual(urls.length, 2, 'expected the two motifs as inline data URIs');
  assert.ok(!/url\(["']?(https?:)?\/\//.test(r), 'no remote asset may be referenced');
});

test('ONE layer for ALL views, and render() is what gates it', () => {
  // Rolled out 2026-08-17. The ATTRIBUTE is still required: render() stamps it,
  // so the layer cannot paint over a page that has not rendered yet.
  assert.ok(/body\[data-view\]::before/.test(LIVE),
    'the motif layer must key on the data-view attribute render() stamps');
  assert.ok(!/body\[data-view="[a-z-]+"\]::before/.test(LIVE),
    'no per-view motif variant — one layer, one definition');
  // Exactly ONE decorative SVG layer. A second would mean a view got its own
  // copy, which is how two definitions start drifting apart.
  const layers = LIVE.match(/[^\n{}]*::before\s*{[^}]*data:image\/svg\+xml/g) || [];
  assert.strictEqual(layers.length, 1, 'expected one motif layer, found: ' + layers.length);
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
