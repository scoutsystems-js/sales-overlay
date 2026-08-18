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
});

/**
 * ⚠⚠ THIS ASSERTION IS THE REVERSE OF THE ONE IT REPLACES, DELIBERATELY.
 *
 * It used to require the call be the LAST line of init(). That produced Josh's
 * "tabs flash before the animation starts" (2026-08-18): the static top-bar
 * markup paints at parse time, and everything above the old call site includes
 * two or three AWAITED network round-trips, so the chrome sat visible for a
 * network gap before the overlay appeared.
 *
 * Mounting early does not reintroduce the gate the old position was protecting
 * against — the overlay is a fixed layer, the dashboard renders underneath it,
 * and nothing below awaits it. Kept as a test rather than a comment so nobody
 * "restores" the old ordering on the strength of the old reasoning.
 */
test('⚠ the welcome mounts BEFORE init() awaits the network — that is the flash fix', () => {
  const initAt = LIVE.indexOf('  async function init()');
  assert.ok(initAt > 0, 'init() not found — anchor is stale');
  const callAt = LIVE.indexOf('playWelcomeIfFresh();', initAt);
  const firstAwait = LIVE.indexOf('await refreshSessionIfNeeded()', initAt);
  const fetchMeAt = LIVE.indexOf('await fetchMe()', initAt);
  assert.ok(callAt > initAt, 'init() must still call playWelcomeIfFresh()');
  assert.ok(firstAwait > 0 && fetchMeAt > 0, 'await anchors are stale — re-derive this test');
  assert.ok(callAt < firstAwait && callAt < fetchMeAt,
    'the overlay must mount BEFORE init() awaits the network, or the static '
    + 'top-bar chrome is on screen for the whole round-trip (Josh: tabs flash)');

  // ...but still AFTER the popup early-returns, which close the window.
  const popupClose = LIVE.indexOf('window.close();', initAt);
  assert.ok(popupClose > 0 && popupClose < callAt,
    'an OAuth popup lands on /dashboard and closes itself — it must never play');
});

test('⚠ a WATCHDOG removes the overlay even if every other path fails', () => {
  const at = LIVE.indexOf('WELCOME_TIMING = {');
  const cfg = LIVE.slice(at, LIVE.indexOf('};', at));
  assert.ok(cfg.length > 200 && cfg.length < 6000, 'slice suspicious: ' + cfg.length);
  assert.ok(/watchdog:\s*\d+/.test(cfg), 'a hard watchdog timeout must exist');
  const n = (k) => Number(cfg.match(new RegExp(k + ':\\s*(\\d+)'))[1]);
  const wd = n('watchdog');
  // ⚠ THE CAP COUNTS TOWARD THE TOTAL. The readiness hold extends the sequence
  // by up to holdCap, so a watchdog that only outlasted the BASE sequence could
  // fire during a legitimate hold and cut the ceremony short.
  const total = n('titleAt') + n('textIn') + n('hold') + n('swipe') + n('holdCap');
  assert.ok(wd > total,
    'the watchdog (' + wd + 'ms) must outlast the sequence INCLUDING the hold cap (' + total + 'ms)');
  assert.ok(wd < 10000, 'but must not itself be a long wait: ' + wd);
});

/**
 * ⚠⚠ THE HOLD IS A CAP, NOT AN EXCEPTION TO THE NO-WAIT RULE. These assertions
 * exist so that "hold until the dashboard is ready" can never quietly become
 * "wait for the dashboard", which is the unbounded version.
 */
test('⚠⚠ the readiness hold is BOUNDED — it can never wait forever', () => {
  const at = LIVE.indexOf('var waitedFrom = null;');
  assert.ok(at > 0, 'the hold is missing');
  const fn = LIVE.slice(at, LIVE.indexOf('setTimeout(tick, runFor);', at) + 30);
  assert.ok(fn.length > 200 && fn.length < 2000, 'slice suspicious: ' + fn.length);

  assert.ok(/expired/.test(fn) && /holdCap/.test(fn),
    'the hold must give up on a cap');
  assert.ok(/welcomeDashboardReady \|\| expired/.test(fn),
    'EITHER readiness OR expiry must end the hold — an AND would make the cap '
    + 'useless whenever readiness never arrives');
  // The dependency the prohibition guards against is an await. There must be none.
  assert.ok(!/await/.test(fn),
    'the hold must POLL a flag, never await a promise — an awaited promise that '
    + 'never resolves is exactly the gate this cannot become');
});

