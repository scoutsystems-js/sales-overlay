/** The fresh-login Core Takeover sequence must remain a decoration, never a gate. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LOGIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');
const LIVE = HTML.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const configStart = LIVE.indexOf('WELCOME_TIMING = {');
const CONFIG = LIVE.slice(configStart, LIVE.indexOf('};', configStart));
const timing = (key) => Number(CONFIG.match(new RegExp(key + ':\\s*(\\d+)'))[1]);

test('fresh-login marker is set only after a password submission', () => {
  const at = LOGIN.indexOf("sessionStorage.setItem('scout_welcome_v1'");
  assert.ok(at > 0, 'fresh-login marker is missing');
  assert.ok(LOGIN.lastIndexOf('async function handleSubmit', at) > LOGIN.lastIndexOf('async function checkExistingSession', at));
  assert.ok(!/function redirectByRole[\s\S]{0,900}scout_welcome_v1/.test(LOGIN));
});

test('marker is read and cleared before the overlay can mount', () => {
  const at = LIVE.indexOf('function playWelcomeIfFresh');
  const body = LIVE.slice(at, LIVE.indexOf('document.body.appendChild', at));
  assert.ok(body.indexOf('getItem(WELCOME_KEY)') >= 0);
  assert.ok(body.indexOf('removeItem(WELCOME_KEY)') > body.indexOf('getItem(WELCOME_KEY)'));
});

test('Core Takeover has the approved HUD, reactor, loaded status, and expanding reveal', () => {
  const at = LIVE.indexOf('function welcomeOverlayHtml');
  const renderer = LIVE.slice(at, LIVE.indexOf('function welcomeDismiss', at));
  ['wel-hud', 'wel-reactor', 'SCOUT SYSTEMS LOADED', 'wel-takeover'].forEach((part) => assert.ok(renderer.includes(part), part));
});

test('all motion timing comes from one configuration object', () => {
  ['hudIn','lineIn','lineAt','orbitIn','orbitA','orbitB','orbitC','bracketIn','bracketAt','readoutIn','readoutLeftAt','readoutRightAt','scanIn','scanAt','targetIn','targetA','targetB','targetC','targetOut','targetOutAt','threadIn','threadAt','apertureIn','apertureAt','apertureOut','apertureOutAt','apertureShutter','apertureShutterAt','hudFade','hudOut','reactorAt','reactorIn','rotorAt','rotor','loadedAt','loadedIn','loadedOut','takeoverAt','takeoverIn','reactorOut','flashIn','flashAt','hold','swipe','drift','slowSpin','watchdog'].forEach((key) => assert.ok(new RegExp(key + ':\\s*\\d+').test(CONFIG), key));
  const cssStart = LIVE.indexOf('.wel {');
  const css = LIVE.slice(cssStart, LIVE.indexOf('.objdrill-controls', cssStart));
  assert.deepStrictEqual(css.match(/animation:[^;]*?\b\d+m?s\b/g) || [], [], 'CSS may only use timing variables');
  assert.ok(/Object\.keys\(T\)/.test(LIVE), 'configuration must be pushed to CSS programmatically');
});

test('the watchdog outlasts the visual sequence', () => {
  const maximum = timing('takeoverAt') + timing('takeoverIn') + timing('swipe');
  assert.ok(timing('watchdog') > maximum, 'watchdog must outlast all normal paths');
  assert.ok(timing('watchdog') < 12000, 'watchdog must still be short');
});

test('the visual reveal never waits for dashboard data', () => {
  const at = LIVE.indexOf('var runFor = reduced');
  const end = LIVE.indexOf('setTimeout(function () { welcomeDismiss(node, true); cleanup(); }, T.watchdog);', at);
  const body = LIVE.slice(at, end);
  assert.match(body, /takeoverAt \+ T\.takeoverIn/);
  assert.match(body, /welcomeDismiss\(node\)/);
  assert.doesNotMatch(body, /welcomeDashboardReady|await|holdCap|holdPoll/);
});

test('Core Takeover restores the scan, target locks, aperture, and reactor scale from the approved mock', () => {
  const at = LIVE.indexOf('function welcomeOverlayHtml');
  const renderer = LIVE.slice(at, LIVE.indexOf('function welcomeDismiss', at));
  ['wel-readout', 'wel-scan', 'wel-target-a', 'wel-thread', 'wel-aperture', 'wel-flash'].forEach((part) => assert.ok(renderer.includes(part), part));
  const css = LIVE.slice(LIVE.indexOf('.wel {'), LIVE.indexOf('.objdrill-controls'));
  assert.match(css, /width: min\(27vw,330px\)/);
  assert.match(css, /welBackdropReveal/);
});

test('skip is immediate and dismissal is idempotent', () => {
  const at = LIVE.indexOf('function welcomeDismiss');
  const dismissal = LIVE.slice(at, LIVE.indexOf('function welUncover', at));
  assert.match(dismissal, /_welGone/);
  assert.match(dismissal, /node\.style\.display = 'none'/);
  assert.match(LIVE, /var skip = function \(\) \{ welcomeDismiss\(node, true\)/);
  assert.match(LIVE, /node\.addEventListener\('click', skip\)/);
  assert.match(LIVE, /window\.addEventListener\('keydown', onKey\)/);
});

test('reduced motion removes all visor motion and the ceremony still dismisses', () => {
  const at = LIVE.indexOf('@media (prefers-reduced-motion: reduce)');
  const css = LIVE.slice(at, LIVE.indexOf('.objdrill-controls', at));
  assert.match(css, /animation: none !important/);
  assert.match(css, /\.wel-reactor, \.wel-takeover, \.wel-loaded \{ display: none/);
  assert.match(LIVE, /reduced\s*\? T\.hold/);
});

test('the visor uses Scout color tokens and no external render dependency', () => {
  const cssStart = LIVE.indexOf('.wel {');
  const css = LIVE.slice(cssStart, LIVE.indexOf('.objdrill-controls', cssStart));
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /rgba\(var\(--accent-rgb\)/);
  const at = LIVE.indexOf('function welcomeOverlayHtml');
  const renderer = LIVE.slice(at, LIVE.indexOf('function welcomeDismiss', at));
  assert.doesNotMatch(renderer, /fetch\(|import |require\(|<img|url\(/);
});

test('welcome mounts before dashboard network work and after OAuth popup returns', () => {
  const init = LIVE.indexOf('async function init()');
  const call = LIVE.indexOf('playWelcomeIfFresh();', init);
  assert.ok(call < LIVE.indexOf('await refreshSessionIfNeeded()', init));
  assert.ok(call < LIVE.indexOf('await fetchMe()', init));
  assert.ok(LIVE.indexOf('window.close();', init) < call);
  assert.match(LIVE.slice(init, call + 60), /try \{ playWelcomeIfFresh\(\); \} catch/);
});
