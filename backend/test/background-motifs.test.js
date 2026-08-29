/**
 * ⚠⚠ RETIREMENTS, 2026-08-20 — SIX TESTS RETIRED WHEN THE RASTER REPLACED THE
 * MESH AS THE BASE LAYER. Each is commented in place below rather than deleted.
 * What each protected, and what protects it now:
 *
 *  1. "decorative and unreachable" — computed text contrast OVER a motif stroke
 *     and capped opacity so it cleared AA (accent ~0.390, body ~0.538).
 *     ⚠⚠ IT RETIRED BECAUSE ITS PREMISE IS FALSE, NOT BECAUSE THE RULE RELAXED.
 *     It assumed text sits ON the layer. Measured across all 15 views on the
 *     live page, ZERO text leaves have the layer as their backdrop — every one
 *     resolves to an opaque painted ancestor. At opacity 1 it computed 1.52:1
 *     for a composite that never renders.
 *     NOW PROTECTED BY: the carding pins in team-background.test.js
 *     (.page-header, .review-page-header, .synth-panel, objStatCard). Readability
 *     is bought by opaque containers, not by an alpha.
 *     ⚠ AND THE HONEST GAP: nothing re-runs the exposure sweep automatically. A
 *     NEW view whose text is not inside an opaque container would sit on a
 *     full-brightness photograph and no test here would catch it. The four pins
 *     cover today's containers only. This is the one property that got weaker.
 *
 *  2. "ONE artwork, ONE layer" and 4. "every view has its OWN window" — asserted
 *     fifteen distinct per-view windows existed. Justin ruled one image, one
 *     position; the fifteen rules are deleted. NOW PROTECTED BY the inverse
 *     assertion in team-background.test.js: ZERO per-view rules, proven
 *     non-vacuous by injecting one.
 *
 *  3. "the bright mesh is OPT-IN ONLY" — pinned the --motif-alpha fallback at
 *     0.25. The variable is gone (a var with a fallback made the rendered value
 *     unreadable from source: source said 0.25, render said 0.40). NOW PROTECTED
 *     BY a direct `opacity: 1` assertion with a cardinality check.
 *
 *  5. "the field renders LARGER than the viewport" and 6. "offsets stay within
 *     0-100%" — the 200%-plus-offset arithmetic that bought coverage for the
 *     mesh. Under `cover` with no offset, coverage is guaranteed by definition.
 *     NOW PROTECTED BY motif-coverage.test.js, which pins cover + 50% 50% and
 *     fails on any px offset. ⚠ NOT protected: the offset BUDGET, because there
 *     is no offset. Reintroducing per-view positions under `cover` alone is the
 *     original bare-area bug and needs that arithmetic back with it.
 *
 * ⚠⚠ SUPERSEDED THE SAME DAY — `--motif-mesh` IS NOW REMOVED. This note used to
 * read "the mesh itself is not retired; the tests below still guard that it is
 * inline, valid SVG, and has real depth." That was true for a few hours and is
 * now false, so it is corrected rather than left to mislead.
 *
 * FOUR MORE TESTS RETIRED (inline / valid SVG / depth / one-field-powers-them-all):
 * each asserted a property OF THE DECLARATION, and the declaration is gone —
 * 62,858 bytes, 8.9% of the served page, with zero readers.
 * ⚠ ZERO READERS WAS PROVEN BY CAPABILITY, NOT BY NAME: no `var(--motif-mesh)`
 * anywhere; the single generic CSSOM reader `cssToken(name)` has exactly one
 * call site, passing '--accent'; `setProperty` sites are --mark-* / --wel-*
 * only; and custom properties are document-scoped so nothing outside this file
 * could read it even in principle.
 * ⚠ NOTHING PROTECTS THOSE PROPERTIES NOW, AND NOTHING NEEDS TO — they were
 * properties of an artwork that is no longer painted. If the mesh is ever
 * revived, revive these four with it; scripts/gen-mesh.js still contains the
 * generator and its own AA refusal.
 *
 * ⚠ scripts/gen-mesh.js IS KEPT BUT DEAD. Its only output was that one
 * declaration written into dashboard.html; nothing imports or runs it. It is
 * retained as a tool rather than a rule — a script cannot be hit by the
 * last-wins trap that made archiving a CSS selector dangerous — but reviving
 * the mesh needs the generator RUN *and* a reader added. The generator alone
 * paints nothing.
 *
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

/* ⚠⚠ RETIRED 2026-08-20 — see the RETIREMENTS note in the header.
   Kept as a record of what was protected, not deleted:

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
     separately as opt-in-only below. * /
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
   * /
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
   * /
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
*/










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

