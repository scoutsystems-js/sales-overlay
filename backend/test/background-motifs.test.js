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

// ⚠ The brand green, read from the token rather than restated. Every assertion
// below follows --accent automatically, so a brand change updates the guard
// instead of breaking it.
const ACCENT = (function () {
  const m = HTML.match(/--accent:\s*(#[0-9a-fA-F]{6})/);
  if (!m) throw new Error('--accent token not found — the motif guard cannot derive the brand green');
  return m[1];
})();
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
  /* ⚠ THE OPACITY IS NOW A var() WITH A FALLBACK, because of the brightness
     TRIAL (?mesh=bright). This guard reads the FALLBACK — the shipped default —
     deliberately: the trial is a named exception, not a reason to stop checking.
     ⚠ A guard loosened for a trial never tightens again, so this one is SCOPED
     instead: the default must still clear AA, and the bright path is asserted
     separately as opt-in-only below. */
  const op = r.match(/opacity:\s*var\(--motif-alpha,\s*([0-9.]+)\)/)
          || r.match(/opacity:\s*([0-9.]+)/);
  assert.ok(op, 'the layer must declare an opacity (literal or var with a fallback)');
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
  /**
   * ⚠⚠ THE CEILING IS NOW COMPUTED, NOT PINNED (2026-08-18). It used to be 0.30
   * — "the brightest the approved mocks ever drew" — and that is a fact about a
   * mock, not about readability. Justin asked for brighter, and a pinned number
   * cannot answer whether brighter is SAFE.
   *
   * The real constraint is contrast on the worst-exposed text. ⚠ On THIS
   * surface that text is #ededed, because the no-grey rule made --muted
   * identical to --text — which is why the dashboard tolerates far more than
   * the login page (whose --muted is a genuine grey and caps at 0.215).
   */
  const opacity = parseFloat(op[1]);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = Math.max(lum(a), lum(b)), y = Math.min(lum(a), lum(b)); return (x + 0.05) / (y + 0.05); };
  /**
   * ⚠⚠ BOTH CEILINGS, BODY **AND** ACCENT (2026-08-20). The single-ceiling
   * version is EXACTLY what let 0.40 ship over the line.
   *
   * The old rule computed the ceiling against #ededed alone and got 0.538, so
   * 0.40 looked comfortably safe. But the dashboard also renders ACCENT-COLOURED
   * text (.sec-clip, .sec-you-label), and accent text over an accent-tinted
   * motif loses contrast fast BECAUSE THEY SHARE A HUE — the backdrop moves
   * toward the text instead of away from it. Measured: at 0.40 body text sits
   * at 6.62 and accent text at 4.34, under the AA floor. The true ceilings are
   * 0.538 (body) and 0.390 (accent).
   *
   * ⚠ THE WORST-EXPOSED TEXT IS NOT ALWAYS THE DIMMEST-LOOKING ONE. It is
   * whichever colour is closest to the decoration. Enumerate the text colours
   * that actually render, and take the LOWEST ceiling of them all.
   */
  const MARK = [9, 224, 70], BG = [10, 10, 10];
  const TEXT_COLOURS = {
    body:   [237, 237, 237],   // --text (== --muted here, per the no-grey rule)
    accent: [9, 224, 70],      // --accent: .sec-clip, .sec-you-label, links
  };
  const backdrop = MARK.map((c, i) => Math.round(opacity * c + (1 - opacity) * BG[i]));
  Object.keys(TEXT_COLOURS).forEach((name) => {
    const contrast = ratio(TEXT_COLOURS[name], backdrop);
    assert.ok(contrast >= 4.5,
      name + '-coloured text must clear 4.5:1 over a solid motif stroke — got '
      + contrast.toFixed(2) + ' at opacity ' + opacity + '. The binding ceiling '
      + 'is the LOWEST across every text colour that renders (accent ~0.390, '
      + 'body ~0.538), not the body one alone.');
  });
  assert.ok(parseFloat(op[1]) >= 0.16,
    'below the approved band the shape is invisible on a monitor — the bug this '
    + 'replaced. Found ' + op[1]);
});









test('⚠ NON-VACUITY — the body-background guard fires when the background returns', () => {
  const broken = LIVE.replace('html, body {', 'html, body {\n      background: var(--bg);');
  const at = broken.indexOf('html, body {');
  const shared = broken.slice(at, broken.indexOf('}', at));
  assert.ok(/background\s*:/.test(shared),
    'the matcher must detect a background on the shared rule, or this suite proves nothing');
});

/* ══ THE FULL-BLEED MESH (Josh, 2026-08-20) — replaces the four cropped shapes ══
   "Connecting data to infrastructures": nodes joined by fine lines, nearer nodes
   brighter and larger, depth falling away.

   ⚠ THE FOUR-STYLE TESTS ABOVE WERE CONVERTED, NOT DELETED. Every property they
   protected still matters and is re-asserted here — inline (no request), VALID
   (the four shipped malformed once and rendered nothing), and ONE layer. What
   changed is that there is now one artwork instead of four, and per-page
   variation is retired: each offset would change which text sits over which
   node, so every variant would need its own ink sweep. */

// live CSS only: the superseded 0.035 rule is archived in a comment block and
// a raw scan would read it as if it still governed (presence vs precedence).
const LIVE_CSS = HTML.replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠ the mesh is INLINE — no asset, no request, no dependency', () => {
  const m = HTML.match(/--motif-mesh:\s*url\("([^"]+)"\)/);
  assert.ok(m, 'the mesh must be a single custom property');
  assert.ok(/^data:image\/svg\+xml/.test(m[1]), 'inline data URI, never a fetched asset');
  /* ⚠ the SVG xmlns is a NAMESPACE URI, not a fetch — a naive https?:// test
     flags it and the check would then be about the wrong thing entirely. What
     must be absent is a resource REFERENCE: href, src, or url(). */
  const body = m[1].replace(/xmlns='[^']*'/g, '').replace(/xmlns="[^"]*"/g, '');
  assert.ok(!/(href|src)\s*=|url\(/i.test(body),
    'no external reference — the mesh must fetch nothing at render time');
});

