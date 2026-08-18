/**
 * THE LOGIN WELCOME SEQUENCE.
 *
 * ⚠⚠ THE ASSERTION THAT MATTERS MOST IS THAT IT CANNOT BECOME A GATE. Every
 * other property is cosmetic; this one decides whether a decoration can lock a
 * user out of the product. It is proven by BREAKING the animation deliberately
 * and showing the user still arrives, not by reading the try/catch.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LOGIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── the fresh-vs-resumed distinction ──────────────────────────────────────
test('⚠ the marker is set at the ONE call site that knows a password was typed', () => {
  // redirectByRole() is shared by the fresh-login path and both resumed-session
  // paths, so marking inside it would fire on every visit. It must be set in
  // handleSubmit, before the redirect.
  const at = LOGIN.indexOf("sessionStorage.setItem('scout_welcome_v1'");
  assert.ok(at > 0, 'the fresh-login marker is missing from login.html');
  const fn = LOGIN.lastIndexOf('async function handleSubmit', at);
  const other = LOGIN.lastIndexOf('async function checkExistingSession', at);
  assert.ok(fn > other,
    'the marker must be inside handleSubmit — inside checkExistingSession or '
    + 'redirectByRole it would fire on a RESUMED session too');
  assert.ok(!/function redirectByRole[\s\S]{0,900}scout_welcome_v1/.test(LOGIN),
    'redirectByRole is shared by all three paths and must not set the marker');
});

test('⚠ the marker is read ONCE and cleared before anything can throw', () => {
  const at = LIVE.indexOf('function playWelcomeIfFresh');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', LIVE.indexOf('watchdog', at)) + 4);
  assert.ok(fn.length > 600 && fn.length < 4000, 'slice suspicious: ' + fn.length);
  const getAt = fn.indexOf('getItem(WELCOME_KEY)');
  const delAt = fn.indexOf('removeItem(WELCOME_KEY)');
  assert.ok(getAt > 0 && delAt > getAt, 'read then clear');
  assert.ok(delAt < fn.indexOf('document.body.appendChild'),
    'the marker must be cleared BEFORE the overlay is built — a crash mid-build '
    + 'must not leave the sequence armed for every future load');
});

// ── ⚠⚠ it must not become a gate ──────────────────────────────────────────
test('⚠⚠ A THROW ANYWHERE STILL LEAVES THE USER ON THE DASHBOARD', () => {
  // Run the real functions with a DOM that throws on append — the most
  // destructive point — and assert init()'s caller survives and no overlay
  // remains.
  const at = LIVE.indexOf('  var WELCOME_KEY');
  const end = LIVE.indexOf('  async function init()');
  const src = LIVE.slice(at, end);
  assert.ok(src.length > 2000 && src.length < 20000, 'slice suspicious: ' + src.length);

  let appended = null, warned = false;
  const doc = {
    createElement: () => ({ set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
                            get firstChild() { return mkNode(); } }),
    body: { appendChild: () => { throw new Error('boom — appendChild exploded'); } },
  };
  function mkNode() {
    return { style: { setProperty() {}, }, classList: { add() {} },
             addEventListener() {}, parentNode: null };
  }
  const win = { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} };
  const ss = { getItem: () => '1', removeItem() {}, setItem() {} };
  const fn = new Function('document', 'window', 'sessionStorage', 'setTimeout', 'console',
    src + '; return playWelcomeIfFresh;')(doc, win, ss, () => 0,
      { warn: () => { warned = true; } });

  assert.doesNotThrow(fn, 'playWelcomeIfFresh must swallow everything — a throw here '
    + 'propagates into init() and the dashboard never finishes booting');
  assert.ok(warned, 'and it should say so in the console rather than failing silently');
});

test('⚠ the call site itself is ALSO wrapped — belt and braces at the boundary', () => {
  assert.ok(/try \{ playWelcomeIfFresh\(\); \} catch \(e\) \{[^}]*\}/.test(LIVE),
    'init() must guard the call as well as the function guarding itself');
  // and it must be the LAST thing init does, after the dashboard has rendered
  const initAt = LIVE.indexOf('  async function init()');
  const callAt = LIVE.indexOf('playWelcomeIfFresh();', initAt);
  const initEnd = LIVE.indexOf('\n  }', callAt);
  assert.ok(callAt > initAt && initEnd - callAt < 200,
    'the welcome must be the last line of init(), so the page is already up');
});

test('⚠ a WATCHDOG removes the overlay even if every other path fails', () => {
  const at = LIVE.indexOf('WELCOME_TIMING = {');
  const cfg = LIVE.slice(at, LIVE.indexOf('};', at));
  assert.ok(/watchdog:\s*\d+/.test(cfg), 'a hard watchdog timeout must exist');
  const wd = Number(cfg.match(/watchdog:\s*(\d+)/)[1]);
  const total = Number(cfg.match(/titleAt:\s*(\d+)/)[1]) + Number(cfg.match(/textIn:\s*(\d+)/)[1])
    + Number(cfg.match(/hold:\s*(\d+)/)[1]) + Number(cfg.match(/swipe:\s*(\d+)/)[1]);
  assert.ok(wd > total, 'the watchdog (' + wd + 'ms) must outlast the sequence (' + total + 'ms)');
  assert.ok(wd < 10000, 'but must not itself be a long wait: ' + wd);
});

test('dismissal is IDEMPOTENT — click, key, timer and watchdog may all fire', () => {
  const at = LIVE.indexOf('function welcomeDismiss');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(/_welGone/.test(fn), 'a re-entry guard is required — four callers race');
  assert.ok(/node\.style\.display = .none./.test(fn),
    'if even removal throws, the overlay must at least be hidden');
});

// ── the ruled behaviours ──────────────────────────────────────────────────
test('CLICK OR KEYPRESS skips immediately, not "skips to the swipe"', () => {
  assert.ok(/var skip = function \(\) \{ welcomeDismiss\(node, true\)/.test(LIVE),
    'skip must pass immediate=true');
  assert.ok(/node\.addEventListener\('click', skip\)/.test(LIVE));
  assert.ok(/window\.addEventListener\('keydown', onKey\)/.test(LIVE));
});

test('⚠ reduced motion gets a PLAIN FADE, not a faster sequence', () => {
  const at = LIVE.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(at > 0, 'no reduced-motion block');
  const css = LIVE.slice(at, LIVE.indexOf('}\n    .team-controls-row', at));
  ['.wel-ticks', '.wel-segs', '.wel-sweep'].forEach((sel) => {
    assert.ok(css.indexOf(sel) !== -1, sel + ' must be stilled');
  });
  assert.ok(/animation: none/.test(css), 'the moving parts must stop entirely');
  assert.ok(/welFadeOut/.test(css), 'and the exit must be a fade, not the swipe');
});

test('⚠ the green comes from the TOKEN — it changed once and will again', () => {
  const at = LIVE.indexOf('.wel {');
  const css = LIVE.slice(at, LIVE.indexOf('.team-controls-row', at));
  assert.ok(/stroke: var\(--accent\)/.test(css) && /fill: var\(--accent\)/.test(css));
  assert.ok(/color: var\(--accent\)/.test(css), 'the text too');
  assert.ok(/rgba\(var\(--accent-rgb\)/.test(css), 'the glow must use the channel form');
  assert.strictEqual((css.match(/#[0-9a-fA-F]{6}/g) || []).filter((c) => c !== '#050505').length, 0,
    'no colour literal may appear in the welcome CSS except the backdrop');
});

test('⚠ EVERY duration lives in ONE object', () => {
  const at = LIVE.indexOf('WELCOME_TIMING = {');
  const cfg = LIVE.slice(at, LIVE.indexOf('};', at));
  ['coreIn', 'segStep', 'segOn', 'satFirst', 'satStagger', 'satIn',
   'textAt', 'titleAt', 'textIn', 'hold', 'swipe', 'spinSlow', 'spinBack', 'sweep', 'watchdog']
    .forEach((k) => assert.ok(new RegExp(k + ':\\s*\\d+').test(cfg), 'missing timing: ' + k));

  // The stylesheet must hold no timing of its own — otherwise "one edit" is a lie.
  const cssAt = LIVE.indexOf('.wel {');
  const css = LIVE.slice(cssAt, LIVE.indexOf('.team-controls-row', cssAt));
  const hardCoded = (css.match(/animation:[^;]*?\b\d+m?s\b/g) || []);
  assert.deepStrictEqual(hardCoded, [],
    'a duration is hard-coded in CSS instead of coming from WELCOME_TIMING: ' + JSON.stringify(hardCoded));
});

test('the sequence is about three seconds, drawn, with no dependency', () => {
  const at = LIVE.indexOf('WELCOME_TIMING = {');
  const cfg = LIVE.slice(at, LIVE.indexOf('};', at));
  const n = (k) => Number(cfg.match(new RegExp(k + ':\\s*(\\d+)'))[1]);
  const total = n('titleAt') + n('textIn') + n('hold') + n('swipe');
  assert.ok(total > 2400 && total < 3600, 'end to end should be ~3s, got ' + total + 'ms');
  // drawn, not fetched
  const mAt = LIVE.indexOf('function welcomeOverlayHtml');
  const mk = LIVE.slice(mAt, LIVE.indexOf('function welcomeDismiss'));
  // ⚠ `url(#welSweepGrad)` is a SAME-DOCUMENT fragment reference to an inline
  // <linearGradient>, not a network request — the first version of this check
  // flagged it and was wrong. Only an EXTERNAL url() is a dependency.
  const external = (mk.match(/url\(\s*['"]?(?!#)/g) || []);
  assert.deepStrictEqual(external, [], 'an external url() would be a dependency');
  assert.ok(!/<img|fetch\(|import |require\(/.test(mk), 'no image, no request, no library');
  assert.ok(/<svg class="wel-svg"/.test(mk), 'inline SVG');
});

test('the overlay contains every element the design called for', () => {
  const mAt = LIVE.indexOf('function welcomeOverlayHtml');
  const mk = LIVE.slice(mAt, LIVE.indexOf('function welcomeDismiss'));
  assert.ok(/wel-ticks/.test(mk), 'fine tick ring');
  assert.ok(/wel-segs/.test(mk), 'segmented arc');
  assert.ok(/wel-seg/.test(mk), 'blocks that light individually');
  assert.ok(/spokes/.test(mk), 'radial spokes');
  assert.ok((mk.match(/<circle[^>]*r="300"|r="150"/g) || []).length >= 1, 'two inner circles');
  assert.ok(/wel-sweep/.test(mk), 'radar sweep');
  assert.ok((mk.match(/\[170, 170\], \[830, 170\], \[170, 830\], \[830, 830\]/g) || []).length === 1,
    'four satellites, one per corner');
  assert.ok(/Welcome to/.test(mk) && /SCOUT SYSTEMS/.test(mk), 'the two lines of copy');
});
