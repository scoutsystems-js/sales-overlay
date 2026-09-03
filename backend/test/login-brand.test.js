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

test('the wordmark is the full name — now carried by the IMAGE and its alt text', () => {
  // ⚠⚠ CONVERTED 2026-08-21, NOT DELETED. The property this always protected is
  // "the wordmark reads SCOUT SYSTEMS and is big". That survives; only the
  // mechanism changed, from text to Justin's logo image. Colour and weight are
  // no longer CSS at all — they are pixels in the artwork — so asserting them
  // here would be asserting something this file can no longer see.
  const lockup = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('class="brand-lockup"'),
                                  LOGIN_LIVE.indexOf('class="card-header"'));
  assert.ok(lockup.length > 80 && lockup.length < 1200, 'slice suspicious: ' + lockup.length);
  assert.ok(/src="\/scout-wordmark\.svg"/.test(lockup), 'the lockup must load the logo image');
  assert.ok(/alt="Scout Systems"/.test(lockup),
    'the wordmark must still READ "Scout Systems" — for a screen reader that alt '
    + 'text is now the only wordmark on the page');
  assert.ok(!/SCOUT SYSTEMS<|UT SYSTEMS</.test(lockup),
    'the retired TEXT lockup must not come back alongside the image');
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
test('⚠⚠ the BACKGROUND mark is still drawn, and the only fetched image is the wordmark', () => {
  // ⚠⚠ THIS ASSERTION WAS INVERTED BY A RULING, AND THE REASON IS RECORDED SO
  // NOBODY "RESTORES" IT. It used to demand NO image request anywhere on this
  // page. Justin ruled on 2026-08-21 that the wordmark IS his logo image — the
  // mark replaces the O, so no typeface can draw it — which makes exactly one
  // image request correct rather than forbidden.
  //
  // ⚠ WHAT THE ORIGINAL WAS REALLY PROTECTING SURVIVES INTACT, and it is two
  // separate things:
  //   1  the BACKGROUND mark stays an inline data URI, not a file
  //   2  icon.png specifically stays out — it is an app icon with no alpha, a
  //      baked-in wordmark and a generator watermark, and swapping it in here
  //      would reintroduce all three at once
  const at = LOGIN_LIVE.indexOf('body::before');
  const css = LOGIN_LIVE.slice(at, LOGIN_LIVE.indexOf('}', at));
  assert.ok(css.length > 200 && css.length < 4000, 'slice suspicious: ' + css.length);
  assert.ok(/url\("data:image\/svg\+xml,/.test(css),
    'the background mark must stay an inline SVG data URI, not a file request');

  assert.ok(!/icon\.png/.test(LOGIN_LIVE), 'icon.png must never be used as the logo here');
  const imgs = LOGIN_LIVE.match(/<img[^>]*>/g) || [];
  assert.strictEqual(imgs.length, 1, 'exactly one image on this page, got ' + imgs.length);
  assert.ok(/scout-wordmark\.svg/.test(imgs[0]), 'and it is the wordmark: ' + imgs[0]);
});

/**
 * ══ THE DIVERGENCE MAP ═══════════════════════════════════════════════════
 * ⚠⚠ RE-DERIVED 2026-08-19, NOT PATCHED. The old guard pinned the background
 * mark TO the nav with the lockup bolted on as an exception — which, after the
 * background arcs closed to 285 degrees, would have described the wrong
 * relationship entirely. A guard that still states the old arrangement with an
 * exception attached is how the next person misreads WHICH difference was
 * intended.
 *
 *                      arcs     rings        dots
 *   lockup             285deg   nav size     nav size, mocked positions
 *   background mark    285deg   x1.12        radii x0.25, offsets x0.62
 *   nav                180deg   nav size     nav size
 *
 * READ IT AS: the LOCKUP and the BACKGROUND MARK now SHARE the 285-degree
 * sweep; the NAV is the lone 180-degree holdout. Every difference below was
 * ruled deliberately — none may drift, and restoring any of them has to be a
 * decision rather than a tidy-up.
 */
test('⚠⚠ THE MAP: the background mark is 285deg; the nav is the lone 180deg holdout', () => {
  // ⚠ THE MAP HAS TWO ENTRIES NOW, NOT THREE. The lockup ring was the third,
  // and it is gone with the text lockup — the wordmark's mark now lives inside
  // the raster, where no test can read its sweep. Re-derived rather than
  // patched: a guard that still names a third party and excuses it is how the
  // next reader misreads which difference was deliberate.
  const bg = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('body::before'),
                              LOGIN_LIVE.indexOf('}', LOGIN_LIVE.indexOf('background-image')));
  const nav = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('class="nav-logo"'),
                               LOGIN_LIVE.indexOf('class="back"'));
  // the sweep is carried by the large-arc flag: "0 0 1" = 180deg, "0 1 1" = 285deg
  const sweep = (t) => /A[\d.]+ [\d.]+ 0 1 1/.test(t) ? 285 : (/A[\d.]+ [\d.]+ 0 0 1/.test(t) ? 180 : null);
  assert.strictEqual(sweep(bg), 285, 'the background mark must stay closed to 285deg');
  assert.strictEqual(sweep(nav), 180, 'the NAV is the deliberate 180deg holdout — do not close it');
  assert.ok(!/class="brand-o"/.test(LOGIN_LIVE),
    'the lockup glyph is retired; if it returns, this map needs its third entry back');
});

