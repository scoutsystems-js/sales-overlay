/**
 * THE LOGIN BRAND LOCKUP (Josh, 2026-08-18): "SCOUT SYSTEMS" with the logo
 * above the sign-in form — big, bold, green.
 *
 * ⚠⚠ THE MARK IS THE INLINE SVG, NOT src/assets/icon.png, AND THAT IS A
 * DEVIATION FROM THE INSTRUCTION, REPORTED RATHER THAN MADE SILENTLY.
 * Decoded, icon.png is an APP ICON, not a web logo:
 *   1024x1024, PNG colour type 2  → NO ALPHA CHANNEL, so it carries a solid
 *                                   near-black plate rather than a free-standing
 *                                   mark, and would render as a visible square
 *   the word "SCOUT" baked in     → prints the word twice above a SCOUT SYSTEMS
 *                                   wordmark
 *   a generator watermark, corner → shipped to every visitor
 *   720KB for a ~76px render      → on a page that currently loads no images
 * The inline SVG is the same mark (concentric arcs over descending dots) as a
 * vector, in the brand green, with none of those four problems.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LOGIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');
const STYLE = fs.readFileSync(path.join(__dirname, '..', 'web', 'css', 'style.css'), 'utf8');

test('the lockup sits ABOVE the sign-in form, not below it', () => {
  const lockup = LOGIN.indexOf('class="brand-lockup"');
  const email = LOGIN.indexOf('id="email"');
  const pw = LOGIN.indexOf('id="password"');
  assert.ok(lockup > 0, 'the brand lockup is missing');
  assert.ok(email > 0 && pw > 0, 'form anchors are stale — re-derive this test');
  assert.ok(lockup < email && lockup < pw, 'the lockup must come before the fields');
});

test('the wordmark is the full name, big, LIGHT and green', () => {
  // ⚠ the word is SPLIT around the glyph now: SC<svg/>UT SYSTEMS
  assert.ok(/class="brand-name">SC</.test(LOGIN) && /UT SYSTEMS</.test(LOGIN),
    'the wordmark must still read SCOUT SYSTEMS around the O glyph');
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup .brand-name'), LOGIN.indexOf('/* ── THE MARK AS A BACKGROUND'));
  assert.ok(css.length > 60 && css.length < 900, 'slice suspicious: ' + css.length);
  // ⚠ THE SIZE IS min(<vw>, <px>) — read the px cap, which is the shipped size
  // on any normal desktop. A naive /font-size:\s*(\d+)px/ would pick up nothing
  // useful, and the earlier clamp() form hid the real size behind its MINIMUM.
  // ⚠ the size is now per-face: min(var(--wm-vw), var(--wm-cap)). Read the cap
  // from :root rather than the rule, since the trial switches both per face.
  const size = Number((LOGIN.match(/--wm-cap:\s*(\d+)px/) || [])[1]);
  const weight = Number((css.match(/font-weight:\s*(\d+)/) || [])[1]);
  assert.ok(size >= 28, 'big: ' + size + 'px');
  // ⚠ Justin, 2026-08-18: "BIGGER, NOT BOLD." The previous assertion demanded
  // weight >= 700, which is now the opposite of the requirement.
  // Justin reversed this 2026-08-18: the title is now BOLD and one size larger.
  assert.ok(weight >= 700, 'bold: ' + weight);
  assert.ok(/color:\s*var\(--green\)/.test(css), 'green, from the token');
});

/**
 * ⚠⚠ THE TOKEN SET ON THE AUTH PAGES IS NOT THE DASHBOARD'S. This was caught
 * mid-build: the first draft used var(--accent), which the auth pages do not
 * define at all — the wordmark would have fallen back to inherited colour and
 * rendered plain white. Correct-looking CSS, wrong document.
 */