/* ⚠⚠ RETIRED 2026-08-20 — the --motif-mesh VARIABLE ITSELF IS GONE, so this
   asserts a property of a declaration that no longer exists. Kept, not deleted:

test('⚠ the mesh is INLINE — no asset, no request, no dependency', () => {
  const m = HTML.match(/--motif-mesh:\s*url\("([^"]+)"\)/);
  assert.ok(m, 'the mesh must be a single custom property');
  assert.ok(/^data:image\/svg\+xml/.test(m[1]), 'inline data URI, never a fetched asset');
  /* ⚠ the SVG xmlns is a NAMESPACE URI, not a fetch — a naive https?:// test
     flags it and the check would then be about the wrong thing entirely. What
     must be absent is a resource REFERENCE: href, src, or url(). * /
  const body = m[1].replace(/xmlns='[^']*'/g, '').replace(/xmlns="[^"]*"/g, '');
  assert.ok(!/(href|src)\s*=|url\(/i.test(body),
    'no external reference — the mesh must fetch nothing at render time');
});
*/


/* ⚠⚠ RETIRED 2026-08-20 — the --motif-mesh VARIABLE ITSELF IS GONE, so this
   asserts a property of a declaration that no longer exists. Kept, not deleted:

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
*/


/* ⚠⚠ RETIRED 2026-08-20 — the --motif-mesh VARIABLE ITSELF IS GONE, so this
   asserts a property of a declaration that no longer exists. Kept, not deleted:

test('⚠ depth is real — nodes and edges vary in size and opacity', () => {
  const m = HTML.match(/--motif-mesh:\s*url\("([^"]+)"\)/);
  const svg = decodeURIComponent(m[1].replace(/^data:image\/svg\+xml;utf8,/, ''));
  const radii = [...new Set((svg.match(/circle[^>]*r='([\d.]+)'/g) || []))];
  const opac  = [...new Set((svg.match(/opacity='([\d.]+)'/g) || []))];
  assert.ok(radii.length > 5, 'nodes must vary in size — depth falling away');
  assert.ok(opac.length > 20, 'and in opacity, or it reads flat: ' + opac.length);
});
*/


/* ⚠⚠ RETIRED 2026-08-20 — see the RETIREMENTS note in the header.
   Kept as a record of what was protected, not deleted:

test('⚠⚠ ONE artwork, ONE layer — per-page variation is retired', () => {
  const live = LIVE_CSS;
  assert.ok(!/--motif-[abcd]\s*:/.test(live), 'the four styles must be gone');
  assert.strictEqual((live.match(/background-image: var\(--motif-mesh\)/g) || []).length, 1,
    'exactly one layer draws the mesh');
  assert.ok(!/body\[data-view="[a-z-]+"\]::before \{ background-image/.test(live),
    'per-view artwork assignment is retired — one full-bleed mesh covers everything');
});
*/


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
test('⚠⚠ exactly ONE live body[data-view]::before rule that PAINTS', () => {
  /* ⚠ TIGHTENED 2026-08-29, not loosened. It used to count SELECTORS outside
     media queries, which flagged the per-user background-off override
     (`html[data-bg="off"] body[data-view]::before { display: none; }`) — a
     scoped rule that turns the layer OFF, exactly like the media-query copies
     this always excluded.

     Counting selectors was the wrong proxy for the property. The thing that
     must be unique is the rule that PAINTS: two of those silently supersede
     each other, and every search finds the dead one first. So the check now
     counts rules CONTAINING background-image, and separately requires every
     other copy to be display:none only — which is stricter, because a second
     painting rule inside a media query would now also be caught. */
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /(^|[};\s])([^{}]*body\[data-view\]::before)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(live)) !== null) rules.push({ sel: m[2].trim(), body: m[3] });
  assert.ok(rules.length > 0, 'no rule found — the anchor is stale, not the code');

  const painting = rules.filter(r => /background-image\s*:/.test(r.body));
  assert.strictEqual(painting.length, 1,
    'found ' + painting.length + ' PAINTING rules. A second definition SILENTLY '
    + 'SUPERSEDES the first, and every search finds the dead one first — position vs precedence.');

  rules.filter(r => !/background-image\s*:/.test(r.body)).forEach(r => {
    assert.ok(/display\s*:\s*none/.test(r.body),
      'a non-painting copy must only switch the layer off, got: ' + r.sel + ' {' + r.body.trim() + '}');
  });
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
/* ⚠⚠ RETIRED 2026-08-20 — see the RETIREMENTS note in the header.
   Kept as a record of what was protected, not deleted:

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
     line that also carries its guard. * /
  const setLines = live.split('\n').filter((l) => /setAttribute\('data-mesh'/.test(l));
  assert.ok(setLines.length >= 1, 'the trial must set the attribute somewhere');
  setLines.forEach((l) => assert.ok(/if \(/.test(l),
    'data-mesh must never be set unconditionally: ' + l.trim()));

  // and the default is still the measured value, not the trial one
  const layer = live.slice(live.indexOf('body[data-view]::before {'));
  assert.ok(/--motif-alpha,\s*0\.25\)/.test(layer),
    'the fallback — what everyone without the parameter sees — stays 0.25');
});
*/