test('⚠ the landing page carries the SAME mark and INHERITS login\'s closed ceiling', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const live = idx.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/body::before/.test(live), 'the landing page must carry the mark');
  const op = Number((live.match(/body::before\s*\{[^}]*opacity:\s*([\d.]+)/) || [])[1]);
  assert.ok(op && op <= 0.215,
    'the landing page shares css/style.css and its genuine grey, so it shares '
    + "login's 0.215 ceiling — ONE ruling covering two pages. Got " + op);
  assert.ok(/A[\d.]+ [\d.]+ 0 1 1/.test(live), 'and the same 285deg sweep');
  // page-scoped: nine pages share the stylesheet and must NOT inherit this
  const shared = fs.readFileSync(path.join(__dirname, '..', 'web', 'css', 'style.css'), 'utf8');
  assert.ok(!/body::before/.test(shared),
    'the mark must stay page-scoped — in the shared stylesheet it would paint on '
    + 'set-password, terms, privacy, docs, support, connect and download too');
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
test('⚠ the lockup shows the logo ONCE — never the image and an inline mark together', () => {
  // ⚠ THE HAZARD IS UNCHANGED AND STILL WORTH GUARDING: the same logo twice on
  // one screen. It used to be "exactly one <svg>, in the O slot"; it is now
  // "exactly one <img>, and no <svg> beside it".
  const lockup = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('class="brand-lockup"'),
                                  LOGIN_LIVE.indexOf('class="card-header"'));
  assert.ok(lockup.length > 80 && lockup.length < 1200, 'slice suspicious: ' + lockup.length);
  assert.strictEqual((lockup.match(/<img/g) || []).length, 1, 'exactly one wordmark image');
  assert.strictEqual((lockup.match(/<svg/g) || []).length, 0,
    'no inline mark inside the lockup — the image already contains it');
});