test('⚠⚠ THE MESH IS VALID SVG — the old motifs shipped MALFORMED and drew nothing', () => {
  const m = HTML.match(/--motif-mesh:\s*url\("([^"]+)"\)/);
  const svg = decodeURIComponent(m[1].replace(/^data:image\/svg\+xml;utf8,/, ''));
  assert.ok(/^<svg[\s>]/.test(svg) && /<\/svg>$/.test(svg), 'must be a complete svg element');
  assert.ok(!/['"][a-zA-Z-]+=/.test(svg.replace(/" /g, '" ')),
    'joined attributes (fill="none"stroke=…) make the browser refuse the whole image');
  assert.ok(/<line /.test(svg) && /<circle /.test(svg), 'a NETWORK: edges and nodes, not one shape');
  assert.ok(svg.indexOf('%2309e046') !== -1 || svg.indexOf('#09e046') !== -1,
    'drawn in the brand green');
});

test('⚠ depth is real — nodes and edges vary in size and opacity', () => {
  const m = HTML.match(/--motif-mesh:\s*url\("([^"]+)"\)/);
  const svg = decodeURIComponent(m[1].replace(/^data:image\/svg\+xml;utf8,/, ''));
  const radii = [...new Set((svg.match(/circle[^>]*r='([\d.]+)'/g) || []))];
  const opac  = [...new Set((svg.match(/opacity='([\d.]+)'/g) || []))];
  assert.ok(radii.length > 5, 'nodes must vary in size — depth falling away');
  assert.ok(opac.length > 20, 'and in opacity, or it reads flat: ' + opac.length);
});

test('⚠⚠ ONE artwork, ONE layer — per-page variation is retired', () => {
  const live = LIVE_CSS;
  assert.ok(!/--motif-[abcd]\s*:/.test(live), 'the four styles must be gone');
  assert.strictEqual((live.match(/background-image: var\(--motif-mesh\)/g) || []).length, 1,
    'exactly one layer draws the mesh');
  assert.ok(!/body\[data-view="[a-z-]+"\]::before \{ background-image/.test(live),
    'per-view artwork assignment is retired — one full-bleed mesh covers everything');
});

/**
 * ⚠⚠ EXACTLY ONE LIVE MOTIF RULE — the check that would have caught the
 * two-rules mistake and did not exist.
 *
 * `body[data-view]::before` was defined TWICE: a dead 0.035 version and the
 * governing one below it. Every guard passed, because each read whichever rule
 * it found and both assertions were true of it. A guard that checks the VALUE
 * it finds cannot notice that a SECOND definition exists.
 *
 * This is the "exactly one" shape already used for background-position and
 * background-size after the 207px incident — the lesson had been learned for
 * DECLARATIONS and never extended to SELECTORS. One level up, same failure.
 */
test('⚠⚠ exactly ONE live body[data-view]::before rule (excluding media queries)', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  // media-query copies are display:none only and are not the painting rule
  const painting = live.replace(/@media[^{]*\{[^}]*\{[^}]*\}\s*\}/g, '');
  const n = (painting.match(/body\[data-view\]::before\s*\{/g) || []).length;
  assert.strictEqual(n, 1,
    'found ' + n + ' painting rules. A second definition SILENTLY SUPERSEDES the '
    + 'first, and every search finds the dead one first — position vs precedence.');
});

/**
 * ⚠⚠ THE BRIGHTNESS TRIAL IS OPT-IN ONLY, AND THAT IS WHAT MAKES IT SAFE.
 * At full strength the mesh fails AA for BOTH body and accent text — measured
 * 2.16 and 1.41 against a 4.5 floor — because it touches 97.1% of text boxes,
 * so the worst case is universal rather than occasional.
 *
 * The guard above still holds the DEFAULT to the AA ceiling. This one holds the
 * trial to being unreachable without an explicit query parameter, so a bright
 * mesh can never become the shipped state by accident.
 */
test('⚠⚠ the bright mesh is OPT-IN ONLY — never the default', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const bright = live.match(/html\[data-mesh="bright"\]\s*\{[^}]*\}/);
  assert.ok(bright, 'the trial variant must be attribute-scoped');
  assert.ok(/--motif-alpha:\s*1/.test(bright[0]), 'bright means full strength');

  // it can only be reached by an explicit parameter
  assert.ok(/mesh'\)/.test(live) && /=== 'bright'/.test(live),
    'the attribute must be set only from an explicit ?mesh=bright');
  /* ⚠ this check was wrong first: it stripped the `if (...)` and then asserted
     the call was not at end of line — which is true of a correctly guarded call
     too. Assert the PROPERTY instead: every setAttribute for data-mesh sits on a
     line that also carries its guard. */
  const setLines = live.split('\n').filter((l) => /setAttribute\('data-mesh'/.test(l));
  assert.ok(setLines.length >= 1, 'the trial must set the attribute somewhere');
  setLines.forEach((l) => assert.ok(/if \(/.test(l),
    'data-mesh must never be set unconditionally: ' + l.trim()));

  // and the default is still the measured value, not the trial one
  const layer = live.slice(live.indexOf('body[data-view]::before {'));
  assert.ok(/--motif-alpha,\s*0\.25\)/.test(layer),
    'the fallback — what everyone without the parameter sees — stays 0.25');
});
