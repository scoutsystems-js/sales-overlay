'use strict';
/**
 * ⚠⚠ THE BACKGROUND TOGGLE (Justin, 2026-09-03 — the redesign, H696; the square it replaces was
 * H688). To the RIGHT of My Account; a black pill track with a 1px WHITE edge in both states
 * (--edge-white, the product's one white); a knob that SLIDES with the mesh glyph riding it —
 * accent when the artwork is ON, dimmed when OFF; NO text label (the glyph names the control);
 * still role="switch" with an accessible name; the Account checkbox stays in step through the
 * one setter. Rendered under the real stylesheet and nav markup with the vectors inlined.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');

const WEB = path.join(__dirname, '..', 'web');
const HTML = fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

test('the toggle sits to the RIGHT of My Account, carries no text, and names what it toggles', () => {
  const admin = LIVE.indexOf('id="adminLink"'), acct = LIVE.indexOf('id="signedInEmail"'), sw = LIVE.indexOf('id="bgSwitch"');
  assert.ok(admin !== -1 && acct !== -1 && sw !== -1, 'all three present');
  assert.ok(admin < acct && acct < sw, 'order: Admin, My Account, the toggle — at the far edge');
  const tag = LIVE.slice(LIVE.lastIndexOf('<button', sw), LIVE.indexOf('</button>', sw));
  assert.ok(/role="switch"/.test(tag) && /aria-checked=/.test(tag) && /aria-label="Background artwork"/.test(tag), 'role, state and an accessible name');
  assert.ok(/onclick="toggleBackground\(\)"/.test(tag), 'it toggles');
  const text = tag.slice(tag.indexOf('>') + 1).replace(/<[^>]+>/g, '').trim();
  assert.strictEqual(text, '', 'no visible text label — the glyph is the label');
  assert.ok(/bg-switch-track/.test(tag) && /bg-switch-knob/.test(tag) && /bg-switch-glyph/.test(tag), 'track, knob, glyph — one object');
  assert.ok(!/bg-switch-label|bg-switch-box/.test(LIVE), 'the square and its label are gone');
});

test('⚠⚠ EXECUTED: one setter drives both doors — the toggle and the Account checkbox never disagree', () => {
  const src = ['backgroundIsOff', 'setBackgroundOff', 'syncBackgroundControls', 'toggleBackground'].map((n) => fnBody(LIVE, n)).join('\n');
  const store = {}; const attrs = {};
  const sw = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; const cb = { checked: null };
  const fn = new Function('localStorage', 'document', src + '\nreturn { toggle: toggleBackground, set: setBackgroundOff, isOff: backgroundIsOff };');
  const api = fn({ getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } }, getElementById: (id) => (id === 'bgSwitch' ? sw : id === 'acctBgOff' ? cb : null) });
  api.toggle();
  assert.strictEqual(api.isOff(), true); assert.strictEqual(sw.attrs['aria-checked'], 'false', 'the toggle says off'); assert.strictEqual(cb.checked, true, 'the checkbox says off too'); assert.strictEqual(attrs['data-bg'], 'off');
  api.set(false);
  assert.strictEqual(sw.attrs['aria-checked'], 'true', 'the toggle followed the checkbox'); assert.strictEqual(cb.checked, false); assert.ok(!('data-bg' in attrs));
});

const WM = fs.readFileSync(path.join(WEB, 'scout-wordmark.svg')); const GL = fs.readFileSync(path.join(WEB, 'scout-glyph.svg'));
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length).split('url(/scout-glyph.svg)').join('url(data:image/svg+xml;base64,' + GL.toString('base64') + ')');
const NAV = HTML.slice(HTML.indexOf('<nav class="top-bar">'), HTML.indexOf('</nav>', HTML.indexOf('<nav class="top-bar">')) + 6).replace('src="/scout-wordmark.svg"', 'src="data:image/svg+xml;base64,' + WM.toString('base64') + '"');
const PROBE = `(() => { const s = document.getElementById('bgSwitch'); const t = s.querySelector('.bg-switch-track'), k = s.querySelector('.bg-switch-knob'), g = s.querySelector('.bg-switch-glyph');
  const ct = getComputedStyle(t), ck = getComputedStyle(k), cg = getComputedStyle(g); const r = t.getBoundingClientRect(), kr = k.getBoundingClientRect(), gr = g.getBoundingClientRect();
  const bar = document.querySelector('.top-bar').getBoundingClientRect(); const mark = document.querySelector('.brand-wordmark').getBoundingClientRect(); const acct = document.getElementById('signedInEmail').getBoundingClientRect();
  return { edge: ct.borderTopWidth + ' ' + ct.borderTopStyle + ' ' + ct.borderTopColor, trackFill: ct.backgroundColor, radius: ct.borderTopLeftRadius, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    knobX: Math.round(kr.left - r.left), knobW: Math.round(kr.width), glyphFill: cg.backgroundColor, glyphOpacity: cg.opacity, glyphH: Math.round(gr.height), masked: /svg/.test(cg.webkitMaskImage || cg.maskImage || ''),
    barH: Math.round(bar.height), markRight: Math.round(mark.right), acctLeft: Math.round(acct.left), acctRight: Math.round(acct.right), text: s.textContent.trim() }; })()`;
function page(on) { return '<!doctype html><html><head>' + STYLE + '</head><body data-view="overview">' + (on ? NAV : NAV.replace('aria-checked="true"', 'aria-checked="false"')) + '</body></html>'; }

test('⚠⚠ RENDERED: white edge in BOTH states on a black track that never changes, the knob SLIDES, the glyph goes accent/dim, and nothing else in the bar moves', () => {
  const on = renderComputed(page(true), PROBE), off = renderComputed(page(false), PROBE);
  for (const [name, st] of [['on', on], ['off', off]]) {
    assert.strictEqual(st.edge, '1px solid rgb(255, 255, 255)', name + ': the white edge is always there');
    assert.strictEqual(st.trackFill, 'rgb(0, 0, 0)', name + ': the track stays black'); assert.strictEqual(st.radius, '999px', name + ': a pill track');
    assert.ok(st.masked, name + ': the glyph is the vector, masked'); assert.ok(st.glyphH >= 15, name + ': the glyph is knob-sized (' + st.glyphH + 'px)'); assert.strictEqual(st.text, '', name + ': no text');
  }
  assert.strictEqual(on.glyphFill, 'rgb(9, 224, 70)', 'on: the glyph is Scout green'); assert.strictEqual(on.glyphOpacity, '1');
  assert.strictEqual(off.glyphFill, 'rgb(237, 237, 237)', 'off: the glyph is the text white, dimmed'); assert.ok(+off.glyphOpacity < 0.6, 'off: dimmed (' + off.glyphOpacity + ')');
  assert.ok(on.knobX - off.knobX >= 16, 'the knob travels: on at ' + on.knobX + ', off at ' + off.knobX);
  assert.deepStrictEqual(on.box, off.box, 'the control\'s own box is identical in both states');
  assert.deepStrictEqual([on.barH, on.markRight, on.acctLeft, on.acctRight], [off.barH, off.markRight, off.acctLeft, off.acctRight], 'the bar, the wordmark and My Account do not move between states');
  assert.ok(on.box[0] > on.acctRight, 'the toggle sits to the right of My Account');
});
