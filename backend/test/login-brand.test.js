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
  const css = LOGIN.slice(LOGIN.indexOf('.brand-lockup .brand-name'), LOGIN.indexOf('.card-header {'));
  assert.ok(css.length > 60 && css.length < 900, 'slice suspicious: ' + css.length);
  const size = Number((css.match(/font-size:\s*(\d+)px/) || [])[1]);
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
  assert.ok(/--green-rgb:\s*9,\s*224,\s*70/.test(root),
    'the channel spelling must match #09e046');
  assert.ok(/--green-dim:\s*rgba\(var\(--green-rgb\)/.test(root), '--green-dim must derive');
  assert.ok(/--green-glow:\s*rgba\(var\(--green-rgb\)/.test(root), '--green-glow must derive');
  assert.ok(!/34,\s*197,\s*94/.test(root),
    'the OLD green (#22c55e) must not survive in channel form anywhere in :root');
});

test('the mark is drawn, not fetched — no asset request on the login page', () => {
  const lockup = LOGIN.slice(LOGIN.indexOf('class="brand-lockup"'), LOGIN.indexOf('class="card-header"'));
  assert.ok(lockup.length > 200 && lockup.length < 3000, 'slice suspicious: ' + lockup.length);
  assert.ok(/<svg/.test(lockup), 'inline SVG');
  assert.ok(!/<img|icon\.png|url\(/.test(lockup),
    'no image request — and specifically not icon.png, which is an app icon '
    + 'with no alpha, a baked-in wordmark and a watermark');
  assert.ok(/aria-hidden="true"/.test(lockup),
    'the name is real text right beneath it; a reader must not hear it twice');
});

test('the mark matches the nav logo rather than being redrawn by eye', () => {
  const lockup = LOGIN.slice(LOGIN.indexOf('class="brand-lockup"'), LOGIN.indexOf('class="card-header"'));
  const nav = LOGIN.slice(LOGIN.indexOf('class="nav-logo"'), LOGIN.indexOf('class="back"'));
  const geom = (s) => (s.match(/A[\d.]+ [\d.]+ 0 0 1|r="[\d.]+"/g) || []).join('|');
  assert.strictEqual(geom(lockup), geom(nav),
    'same arcs and radii as the nav mark — a hand-redrawn second version is how '
    + 'two subtly different logos end up on one product');
});