/**
 * ⚠⚠ PER-VIEW VARIATION IS BACK (Josh, 2026-08-20) — and it is only safe because
 * every variant is MEASURED, not because one sample was generalised to fifteen.
 * That generalisation is the inventory failure this project has made four times,
 * and it is exactly why per-page variation was retired in the first place.
 *
 * The shape that makes it affordable: ONE field, fifteen WINDOWS. Fifteen
 * separate artworks measured 162KB gzipped — 1.8x the whole page. One
 * 3200x2000 field with a per-view background-position is 48.5KB for all of them.
 */
/* ⚠⚠ RETIRED 2026-08-20 — see the RETIREMENTS note in the header.
   Kept as a record of what was protected, not deleted:

test('⚠⚠ every motif view has its OWN window — none shares another\'s', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  /* ⚠ PERCENTAGES, NOT PIXELS (2026-08-20). A px offset that covers at one
     viewport width leaves a bare band at another, because the rendered size
     follows the viewport — that is what left the account view 95% empty. * /
  const rules = [...live.matchAll(/body\[data-view="([a-z-]+)"\]::before \{ background-position: (\d+)% (\d+)%; \}/g)];
  /* ⚠ 14, NOT 15, SINCE 2026-08-20 — and this is a CORRECTION, not a
       weakening. The `team` view no longer uses the mesh at all: it carries a
       raster background (see the team rule in dashboard.html), so it has no
       mesh window to own. Every REMAINING motif view must still have its own.
       If a future view is added to the mesh, raise this number with it. * /
    assert.ok(rules.length >= 14, 'expected a window per mesh-backed view, got ' + rules.length);
    assert.ok(!/body\[data-view="team"\]::before \{ background-position: \d+% \d+%; \}/.test(live),
      'team must NOT have a single-line mesh window — it is raster-backed now');
  const seen = {};
  rules.forEach((m) => {
    const key = m[2] + ',' + m[3];
    assert.ok(!seen[key] || seen[key] === m[1],
      'views ' + seen[key] + ' and ' + m[1] + ' share window ' + key
      + ' — they would render identically, which is the thing Josh asked to change');
    seen[key] = m[1];
  });
});
*/


/* ⚠⚠ RETIRED 2026-08-20 — the --motif-mesh VARIABLE ITSELF IS GONE, so this
   asserts a property of a declaration that no longer exists. Kept, not deleted:

test('⚠ ONE field powers them all — fifteen artworks was 1.8x the page', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = (live.match(/--motif-mesh:\s*url\(/g) || []).length;
  assert.strictEqual(decls, 1,
    'exactly one field: ' + decls + ' artworks would multiply the payload and, '
    + 'worse, each would need its own sweep');
});
*/


/**
 * ⚠ THE GENERATOR REFUSES TO WRITE A FAILING VARIANT — that refusal is the
 * safety mechanism, not the measurement itself. A script that measures and then
 * writes anyway is a script that reports rather than protects.
 */
test('⚠⚠ the generator REFUSES to write when any variant fails AA', () => {
  const gen = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'gen-mesh.js'), 'utf8');
  assert.ok(/REFUSING to write/.test(gen), 'it must refuse, not warn');
  assert.ok(/failing\.length\s*\)\s*\{[\s\S]{0,160}process\.exit\(1\)/.test(gen),
    'and exit non-zero, so a build cannot proceed past it');
  assert.ok(/REFUSING — file shrank/.test(gen),
    'and it must refuse a truncating write — the shrink assertion');
});

/**
 * ⚠⚠ THE LAYER MUST NOT BE HIDDEN ON ORDINARY SCREENS.
 *
 * Justin reported the background "isn't showing on all screens". The cause was
 * `@media (max-width: 1320px) { display: none }` — so a 1280px laptop, a smaller
 * monitor, or a non-maximised window got NOTHING AT ALL.
 *
 * That rule was CORRECT for the treatment it was written for: one cropped shape
 * living in the gutters, where below 1320px the column ate the gutters and there
 * was genuinely nothing to see. A FULL-BLEED MESH IS NOT IN THE GUTTERS — it
 * covers the viewport — so the premise is gone.
 *
 * ⚠ A REDESIGN INCLUDES ITS GUARDS. The treatment changed and the constraint
 * written for the old one survived invisibly, exactly like the one-sided opacity
 * cap that once held the motif below visibility. This test is the tripwire.
 */
