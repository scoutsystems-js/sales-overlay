'use strict';
/**
 * ⚠⚠ THE BACKGROUND SWITCH (Justin, 2026-09-03, H688): top bar between Admin and My
 * Account; "Background" is the label; a SQUARE whose fill is the state — Scout green
 * ON, black OFF — with a 1px WHITE edge ALWAYS (--edge-white, the product's one white,
 * promoted from the rep card). The two states differ by fill alone. One setting, two
 * doors: the Account checkbox calls the same setter, and the setter syncs both.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

test('the switch sits between Admin and My Account, is a real switch, and names what it toggles', () => {
  const admin = LIVE.indexOf('id="adminLink"'), sw = LIVE.indexOf('id="bgSwitch"'), acct = LIVE.indexOf('id="signedInEmail"');
  assert.ok(admin !== -1 && sw !== -1 && acct !== -1, 'all three present');
  assert.ok(admin < sw && sw < acct, 'order: Admin, switch, My Account');
  const tag = LIVE.slice(LIVE.lastIndexOf('<button', sw), LIVE.indexOf('</button>', sw));
  assert.ok(/role="switch"/.test(tag) && /aria-checked=/.test(tag) && /aria-label="Background artwork"/.test(tag), 'role, state and an accessible name');
  assert.ok(/>Background</.test(tag), 'the visible label is Justin\'s word');
  assert.ok(/onclick="toggleBackground\(\)"/.test(tag), 'it toggles');
});

test('⚠⚠ EXECUTED: one setter drives both doors — the top-bar switch and the Account checkbox never disagree', () => {
  const src = ['backgroundIsOff', 'setBackgroundOff', 'syncBackgroundControls', 'toggleBackground'].map((n) => fnBody(LIVE, n)).join('\n');
  const store = {}; const attrs = {};
  const sw = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; const cb = { checked: null };
  const fn = new Function('localStorage', 'document', src + '\nreturn { toggle: toggleBackground, set: setBackgroundOff, isOff: backgroundIsOff };');
  const api = fn({ getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } }, getElementById: (id) => (id === 'bgSwitch' ? sw : id === 'acctBgOff' ? cb : null) });
  api.toggle();
  assert.strictEqual(api.isOff(), true, 'toggled off'); assert.strictEqual(sw.attrs['aria-checked'], 'false', 'the switch says off'); assert.strictEqual(cb.checked, true, 'the checkbox says off too'); assert.strictEqual(attrs['data-bg'], 'off');
  api.set(false);   /* the Account door */
  assert.strictEqual(sw.attrs['aria-checked'], 'true', 'the switch followed the checkbox'); assert.strictEqual(cb.checked, false); assert.ok(!('data-bg' in attrs));
});

const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length);
const NAV = HTML.slice(HTML.indexOf('<nav class="top-bar">'), HTML.indexOf('</nav>', HTML.indexOf('<nav class="top-bar">')) + 6);
const PROBE = `(() => { const b = document.querySelector('.bg-switch-box'); const s = document.getElementById('bgSwitch'); const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); const bar = document.querySelector('.top-bar').getBoundingClientRect();
  return { edge: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, fill: cs.backgroundColor, radius: cs.borderTopLeftRadius, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), barH: Math.round(bar.height), font: getComputedStyle(s).fontFamily }; })()`;
function page(on) {
  const nav = on ? NAV : NAV.replace('aria-checked="true"', 'aria-checked="false"');
  return '<!doctype html><html><head>' + STYLE + '</head><body data-view="overview">' + nav + '</body></html>';
}
test('⚠⚠ RENDERED: white 1px edge in BOTH states, green fill on, black fill off, square, and nothing moves between states', () => {
  const on = renderComputed(page(true), PROBE), off = renderComputed(page(false), PROBE);
  for (const [name, st] of [['on', on], ['off', off]]) {
    assert.strictEqual(st.edge, '1px solid rgb(255, 255, 255)', name + ': the white edge is always there, got ' + st.edge);
    assert.strictEqual(st.radius, '0px', name + ': square'); assert.strictEqual(st.w, st.h, name + ': square (' + st.w + 'x' + st.h + ')');
    assert.ok(/Saira/.test(st.font), name + ': the label is in the product face');
  }
  assert.strictEqual(on.fill, 'rgb(9, 224, 70)', 'on = Scout green'); assert.strictEqual(off.fill, 'rgb(0, 0, 0)', 'off = black');
  assert.deepStrictEqual([on.x, on.y, on.w, on.h, on.barH], [off.x, off.y, off.w, off.h, off.barH], 'the fill change moves nothing — same box, same bar');
  /* the 51px bar itself is a live measurement (the wordmark image sizes it; offline it has no image) — see H688 */
});