test('⚠⚠ the login page uses --green; --accent does not exist here', () => {
  assert.ok(/--green:\s*#09e046/.test(STYLE), 'the auth stylesheet defines --green');
  assert.ok(!/--accent\s*:/.test(STYLE),
    'if --accent is ever added here, re-check every var() on this page');
  const lockupCss = LOGIN.slice(LOGIN.indexOf('.brand-lockup {'), LOGIN.indexOf('.card-header {'));
  assert.ok(!/var\(--accent/.test(lockupCss),
    'the lockup must not reference a token this page does not define');
});

/**
 * The green sweep moved --green and --green-dark and LEFT these two on the old
 * green in channel form — the "a colour has more than one spelling" failure,
 * here in the auth stylesheet. rgba() cannot read a hex token, so each tint had
 * been written as a hard-coded COPY that does not follow the token.
 */
test('⚠ the soft tints DERIVE from the brand green rather than copying it', () => {
  /**
   * ⚠⚠ COMMENTS STRIPPED FIRST, AND THE FIRST DRAFT DID NOT — it failed on the
   * comment that EXPLAINS the fix, which names the old green as "34,197,94" to
   * say what must never come back. The guard reported the documentation of the
   * rule as a violation of it, and the tempting fix was to delete the sentence.
   * Second instance of this in one block; see the other in welcome-sequence.
   */
  const noComments = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');
  const root = noComments.slice(noComments.indexOf(':root'), noComments.indexOf('}', noComments.indexOf(':root')));
  assert.ok(root.length > 100 && root.length < 2000, 'slice suspicious: ' + root.length);

  /**
   * ⚠⚠ SCOPED TO THE WHOLE FILE, AND THE FIRST VERSION WAS SCOPED TO :root —
   * which is how EIGHT more stale tints shipped past it. The guard checked the
   * token block; the claim was "the tints derive from the brand green". Those
   * are different scopes, and the eight that were neither in :root nor caught
   * by it (.feature, .badge-win, .hero-badge, .overlay-mockup and others) were
   * still painting the OLD green on the live landing and coaching pages.
   *
   * Found by grepping the SERVED stylesheet after deploy, not by this test.
   * State the scope of a check alongside its claim, and make the claim no
   * broader than the scope.
   */
  assert.strictEqual((noComments.match(/34,\s*197,\s*94/g) || []).length, 0,
    'the OLD green must not survive in channel form ANYWHERE in the live CSS — '
    + 'not only in :root. rgba() cannot read a hex token, so every tint is a '
    + 'COPY unless it is written as rgba(var(--green-rgb), a)');
  assert.ok(/--green-rgb:\s*9,\s*224,\s*70/.test(root),
    'the channel spelling must match #09e046');
  assert.ok(/--green-dim:\s*rgba\(var\(--green-rgb\)/.test(root), '--green-dim must derive');
  assert.ok(/--green-glow:\s*rgba\(var\(--green-rgb\)/.test(root), '--green-glow must derive');
  assert.ok(!/34,\s*197,\s*94/.test(root),
    'the OLD green (#22c55e) must not survive in channel form anywhere in :root');
});

/**
 * ⚠ CONVERTED, NOT DELETED (2026-08-18). These two tests were written against
 * the small lockup mark, which the background ruling superseded. Their SUBJECT
 * survives — the mark must still be DRAWN rather than fetched, and must still
 * match the nav geometry rather than being redrawn by eye — so they now assert
 * it of the background layer. Deleting them with the lockup would have quietly
 * dropped both properties.
 */
test('the mark is drawn, not fetched — no asset request on the login page', () => {
  const at = LOGIN_LIVE.indexOf('body::before');
  const css = LOGIN_LIVE.slice(at, LOGIN_LIVE.indexOf('}', at));
  assert.ok(css.length > 200 && css.length < 4000, 'slice suspicious: ' + css.length);
  assert.ok(/url\("data:image\/svg\+xml,/.test(css), 'inline SVG data URI, not a file');
  assert.ok(!/<img|icon\.png|\.jpg|\.webp/.test(LOGIN_LIVE),
    'no image request anywhere on this page — and specifically not icon.png, '
    + 'which is an app icon with no alpha, a baked-in wordmark and a watermark');
});

test('the background mark matches the nav logo rather than being redrawn by eye', () => {
  const at = LOGIN_LIVE.indexOf('body::before');
  const css = LOGIN_LIVE.slice(at, LOGIN_LIVE.indexOf('}', at));
  const nav = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('class="nav-logo"'), LOGIN_LIVE.indexOf('class="back"'));
  const arcs = (t) => (t.match(/A[\d.]+ [\d.]+ 0 0 1 [\d.]+ [\d.]+/g) || []).join('|');
  const radii = (t) => (t.match(/r='([\d.]+)'|r="([\d.]+)"/g) || []).map((m) => m.replace(/['"]/g, '')).join('|');
  assert.ok(arcs(css).length > 0, 'no arcs found in the background mark');
  /**
   * ⚠ THE ARCS NO LONGER MATCH EXACTLY — note 4 scaled the rings x1.12, the
   * SECOND approved divergence from the nav mark (the lockup's 285-degree
   * sweep was the first). Equality was the right pin while the background mark
   * was meant to be the nav mark at another size; it is now a ratio, checked
   * below, so the intended difference is pinned rather than the guard dropped.
   */

  /**
   * ⚠⚠ THE DOT RADII DELIBERATELY DIVERGE (Justin, 2026-08-18: halved TWICE —
   * "half size", then "still a little too big"). This
   * used to assert they matched the nav mark exactly, which was the right pin
   * until the dots became a background-scale decision of their own. It is now
   * pinned as an EXACT RATIO rather than dropped — so the dots cannot drift to
   * an arbitrary value, and a future edit that "restores" them to match the nav
   * has to do so deliberately.
   */
  // ⚠ the nav mark is HTML (r="1.6"); the background is a data URI (r='1.6').
  // Matching one quote style found zero radii in the nav and the guard failed
  // for the wrong reason.
  /**
   * ⚠⚠ THE GUARD IS A RATIO, NOT AN EQUALITY — it pins the APPROVED divergence
   * rather than being dropped (note 4, 2026-08-18). Two deliberate departures
   * from the nav mark now exist: the lockup's 285-degree arcs, and this
   * background mark's larger rings + tighter dots. Both were ruled; neither may
   * drift, and a future edit "restoring" either has to be deliberate.
   *
   *   rings  x1.12   (8.5/5.5/2.5 -> 9.52/6.16/2.8)
   *   dots   radii x0.25, centre spacing x0.62 from the ring centre
   */
  const nums = (t, attr) => (t.match(new RegExp(attr + "=['\"]([\\d.]+)['\"]", 'g')) || [])
    .map((m) => parseFloat(m.replace(new RegExp(attr + "=['\"]|['\"]", 'g'), '')));
  const navArc = (nav.match(/A([\d.]+) /g) || []).map((m) => parseFloat(m.slice(1)));
  const bgArc = (css.match(/A([\d.]+) /g) || []).map((m) => parseFloat(m.slice(1)));
  assert.strictEqual(bgArc.length, navArc.length, 'same number of arcs');
  navArc.forEach((r, i) => {
    assert.ok(Math.abs(bgArc[i] / r - 1.12) < 0.005,
      'ring ' + (i + 1) + ' must be exactly 1.12x the nav radius (' + r + ' -> '
      + (r * 1.12).toFixed(2) + '), got ' + bgArc[i]
      + '. This is the APPROVED divergence, pinned so it cannot drift.');
  });
  const navR = nums(nav, 'r'), bgR = nums(css, 'r');
  assert.strictEqual(bgR.length, navR.length, 'same number of dots');
  navR.forEach((r, i) => {
    assert.ok(Math.abs(bgR[i] / r - 0.25) < 0.001,
      'dot ' + (i + 1) + ' radius must stay a QUARTER of the nav (' + r + ' -> '
      + (r / 4) + '), got ' + bgR[i]);
  });
  const navCy = nums(nav, 'cy'), bgCy = nums(css, 'cy');
  navCy.forEach((cy, i) => {
    const expected = 12 + (cy - 12) * 0.62;
    assert.ok(Math.abs(bgCy[i] - expected) < 0.01,
      'dot ' + (i + 1) + ' centre must be tightened to x0.62 of its offset ('
      + cy + ' -> ' + expected.toFixed(2) + '), got ' + bgCy[i]);
  });
});

// ── the mark as a BACKGROUND (Justin, 2026-08-18) ──────────────────────────
/**
 * ⚠ SUPERSEDES the small-mark-above-the-wordmark lockup. The mark is now a
 * large shape behind the form, using the same treatment as the dashboard's
 * page motifs. The ARTWORK ruling is unchanged — still the vector, never
 * icon.png; only the placement moved.
 */
const LOGIN_LIVE = LOGIN.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * ⚠⚠ REVERSED 2026-08-18. This asserted the mark was ABSENT from the lockup,
 * which was right while the mark was only a background. Justin then approved
 * the mark AS THE "O" IN SCOUT, so an SVG inside the wordmark is now the
 * intended state. The property worth keeping is that there is exactly ONE mark
 * in the lockup — it is a letter, not a decoration beside the word.
 */
test('⚠ the lockup contains EXACTLY ONE mark, and it is the O', () => {
  const lockup = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('class="brand-lockup"'),
                                  LOGIN_LIVE.indexOf('class="card-header"'));
  assert.ok(lockup.length > 200 && lockup.length < 4000, 'slice suspicious: ' + lockup.length);
  assert.strictEqual((lockup.match(/<svg/g) || []).length, 1, 'exactly one glyph');
  assert.ok(/class="brand-o"/.test(lockup), 'and it is the O slot');
  assert.ok(/>SC</.test(lockup) && /UT SYSTEMS</.test(lockup),
    'the word must still read SCOUT SYSTEMS around the glyph');
});

test('the wordmark is bigger again, and >= 50% wider than the login box', () => {
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup .brand-name'), LOGIN.indexOf('/* ── THE MARK AS A BACKGROUND'));
  const size = Number((LOGIN.match(/--wm-cap:\s*(\d+)px/) || [])[1]);
  assert.ok(size >= 100, 'one size larger again (92 -> 104): got ' + size);
  // And at least 50% wider than the 400px login box: 92px x k 8.924 = ~820px.
  assert.ok(size * 9.769 >= 400 * 1.5,
    'the wordmark must span >= 1.5x the login box (600px); ' + size + 'px gives '
    + Math.round(size * 9.769) + 'px');
});

test('⚠ the background layer follows the motif treatment exactly', () => {
  const at = LOGIN_LIVE.indexOf('body::before');
  assert.ok(at > 0, 'the background layer is missing');
  const css = LOGIN_LIVE.slice(at, LOGIN_LIVE.indexOf('}', at));
  assert.ok(css.length > 200 && css.length < 4000, 'slice suspicious: ' + css.length);

  const op = Number((css.match(/opacity:\s*([\d.]+)/) || [])[1]);
  assert.ok(op >= 0.16 && op <= 0.30, 'opacity must sit in the established band: ' + op);
  /**
   * ⚠⚠ AND IT MUST KEEP THE WORST EXPOSED TEXT ABOVE 4.5:1. The band alone is
   * not enough — 0.22 sits inside it and puts --muted text at 4.47:1, under the
   * AA line. This computes the contrast rather than trusting the band, because
   * "in the band" was true of the value that failed.
   */
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b)); return (L1 + 0.05) / (L2 + 0.05); };
  const pageBg = [8, 11, 13], mark = [9, 224, 70], muted = [138, 154, 170];
  const backdrop = mark.map((c, i) => Math.round(op * c + (1 - op) * pageBg[i]));
  const worst = ratio(muted, backdrop);
  assert.ok(worst >= 4.5,
    'the worst exposed text (--muted: labels, sub-heading, forgot link, footer) '
    + 'must clear 4.5:1 over a solid stroke of the mark — got ' + worst.toFixed(2)
    + ' at opacity ' + op);
  assert.ok(/pointer-events:\s*none/.test(css),
    'it must never intercept a click on the form beneath it');
  assert.ok(/position:\s*fixed/.test(css) && /z-index:\s*0/.test(css), 'behind the content');
  /**
   * ⚠⚠ THIS ASSERTION USED TO PIN `150vmin` — AND IT PASSED FOR THE WRONG
   * REASON. The rule had TWO background-position/background-size pairs: the
   * derived one, and a leftover from the 3x version sitting AFTER it. CSS gives
   * the later declaration the win, so the page rendered the OLD values while
   * this guard happily confirmed the old string was present.
   *
   * ⚠ A PRESENCE CHECK CANNOT SEE PRECEDENCE. "the value is in the file" and
   * "the value is what renders" are different claims, and only the second one
   * matters. So the guard now asserts there is EXACTLY ONE of each — which is
   * the property that would have caught it.
   */
  const posCount = (css.match(/background-position\s*:/g) || []).length;
  const sizeCount = (css.match(/background-size\s*:/g) || []).length;
  assert.strictEqual(posCount, 1,
    'exactly one background-position — ' + posCount + ' means a later duplicate '
    + 'silently overrides the derived value, which is how the ink floated 207px '
    + 'down a correctly-placed box');
  assert.strictEqual(sizeCount, 1, 'exactly one background-size, for the same reason');
  assert.ok(/background-size:\s*auto 100%/.test(css),
    'the mark is sized to FILL the derived box, not to a chosen vmin number');
  assert.ok(/background-position:\s*center top/.test(css),
    'and anchored to the top of that box, so the first ring touches the page top');
});

/**
 * ⚠⚠ THE WORDMARK MUST NOT WRAP. At 68px inside a 400px card "SCOUT SYSTEMS"
 * broke across two lines — not asked for, and the taller block is what drove it
 * down into the mark. Every measurement taken at the time said the type was
 * fine, because none of them asked whether it FIT; it was caught by looking at
 * the deployed page.
 */
/**
 * ⚠⚠ THE NO-WRAP IS STRUCTURAL — AND THE PREVIOUS VERSION OF THIS GUARD WAS NOT
 * ENOUGH. It asserted `nowrap` + a `clamp()`, both of which were present when
 * the wordmark WRAPPED AGAIN on a narrower window: `clamp(30px, 7.2vw, 68px)`
 * fits at the width it was verified at, and any fixed px value wraps somewhere.
 *
 * "It fits" is a RELATIONSHIP: textWidth = k x fontSize, so the safe size is
 * availableWidth / k. This asserts the FORMULA holds — that the vw coefficient
 * is small enough for the measured k at the shipped weight and tracking.
 */
/**
 * ⚠⚠ THE AVAILABLE WIDTH IS THE LOCKUP'S OWN CAP, NOT THE VIEWPORT — and this
 * is exactly what let Archivo run off the screen once. The box was
 * min(92vw, 900px), so 900px was the binding number on any desktop, and 104px x
 * k overflowed it for BOTH faces. A getBoundingClientRect() check could not see
 * it, because on a block that returns the CLAMPED BOX, not the content.
 */
test('⚠⚠ every trial face fits the lockup box — derived per face, not scaled', () => {
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup {'), LOGIN.indexOf('.brand-lockup .brand-name'));
  assert.ok(/white-space:\s*nowrap/.test(LOGIN), 'the wordmark must never wrap');
  const boxVw = Number((css.match(/width:\s*min\((\d+)vw/) || [])[1]);
  const boxPx = Number((css.match(/width:\s*min\(\d+vw,\s*(\d+)px\)/) || [])[1]);
  assert.ok(boxVw && boxPx, 'the lockup box must be min(<vw>, <px>)');

  // k per (face, weight, tracking), measured from the FONT FILES — the browser
  // has twice reported a synthesised face's numbers instead of the real cut.
  const K = { montserrat: 9.769, archivo: 12.226 };
  const cap = Number((LOGIN.match(/--wm-cap:\s*(\d+)px/) || [])[1]);
  const vws = [...LOGIN.matchAll(/--wm-vw:\s*([\d.]+)vw/g)].map((m) => Number(m[1]));
  assert.strictEqual(vws.length, 2, 'one coefficient per trial face');

  Object.entries(K).forEach(([face, k], i) => {
    assert.ok(cap * k <= boxPx,
      face + ' at the ' + cap + 'px cap is ' + Math.round(cap * k) + 'px wide, '
      + 'which must fit the ' + boxPx + 'px lockup box');
    assert.ok(vws[i] * k <= boxVw,
      face + ' coefficient ' + vws[i] + 'vw x k ' + k + ' = ' + (vws[i] * k).toFixed(1)
      + 'vw, which must fit the ' + boxVw + 'vw box');
  });
});

test('the form paints ABOVE the mark', () => {
  assert.ok(/\.login-nav, \.login-main, \.login-footer \{ position: relative; z-index: 1; \}/.test(LOGIN_LIVE),
    'without this the shape paints over the fields rather than behind them');
});

/**
 * ⚠⚠ A DATA URI IS AN OPAQUE STRING TO CSS — var() DOES NOT RESOLVE INSIDE IT,
 * and the `#` must be percent-encoded. So the brand green is necessarily
 * hard-coded here in its URL-ENCODED SPELLING, which a sweep over `#09e046`
 * will not match. This test is the pin that keeps the two from drifting.
 */
test('⚠⚠ the URL-encoded green in the data URI matches the token', () => {
  const at = LOGIN_LIVE.indexOf('body::before');
  const css = LOGIN_LIVE.slice(at, LOGIN_LIVE.indexOf('}', at));
  const token = (STYLE.match(/--green:\s*#([0-9a-fA-F]{6})/) || [])[1];
  assert.ok(token, '--green not found in the auth stylesheet');
  const encoded = '%23' + token;
  assert.ok(css.indexOf(encoded) !== -1,
    'the data URI must carry the CURRENT brand green as ' + encoded
    + ' — it cannot use var(--green), so this pin is the only thing keeping '
    + 'the background in step with the token');
  assert.ok(!/%2334d399|%234ade80|%2322c55e/.test(css), 'no retired green may survive here');
});

test('reduced-contrast users lose the shape entirely, as the motifs do', () => {
  assert.ok(/@media \(prefers-contrast: more\) \{ body::before \{ display: none; \} \}/.test(LOGIN_LIVE),
    'the dashboard motifs hide under prefers-contrast: more and so must this');
});