test('⚠⚠ the mesh is not display:none on ordinary laptop widths', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = live.match(/@media \(max-width: (\d+)px\) \{ body\[data-view\]::before \{ display: none/);
  assert.ok(m, 'stale anchor — the width media query moved');
  const px = Number(m[1]);
  assert.ok(px <= 1000,
    'the layer is hidden below ' + px + 'px. A full-bleed mesh covers the whole '
    + 'viewport, so there is plenty to see at 1280px — this threshold belongs to '
    + 'the retired cropped-shape treatment and hides the background on ordinary '
    + 'laptops.');
});

test('⚠ edges stay DOMINANT over nodes at any weight — that ratio fixed "green stars"', () => {
  const gen = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'gen-mesh.js'), 'utf8');
  const edgeOp = gen.match(/const o = \(([\d.]+) \+ near \* ([\d.]+)\)/);
  const nodeOp = gen.match(/opacity='\$\{\(([\d.]+) \+ p\.depth \* ([\d.]+)\)/);
  assert.ok(edgeOp && nodeOp, 'stale anchors — the weight expressions moved');
  const edgeMax = Number(edgeOp[1]) + Number(edgeOp[2]);
  const nodeMax = Number(nodeOp[1]) + Number(nodeOp[2]);
  assert.ok(edgeMax > nodeMax,
    'edges must out-weigh nodes (edge ' + edgeMax + ' vs node ' + nodeMax + ') — '
    + 'when nodes win it reads as scattered green stars, not a network');
});

/**
 * ⚠⚠ THE LAYER MUST COVER THE VIEWPORT AT EVERY WINDOW.
 *
 * `background-size: cover` scaled the 3200x2000 field to EXACTLY the viewport,
 * so the per-view offsets pushed it off-screen and no-repeat left the rest BARE
 * — the account view rendered ~95% empty with the mesh in one corner. That is
 * what "not covering the entire background" was; it was never the depth.
 *
 * ⚠ The sweep never caught it because the sweep samples FIELD coordinates —
 * what the artwork contains in a region — not what the browser PAINTS after
 * size + position + repeat. It measured the wrong space.
 */
/* ⚠⚠ RETIRED 2026-08-20 — see the RETIREMENTS note in the header.
   Kept as a record of what was protected, not deleted:

test('⚠⚠ the field renders LARGER than the viewport, so any window still covers', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = live.indexOf('body[data-view]::before {');
  const rule = live.slice(at, live.indexOf('\n    }', at));
  const size = rule.match(/background-size:\s*([^;]+);/);
  assert.ok(size, 'the layer must declare a background-size');
  assert.ok(!/cover/.test(size[1]),
    '`cover` renders the field at exactly the viewport, so ANY offset leaves a '
    + 'bare band with no-repeat. Got: ' + size[1]);
  const pct = size[1].match(/(\d+)%/);
  assert.ok(pct && Number(pct[1]) >= 200,
    'the field must render at >=200% of the element, or an offset cannot stay '
    + 'covered. Got: ' + size[1]);
});
*/


/* ⚠⚠ RETIRED 2026-08-20 — see the RETIREMENTS note in the header.
   Kept as a record of what was protected, not deleted:

test('⚠ window offsets stay within 0-100% — beyond that is off the image', () => {
  const live = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...live.matchAll(/body\[data-view="[a-z-]+"\]::before \{ background-position: (\d+)% (\d+)%; \}/g)];
  /* ⚠ 14, NOT 15, SINCE 2026-08-20 — and this is a CORRECTION, not a
       weakening. The `team` view no longer uses the mesh at all: it carries a
       raster background (see the team rule in dashboard.html), so it has no
       mesh window to own. Every REMAINING motif view must still have its own.
       If a future view is added to the mesh, raise this number with it. * /
    assert.ok(rules.length >= 14, 'expected a window per mesh-backed view, got ' + rules.length);
    assert.ok(!/body\[data-view="team"\]::before \{ background-position: \d+% \d+%; \}/.test(live),
      'team must NOT have a single-line mesh window — it is raster-backed now');
  rules.forEach((m) => {
    assert.ok(Number(m[1]) >= 0 && Number(m[1]) <= 100, 'x out of range: ' + m[1]);
    assert.ok(Number(m[2]) >= 0 && Number(m[2]) <= 100, 'y out of range: ' + m[2]);
  });
});
*/

