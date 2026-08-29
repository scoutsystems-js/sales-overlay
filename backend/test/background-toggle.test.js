/**
 * SETTINGS TOGGLE — turn the background artwork off. Per USER (the 2026-08-20
 * ruling: this kind of customisation is per person and needs no org entity).
 *
 * ⚠⚠ THE STORED VALUE IS THE DEVIATION ('off'), NEVER THE DEFAULT — the same
 * asymmetry as Customize View's hidden set. Storing "on" would leave anyone
 * with empty storage (a new browser, a private window, a cleared cache) with no
 * background and no idea a setting existed. It must fail toward the shipped
 * design, not away from it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = RAW.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function grab(name) {
  const at = LIVE.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' is missing — anchor stale');
  let depth = 0, started = false, i = at;
  for (; i < LIVE.length; i++) {
    const c = LIVE[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
  }
  const src = LIVE.slice(at, i);
  assert.ok(src.length > 60, 'slice too short for ' + name + ': ' + src.length);
  return src;
}

function api(stored) {
  const store = {};
  if (stored !== undefined) store['scout_bg_v1'] = stored;
  const doc = {
    documentElement: {
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
    },
  };
  const fn = new Function('localStorage', 'document',
    grab('backgroundIsOff') + '\n' + grab('setBackgroundOff') +
    '\nreturn { isOff: backgroundIsOff, set: setBackgroundOff, attrs: document.documentElement.attrs, store: store0 };'
      .replace('store0', 'null'));
  const out = fn({
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; },
  }, doc);
  out.raw = store;
  out.attrs = doc.documentElement.attrs;
  return out;
}

test('the default is ON — empty storage means the background renders', () => {
  const a = api();
  assert.strictEqual(a.isOff(), false);
  assert.deepStrictEqual(a.raw, {}, 'nothing is written unless the user opts out');
});

test('⚠⚠ only the DEVIATION is stored, and turning it back on REMOVES the key', () => {
  const a = api();
  a.set(true);
  assert.strictEqual(a.raw['scout_bg_v1'], 'off');
  assert.strictEqual(a.isOff(), true);
  a.set(false);
  assert.ok(!('scout_bg_v1' in a.raw), 'back to the default must leave no key behind');
});

test('the attribute is applied immediately, so it is visibly a setting', () => {
  const a = api();
  a.set(true);
  assert.strictEqual(a.attrs['data-bg'], 'off');
  a.set(false);
  assert.ok(!('data-bg' in a.attrs), 'and removed again');
});

test('unreadable storage means the DEFAULT, never a crash', () => {
  const boom = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('nope'); }, removeItem() { throw new Error('nope'); } };
  const doc = { documentElement: { attrs: {}, setAttribute() {}, removeAttribute() {} } };
  const fn = new Function('localStorage', 'document',
    grab('backgroundIsOff') + '\n' + grab('setBackgroundOff') + '\nreturn { isOff: backgroundIsOff, set: setBackgroundOff };');
  const a = fn(boom, doc);
  assert.strictEqual(a.isOff(), false, 'a throwing read must fall back to the default');
  assert.doesNotThrow(() => a.set(true), 'a throwing write must not break the toggle');
});

/* ── it has to actually reach the page ─────────────────────────────────── */

test('⚠ the preference is applied BEFORE FIRST PAINT, not after boot', () => {
  /* Setting it after boot would paint the background and then remove it, which
     is worse than never offering the setting. Same shape as the welcome cover. */
  const head = RAW.slice(0, RAW.indexOf('<style>'));
  assert.ok(/localStorage\.getItem\('scout_bg_v1'\) === 'off'/.test(head),
    'the pre-paint head script must read the preference');
  assert.ok(/setAttribute\('data-bg', 'off'\)/.test(head), 'and set the attribute there');
});

test('the CSS rule exists and switches the layer off entirely', () => {
  assert.ok(/html\[data-bg="off"\] body\[data-view\]::before \{ display: none; \}/.test(LIVE),
    'display:none, so the layer costs nothing when off');
});

test('the control is on the account page and calls the setter', () => {
  assert.ok(/<h2>Display<\/h2>/.test(LIVE), 'a Display section must exist');
  assert.ok(/id="acctBgOff"/.test(LIVE) && /onchange="setBackgroundOff\(this\.checked\)"/.test(LIVE),
    'the checkbox must be wired to the setter');
  assert.ok(/backgroundIsOff\(\)/.test(LIVE), 'and reflect the current value');
});
