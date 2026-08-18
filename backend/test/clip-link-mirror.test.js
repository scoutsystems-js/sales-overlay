/**
 * (p) — the clip link, and what it is called.
 *
 * ⚠ A CLIP IS A DEEP LINK, NOT A FILE. `recording_url + ?t=seconds`, opening the
 * provider's own player. Nothing is cut, stored or hosted by us.
 *
 * ⚠ THE LABEL IS PROVIDER-DEPENDENT and that is the substance of this item:
 *   Fathom — `?t=` seeks (their documented format)     → "Clip"
 *   Zoom   — share links carry NO timestamp param      → "Open Recording"
 * Calling the Zoom one a clip promises a moment and delivers 00:00.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../lib/clip-link');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the label follows the provider, and an unknown provider is treated as Zoom', () => {
  assert.strictEqual(C.clipLabel('fathom'), 'Clip');
  assert.strictEqual(C.clipLabel('FATHOM'), 'Clip');
  assert.strictEqual(C.clipLabel('zoom'), 'Open Recording');
  // ⚠ Unknown → the CAUTIOUS label. Claiming a seek we cannot deliver is the
  // failure mode; claiming less than we deliver is merely modest.
  [null, undefined, '', 'meet', 'whatever'].forEach(function (x) {
    assert.strictEqual(C.clipLabel(x), 'Open Recording', String(x));
  });
});

test('⚠ NO LINK WHERE THERE IS NOTHING TO OPEN — null, never a disabled button', () => {
  assert.strictEqual(C.clipHref(null, 12), null);
  assert.strictEqual(C.clipHref('', 12), null);
  assert.strictEqual(C.clipHref('https://x/1', null), null);
  assert.strictEqual(C.clipHref('https://x/1', undefined), null);
  assert.strictEqual(C.clipHref('https://x/1', NaN), null);
});

test('the href appends t= correctly whether or not a query already exists', () => {
  assert.strictEqual(C.clipHref('https://fathom.video/calls/1', 95), 'https://fathom.video/calls/1?t=95');
  assert.strictEqual(C.clipHref('https://x/1?a=b', 95), 'https://x/1?a=b&t=95');
  assert.strictEqual(C.clipHref('https://x/1', 95.7), 'https://x/1?t=96', 'rounded');
  assert.strictEqual(C.clipHref('https://x/1', -5), 'https://x/1?t=0', 'never negative');
});

test('the inline copy in the page agrees with the module', () => {
  const at = LIVE.indexOf('function clipLabelFor');
  assert.ok(at !== -1, 'the page must carry the label rule');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(src.length > 60 && src.length < 800, 'slice must cover it: ' + src.length);
  const fn = new Function(src + '; return clipLabelFor;')();
  ['fathom', 'zoom', null, 'meet'].forEach(function (p) {
    assert.strictEqual(fn(p), C.clipLabel(p), String(p));
  });
});

test('the 12b card renders a clip link, and omits it when there is none', () => {
  const at = LIVE.indexOf('function clipLinkHtml');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4);
  assert.ok(/if \(!m\.clip_url\) return '';/.test(src),
    'no clip_url must render NOTHING — not a disabled control');
  assert.ok(/clipLabelFor\(m\.source\)/.test(src), 'the label must come from the provider');
  assert.ok(/event\.stopPropagation\(\)/.test(src),
    'the card itself opens the drilldown, so the link must not trigger it too');
  const moment = LIVE.slice(LIVE.indexOf('function sectionRankMomentHtml'), LIVE.indexOf('function sectionRankCardHtml'));
  assert.ok(/clipLinkHtml\(m\)/.test(moment), 'the moment row must actually call it');
});

test('the route sends the provider with each moment', () => {
  const me = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8');
  assert.ok(/source: \(meta\[m\.fathom_call_id\] \|\| \{\}\)\.source \|\| null/.test(me),
    'without source the label cannot differ by provider');
  assert.ok(/select\('id, title, call_date, recording_url, source'\)/.test(me),
    'and source has to be selected in the first place');
});

test('clip labels are Title Case, per the standing rule', () => {
  assert.strictEqual((LIVE.match(/▶ clip</g) || []).length, 0, 'lowercase "clip" labels remain');
  assert.ok((LIVE.match(/▶ Clip</g) || []).length >= 5, 'the existing surfaces keep their links');
});
