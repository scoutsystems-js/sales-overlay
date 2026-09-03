'use strict';
/**
 * ⚠⚠ THE OUTSIDE PAGES SHARE THE PRODUCT'S TOKENS (D-7, Justin 2026-09-03, H688).
 * /css/style.css is what admin, set-password, connect, the connected screen,
 * coaching, support and docs render through; index is self-contained by ruling.
 * Its values are EXECUTED against the dashboard's :root here — the same shape as
 * every other mirror — so a token drifting on one side fails, and every page
 * that should carry the shared face is checked for it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./helpers/strip-comments');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
function tokens(css) {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(root, ':root block found');
  const out = {};
  for (const m of root[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const DASH = tokens(stripComments(read('dashboard.html')));
const SHARED = tokens(stripComments(read('css/style.css')));

test('⚠⚠ every token the shared stylesheet declares with a dashboard name carries the dashboard value', () => {
  const names = ['--fs-display', '--fs-number', '--fs-title', '--fs-body', '--fs-secondary', '--fs-label', '--fs-eyebrow', '--fs-gauge-value', '--fs-company',
    '--fw-display', '--fw-normal', '--fw-emphasis', '--bg', '--bg-elevated', '--bg-field', '--border', '--border-strong', '--text',
    '--good', '--mid', '--bad', '--wordmark-glow', '--radius-sm', '--radius', '--radius-lg', '--edge-white', '--green', '--green-dark'];
  const drift = names.filter((n) => SHARED[n] === undefined || DASH[n] === undefined || SHARED[n] !== DASH[n]).map((n) => n + ': shared=' + SHARED[n] + ' dashboard=' + DASH[n]);
  assert.ok(names.length >= 23, 'floor');
  assert.strictEqual(SHARED['--green'], DASH['--accent'], 'the shared file\'s --green IS the dashboard\'s --accent (the shared file declares no --accent, by ruling)');
  assert.deepStrictEqual(drift, [], 'token drift:\n' + drift.join('\n'));
  assert.strictEqual(SHARED['--bg2'], DASH['--bg-elevated'], '--bg2 is the elevated surface'); assert.strictEqual(SHARED['--bg3'], DASH['--bg-field'], '--bg3 is the field surface');
});

test('⚠⚠ the shared face is Saira, self-hosted from the same file the dashboard loads', () => {
  const css = stripComments(read('css/style.css'));
  assert.ok(/--font:\s*'Saira'/.test(css), '--font leads with Saira');
  assert.ok(/@font-face\s*\{[^}]*font-family:\s*'Saira'[^}]*saira-variable-latin\.woff2/.test(css), 'the @font-face points at /fonts/saira-variable-latin.woff2');
  assert.ok(/button, input, select, textarea \{ font: inherit; color: inherit; \}/.test(css), 'controls inherit by capability here too');
});

test('⚠ index inlines the scale (self-contained by ruling) — its values are the dashboard\'s', () => {
  const IDX = tokens(stripComments(read('index.html')));
  const names = ['--fs-display', '--fs-number', '--fs-title', '--fs-body', '--fs-secondary', '--fs-label', '--fs-eyebrow', '--fw-display', '--fw-normal', '--fw-emphasis', '--radius-sm', '--radius', '--radius-lg', '--bg', '--bg-elevated', '--border', '--text'];
  const drift = names.filter((n) => IDX[n] !== DASH[n]).map((n) => n + ': index=' + IDX[n] + ' dashboard=' + DASH[n]);
  assert.strictEqual(IDX['--good'], DASH['--accent'], 'index spells its accent as var(--good); --good must be the dashboard accent');
  assert.deepStrictEqual(drift, [], 'index token drift:\n' + drift.join('\n'));
});

test('⚠ every outside page renders through the shared face — linked, or (index) declared inline — and none names the system stack as its font', () => {
  const linked = ['admin.html', 'set-password.html', 'connect.html', 'connected.html', 'coaching.html', 'support.html', 'docs.html'];
  for (const f of linked) assert.ok(/<link rel="stylesheet" href="\/css\/style\.css"\/>/.test(read(f)), f + ' links /css/style.css');
  const idx = stripComments(read('index.html'));
  assert.ok(/--font:\s*'Saira'/.test(idx) && /@font-face[^}]*Saira/.test(idx), 'index declares Saira inline (self-contained by ruling)');
  for (const f of linked.concat(['index.html', 'login.html'])) {
    const src = stripComments(read(f));
    const bad = [...src.matchAll(/--font:\s*([^;]+);/g)].map((m) => m[1]).filter((v) => !/Saira/.test(v));
    assert.deepStrictEqual(bad, [], f + ' declares a non-Saira --font: ' + bad.join(' | '));
  }
});

test('⚠ the six pages carry no literal size, weight or radius in their own stylesheet — tokens only (a ratchet at zero)', () => {
  for (const f of ['admin.html', 'set-password.html', 'connect.html', 'connected.html', 'support.html', 'docs.html', 'index.html']) {
    const src = read(f); const a = src.indexOf('<style>'); const b = src.indexOf('</style>', a);
    const css = stripComments(src.slice(a, b));
    const lit = [...css.matchAll(/(font-size|font-weight|border-radius):\s*(\d[\d.]*)(px)?\b/g)].map((m) => m[0]).filter((x) => !/border-radius:\s*(999|99|50|0\b)/.test(x));   /* pills and a genuine zero are not scale values */
    assert.deepStrictEqual(lit, [], f + ' literal declarations: ' + lit.join(', '));
  }
});