test('the wordmark is still >= 50% wider than the login box', () => {
  // ⚠ JUSTIN'S RULE SURVIVES THE MECHANISM CHANGE: the wordmark must be at
  // least 50% wider than the 400px card, i.e. >= 600px. It used to be derived
  // from font-size x k; it is now simply the image's width cap.
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup {'), LOGIN.indexOf('.brand-lockup .brand-img'));
  assert.ok(css.length > 40 && css.length < 800, 'slice suspicious: ' + css.length);
  const boxPx = Number((css.match(/width:\s*min\(\d+vw,\s*(\d+)px\)/) || [])[1]);
  assert.ok(boxPx, 'the lockup box must be min(<vw>, <px>)');
  assert.ok(boxPx >= 400 * 1.5,
    'the wordmark must span >= 1.5x the 400px login box (600px); got ' + boxPx + 'px');
});

/**
 * ⚠⚠ THE GREYS ARE A CLOSED EXCEPTION (Justin, 2026-08-18). This page keeps
 * --muted #8a9aaa where the dashboard eliminated it, which caps this surface at
 * 0.215 and therefore caps the mark at 0.20 — where it already is. A future
 * "make it brighter" has a known answer: not without reopening the greys.
 */
test('⚠ NOTHING ELSE MOVED — the background mark kept its own geometry', () => {
  // ⚠⚠ CONVERTED FROM test/lockup-glyph.test.js, which was archived when the
  // text lockup was retired. Five of its six tests were about the inline SVG "O"
  // and died with it; THIS one is about a property that survives and was
  // precisely the thing at risk in that commit — deleting the lockup's derived
  // chain must not disturb the SEPARATE background mark, whose stroke is a
  // function of a DIFFERENT box and is written into its data URI.
  assert.ok(/0\.464 2\.464 19\.072 17\.105/.test(LOGIN),
    'the background mark viewBox must be untouched');
  assert.ok(/stroke-width='0\.032'/.test(LOGIN) || /stroke-width=%270\.032%27/.test(LOGIN),
    'the background mark stroke must be untouched');
});

test('⚠ the login page keeps its genuine grey, and the mark sits at that ceiling', () => {
  assert.ok(/--muted:\s*#8a9aaa/.test(STYLE),
    'the login/landing stylesheet keeps the real grey — the no-grey sweep '
    + 'deliberately does NOT apply here');
  // ⚠ strip comments first — several of them mention `body::before` by name,
  // and matching prose instead of the rule is the trap this file documents.
  const live = LOGIN.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = live.indexOf('body::before');
  const css = live.slice(at, live.indexOf('}', at));
  const op = Number((css.match(/opacity:\s*([\d.]+)/) || [])[1]);
  assert.ok(op && op <= 0.215,
    'with the greys kept, 0.215 is this surface\'s AA ceiling — got ' + op);
  assert.ok(op >= 0.19, 'and it should sit AT that ceiling, not below: ' + op);
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
/**
 * ⚠⚠ THE AVAILABLE WIDTH IS THE LOCKUP'S OWN CAP, NOT THE VIEWPORT — this is
 * what let Archivo run off the screen during the trial. The box was
 * min(92vw, 900px), so 900px bound on any desktop and 104px x k overflowed it.
 * A getBoundingClientRect() check could not see it: on a block that returns the
 * CLAMPED BOX, never the content. scrollWidth vs clientWidth is the only pair
 * that answers the question.
 *
 * The trial is over — Archivo Expanded 700 shipped — so this now pins the ONE
 * face, still derived rather than scaled.
 */
test('⚠⚠ the image cap is the ASSET\'S NATIVE WIDTH — the new failure mode is upscaling', () => {
  // ⚠⚠ THE FAILURE MODE CHANGED WITH THE MECHANISM, WHICH IS THE WHOLE POINT OF
  // CONVERTING THIS TEST RATHER THAN DELETING IT. Text WRAPS when it does not
  // fit, so the old guard derived a font-size from a measured k. An image
  // cannot wrap — it OVERFLOWS or it SCALES — so the thing to pin is different:
  //   the vw cap  keeps it inside the viewport   (overflow)
  //   the px cap  keeps it at or below native    (upscaling)
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup {'), LOGIN.indexOf('.brand-lockup .brand-img'));
  const boxVw = Number((css.match(/width:\s*min\((\d+)vw/) || [])[1]);
  const boxPx = Number((css.match(/width:\s*min\(\d+vw,\s*(\d+)px\)/) || [])[1]);
  assert.ok(boxVw && boxPx, 'the lockup box must be min(<vw>, <px>)');
  assert.ok(boxVw <= 100, 'the vw cap must keep the image inside the viewport: ' + boxVw);

  /* ⚠ THE ASSET IS A VECTOR NOW (2026-09-03, H695) — read its declared size from the SVG root, never a
     hard-coded number; a vector has no native width, so the old "px cap must not exceed native width"
     (the upscale guard) is retired — there is nothing to upscale. The markup's intrinsic size must still
     match the file, or the page reflows on load. */
  const svg = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-wordmark.svg'), 'utf8');
  const root = svg.match(/<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/);
  assert.ok(root, 'the SVG declares width and height');
  const nativeW = Number(root[1]), nativeH = Number(root[2]);
  assert.ok(/<path\b/.test(svg) && !/<metadata\b/.test(svg), 'outlines, and no metadata manifest');
  assert.ok(new RegExp('width="' + nativeW + '" height="' + nativeH + '"').test(LOGIN), 'the markup declares the file\'s intrinsic size');
});

test('⚠ the wordmark face is SELF-HOSTED — no third-party request on the first page', () => {
  assert.ok(/@font-face/.test(LOGIN) && /archivo-expanded-700\.woff2/.test(LOGIN),
    'Archivo must be served from /fonts, not fonts.googleapis.com');
  assert.ok(!/family=Archivo/.test(LOGIN),
    'no Google request may remain for the wordmark face');
  assert.ok(/font-display:\s*swap/.test(LOGIN), 'a slow font must never block the form');
  // the trial is gone
  assert.ok(!/data-wm/.test(LOGIN), 'the ?font= trial scaffolding must be removed');
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