test('⚠ readiness is set by the COACHING boot, never by the model-backed lanes', () => {
  assert.ok(/function markDashboardReady\(\)/.test(LIVE), 'the signal must exist');
  // It must be set after render() in reloadAll — the page the swipe reveals.
  const rl = LIVE.indexOf('async function reloadAll()');
  assert.ok(rl > 0, 'reloadAll anchor is stale');
  const body = LIVE.slice(rl, LIVE.indexOf('\n  }', LIVE.indexOf('markDashboardReady();', rl)));
  assert.ok(body.indexOf('markDashboardReady();') > body.indexOf('render();'),
    'ready must mean PAINTED, so the signal follows render()');
  // and nothing in the team lanes may set it
  const lt = LIVE.indexOf('async function loadTeam(');
  const ltBody = LIVE.slice(lt, LIVE.indexOf('\n  }', lt));
  assert.ok(ltBody.indexOf('markDashboardReady') === -1,
    'four team lanes are Claude syntheses taking tens of seconds on a cache '
    + 'miss — readiness must never depend on them');
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

test('⚠ the overlay title carries the LOCKUP — one glyph, in the O slot', () => {
  const mAt = LIVE.indexOf('function welcomeOverlayHtml');
  const mk = LIVE.slice(mAt, LIVE.indexOf('function welcomeDismiss'));
  assert.ok(/class=\\"wel-o\\"/.test(mk) || /wel-o/.test(mk), 'the O slot must exist');
  assert.strictEqual((mk.match(/wel-o/g) || []).length >= 1, true, 'exactly one lockup glyph');
  assert.ok(/SC</.test(mk) && /UT SYSTEMS/.test(mk),
    'the title must still read SCOUT SYSTEMS around the glyph');
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
  // ⚠ the title is SPLIT around the lockup glyph now: SC<svg/>UT SYSTEMS
  assert.ok(/Welcome to/.test(mk) && /SC</.test(mk) && /UT SYSTEMS/.test(mk),
    'the two lines of copy, with the wordmark split around the O glyph');
});

// ── the first-paint cover (Josh's "tabs flash", 2026-08-18) ───────────────
/**
 * ⚠ THESE READ THE RAW HTML, NOT `LIVE`. The cover is declared in a <head>
 * script that must run before any markup exists, and `LIVE` has comments
 * stripped — but more importantly the ORDER of these elements in the file is
 * the property under test, and stripping changes offsets.
 */
test('⚠⚠ the cover is painted by a SYNCHRONOUS head script, above all chrome', () => {
  const scriptAt = HTML.indexOf("sessionStorage.getItem('scout_welcome_v1')");
  const bodyAt = HTML.indexOf('<body>');
  /**
   * ⚠⚠ SEARCHED FROM <body>, AND THE FIRST DRAFT OF THIS LINE WAS NOT — it hit
   * the phrase `<nav class="top-bar">` inside the cover script's OWN COMMENT
   * (which explains that the nav is static markup) at offset 468, rather than
   * the real element at 111088. The test then failed claiming the cover was
   * mounted after the chrome, which was the exact opposite of the truth.
   *
   * The tempting fix was to delete the sentence the matcher tripped on — i.e.
   * to remove the explanation of the rule in order to satisfy the check on it.
   * Anchoring past <body> is the actual fix.
   */
  const navAt = HTML.indexOf('<nav class="top-bar">', bodyAt);
  const mainScript = HTML.indexOf('<script>\n', bodyAt);
  assert.ok(scriptAt > 0, 'the head cover script is missing');
  assert.ok(bodyAt > 0 && navAt > 0, 'top-bar anchor is stale — re-derive this test');
  assert.ok(scriptAt < navAt,
    'the cover must be set BEFORE the static top-bar markup, or the chrome '
    + 'paints first and the flash is back');
  assert.ok(scriptAt < mainScript || mainScript === -1,
    'and before the main script, which does not run until after parse');
  assert.ok(!/async|defer/.test(HTML.slice(HTML.lastIndexOf('<script', scriptAt), scriptAt)),
    'the cover script must be synchronous — async/defer would let the chrome paint');
});

test('⚠⚠ the head script READS the marker but must never CLEAR it', () => {
  const at = HTML.indexOf("sessionStorage.getItem('scout_welcome_v1')");
  const block = HTML.slice(at - 400, HTML.indexOf('</script>', at));
  assert.ok(block.length > 100, 'slice suspicious: ' + block.length);
  assert.ok(!/removeItem|setItem/.test(block),
    'playWelcomeIfFresh is the one place that reads-and-clears; if the head '
    + 'script consumed the marker the sequence would never play at all');
});

test('⚠⚠ the cover ARMS ITS OWN REMOVAL — it cannot outlive a broken page', () => {
  const at = HTML.indexOf("sessionStorage.getItem('scout_welcome_v1')");
  const block = HTML.slice(at, HTML.indexOf('</script>', at));
  assert.ok(/setTimeout\(/.test(block) && /removeAttribute\('data-welcoming'\)/.test(block),
    'the failsafe must be armed in the SAME synchronous block, so a later '
    + 'parse error or a dead init() still cannot leave a black screen');
  const ms = Number((block.match(/\}, (\d+)\);/) || [])[1]);
  assert.ok(ms > 0 && ms <= 10000, 'failsafe must be bounded and short: ' + ms);
});

test('⚠ the cover sits BELOW the overlay, so the handoff cannot flicker', () => {
  const cover = LIVE.slice(LIVE.indexOf('html[data-welcoming]::before'), LIVE.indexOf('.wel {'));
  const wel = LIVE.slice(LIVE.indexOf('.wel {'), LIVE.indexOf('.wel-stage'));
  const z = (s) => Number((s.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z(cover) < z(wel), 'cover ' + z(cover) + ' must be under overlay ' + z(wel));
  // ⚠ html::before, not body — body[data-view]::before is the motif layer.
  assert.ok(/html\[data-welcoming\]::before/.test(LIVE),
    'must be on <html> — body::before already carries the background motifs');
});

test('⚠ EVERY path that declines to play still takes the cover down', () => {
  const at = LIVE.indexOf('function playWelcomeIfFresh');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', LIVE.indexOf('watchdog', at)) + 4);
  assert.ok(fn.length > 600 && fn.length < 5000, 'slice suspicious: ' + fn.length);
  // private mode, resumed session, mounted, and total failure
  assert.ok((fn.match(/welUncover\(\)/g) || []).length >= 4,
    'private-mode return, not-fresh return, the mount handoff and the outer '
    + 'catch must each uncover — otherwise the 8s failsafe becomes the UX');
});

// ── the animated-constraint rule (Josh's "stacked then snaps", 2026-08-18) ──
/**
 * ⚠⚠ WHEN A PROPERTY IS ANIMATED, THE CONSTRAINT MUST HOLD AT EVERY VALUE IT
 * PASSES THROUGH — NOT JUST THE ENDPOINTS.
 *
 * welSettle animates letter-spacing FROM 0.7em down to the resting track, so
 * the widest state is the FIRST frame. The title was sized for the RESTING
 * tracking, so it wrapped to two lines at the start and reflowed to one the
 * instant tracking fell below ~0.31em. That single-frame reflow was the
 * reported "glitch".
 *
 * letter-spacing adds exactly `tracking x charCount` to the advance width, so
 * this is arithmetic rather than estimation.
 */
test('⚠⚠ the overlay wordmark fits at the WIDEST tracking the animation passes through', () => {
  const kfAt = LIVE.indexOf('@keyframes welSettle');
  assert.ok(kfAt > 0, 'welSettle anchor is stale');
  const kf = LIVE.slice(kfAt, LIVE.indexOf('}', LIVE.indexOf('to', kfAt)) + 1);
  const start = Number((kf.match(/letter-spacing:\s*([\d.]+)em/) || [])[1]);
  assert.ok(start > 0, 'the animation must still start from a wide tracking');

  // ⚠ END ANCHOR MUST EXIST IN `LIVE`. The first draft ended the slice at a
  // COMMENT ("/* both settle IN"), which LIVE strips — indexOf returned -1 and
  // the slice ran to the end of the file (311,030 chars). Anchor on real CSS.
  const ruleAt = LIVE.indexOf('.wel-kicker, .wel-title {');
  assert.ok(ruleAt > 0, 'the shared title/kicker rule is missing');
  const css = LIVE.slice(ruleAt, LIVE.indexOf('.wel-title', ruleAt + 30));
  assert.ok(css.length > 80 && css.length < 1200, 'slice suspicious: ' + css.length);
  assert.ok(/white-space:\s*nowrap/.test(css),
    'without nowrap the title wraps at the wide end of the animation');

  // Stage is min(92vw, 92vh) = 92vmin; the title must fit INSIDE it at `start`.
  // ⚠ the SIZE lives on `.wel-title`, a different rule from the shared one that
  // carries nowrap — read each from its own rule rather than one slice.
  const titleAt = LIVE.indexOf('.wel-title  {');
  assert.ok(titleAt > 0, 'the .wel-title rule is missing');
  const titleCss = LIVE.slice(titleAt, LIVE.indexOf('}', titleAt) + 1);
  assert.ok(titleCss.length > 40 && titleCss.length < 400, 'slice suspicious: ' + titleCss.length);
  const sizeVmin = Number((titleCss.match(/font-size:\s*min\(([\d.]+)vmin/) || [])[1]);
  assert.ok(sizeVmin, 'the title must be sized in vmin against the 92vmin stage');
  /**
   * ⚠ THE RUN IS MIXED NOW — the lockup glyph occupies the O's advance, so k is
   * "sum of the other twelve + the mark's advance + tracking x 13". Measured
   * from the FONT FILES for both trial faces at the animation's WIDEST tracking:
   *     Montserrat 700 @0.7em = 17.829     Archivo Expanded @0.7em = 20.286
   * The WIDER face governs, exactly as the fallback face does on the login page:
   * whichever one renders, it has to fit.
   */
  const kAtStart = 20.286;
  assert.ok(sizeVmin * kAtStart <= 92,
    'at the START of the animation the title is ' + (sizeVmin * kAtStart).toFixed(1)
    + 'vmin wide against a 92vmin stage — it will wrap and then snap. Size from '
    + 'the WIDEST tracking (' + start + 'em, k=' + kAtStart.toFixed(2) + '), not the resting one');
});

test('⚠ only welSettle animates a layout property — the others cannot reflow', () => {
  // ⚠ SCOPE THIS TO THE @keyframes BLOCKS ONLY. The first draft sliced the whole
  // CSS region between two anchors, which swept up the .wel-title and
  // .wel-kicker RULES and flagged their static `font-size` as an animated
  // property. A static declaration is not a reflow mid-flight; only what a
  // keyframe interpolates is.
  const blocks = [];
  const re = /@keyframes\s+wel\w+\s*\{/g;
  let m;
  while ((m = re.exec(LIVE))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < LIVE.length && depth > 0) { if (LIVE[i] === '{') depth++; else if (LIVE[i] === '}') depth--; i++; }
    blocks.push(LIVE.slice(m.index, i));
  }
  assert.ok(blocks.length >= 6, 'expected the welcome keyframes, found ' + blocks.length);
  const block = blocks.join('\n');
  // Anything that changes a box mid-flight is a reflow candidate.
  const REFLOWING = /(font-size|padding|margin|width|height|letter-spacing|word-spacing)\s*:/g;
  const found = block.match(REFLOWING) || [];
  const letterSpacingOnly = found.every((f) => /letter-spacing/.test(f));
  assert.ok(letterSpacingOnly,
    'a NEW layout-affecting property is animated in the welcome sequence: '
    + found.filter((f) => !/letter-spacing/.test(f)).join(', ')
    + ' — re-check that its constraint holds at every value it passes through');
});
