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

test('the wordmark is the full name, big, bold and green', () => {
  assert.ok(/class="brand-name">SCOUT SYSTEMS</.test(LOGIN),
    'the wordmark must read SCOUT SYSTEMS');
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup .brand-name'), LOGIN.indexOf('/* ── THE MARK AS A BACKGROUND'));
  assert.ok(css.length > 60 && css.length < 900, 'slice suspicious: ' + css.length);
  // ⚠ THE SIZE IS A clamp() NOW — read its MAX, which is the shipped size. A
  // naive /font-size:\s*(\d+)px/ picks up the clamp's MINIMUM (30px) and would
  // report the wordmark as tiny while it renders at 68.
  const size = Number((css.match(/font-size:\s*clamp\([^,]+,[^,]+,\s*(\d+)px\)/) || css.match(/font-size:\s*(\d+)px/) || [])[1]);
  const weight = Number((css.match(/font-weight:\s*(\d+)/) || [])[1]);
  assert.ok(size >= 28, 'big: ' + size + 'px');
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
  assert.strictEqual(arcs(css), arcs(nav),
    'same three arcs as the nav mark — a hand-redrawn second version is how two '
    + 'subtly different logos end up on one product');
  assert.strictEqual(radii(css), radii(nav), 'same three dot radii');
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

test('⚠ the small mark is GONE from the lockup — one logo per screen', () => {
  const lockup = LOGIN_LIVE.slice(LOGIN_LIVE.indexOf('class="brand-lockup"'),
                                  LOGIN_LIVE.indexOf('class="card-header"'));
  assert.ok(lockup.length > 20 && lockup.length < 600, 'slice suspicious: ' + lockup.length);
  assert.ok(!/<svg/.test(lockup),
    'the background mark plus a small mark above it is the same logo twice');
  assert.ok(/SCOUT SYSTEMS/.test(lockup), 'the wordmark stays');
});

test('the wordmark roughly doubled', () => {
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup .brand-name'), LOGIN.indexOf('/* ── THE MARK AS A BACKGROUND'));
  const size = Number((css.match(/font-size:\s*clamp\([^,]+,[^,]+,\s*(\d+)px\)/) || [])[1]);
  assert.ok(size >= 60 && size <= 76, 'about 2x the original 34px, got ' + size);
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
  assert.ok(/background-size:\s*50vmin/.test(css), 'Justin asked for ~50% of the screen');
});

/**
 * ⚠⚠ THE WORDMARK MUST NOT WRAP. At 68px inside a 400px card "SCOUT SYSTEMS"
 * broke across two lines — not asked for, and the taller block is what drove it
 * down into the mark. Every measurement taken at the time said the type was
 * fine, because none of them asked whether it FIT; it was caught by looking at
 * the deployed page.
 */
test('⚠ the wordmark cannot wrap — nowrap, and a lockup wider than the card', () => {
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup {'), LOGIN.indexOf('/* ── THE MARK AS A BACKGROUND'));
  assert.ok(css.length > 100 && css.length < 1600, 'slice suspicious: ' + css.length);
  assert.ok(/white-space:\s*nowrap/.test(css), 'a wordmark that wraps reads as a mistake');
  assert.ok(/font-size:\s*clamp\(/.test(css),
    'with nowrap it must scale DOWN on a narrow screen rather than overflow');
  assert.ok(/width:\s*min\(/.test(css),
    'the lockup is wider than the 400px card on purpose — 68px needs ~520px');
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
