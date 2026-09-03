'use strict';
/**
 * ⚠⚠ THE WORDMARK IS A VECTOR — ONE ASSET ON FOUR SURFACES, THE NAV CAP UNCHANGED, THE GLYPH
 * AS THE FAVICON (Justin's ruling, 2026-09-03, H695).
 *
 * The nav guard is on the RENDERED CAP HEIGHT, not on the `height` value: a guard pinned to
 * 25.71px dies the moment the viewBox is trimmed; the cap survives both routes. It renders the
 * page's real stylesheet and nav markup in Chromium with the repo's SVG inlined, rasterises the
 * <img> at 8× its rendered size, and reads the letters' cap back.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderComputed } = require('./helpers/electron-render');
const { stripComments } = require('./helpers/strip-comments');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const SVG = read('scout-wordmark.svg'), GLYPH = read('scout-glyph.svg');

test('⚠ the repo carries the METADATA-STRIPPED outlines — one path, the token fill, no manifest, small', () => {
  for (const [name, s, max] of [['wordmark', SVG, 10000], ['glyph', GLYPH, 3100]]) {
    assert.strictEqual((s.match(/<path\b/g) || []).length, 1, name + ': one path');
    assert.ok(!/<metadata\b|c2pa/.test(s), name + ': no metadata manifest');
    assert.ok(!/<text\b|<image\b/.test(s), name + ': outlines only');
    assert.ok(/fill="#09E046"/i.test(s), name + ': the token fill');
    assert.ok(Buffer.byteLength(s) <= max, name + ': ' + Buffer.byteLength(s) + ' bytes, cap ' + max);
  }
});

test('⚠⚠ all four surfaces load the ONE vector with its intrinsic size, and nothing loads the retired PNG', () => {
  const dash = read('dashboard.html');
  const four = [['nav', dash, /<img class="brand-wordmark" src="\/scout-wordmark\.svg" alt="Scout Systems" width="1090" height="170">/],
    ['welcome overlay', dash, /<img class="wel-title" src="\/scout-wordmark\.svg" alt="Scout Systems" width="1090" height="170"/],
    ['login', read('login.html'), /<img class="brand-img" src="\/scout-wordmark\.svg"\s+alt="Scout Systems" width="1090" height="170"/],
    ['set-password', read('set-password.html'), /<img class="brand-img" src="\/scout-wordmark\.svg"\s+alt="Scout Systems" width="1090" height="170"/]];
  for (const [name, src, re] of four) assert.ok(re.test(src), name + ' must load the vector at its intrinsic size');
  for (const f of fs.readdirSync(WEB).filter((x) => x.endsWith('.html') && !/archived/.test(x))) assert.ok(!/scout-wordmark\.png/.test(read(f)), f + ' still names the retired PNG');
  assert.ok(!fs.existsSync(path.join(WEB, 'scout-wordmark.png')), 'the PNG is gone');
  // the glow rides on the three surfaces that had it baked in, never the nav
  const css = stripComments(dash);
  assert.ok(/\.wel-title\s*\{[^}]*filter: var\(--wordmark-glow\)/.test(css), 'the overlay carries the glow filter');
  assert.ok(!/\.brand-wordmark\s*\{[^}]*filter/.test(css), 'the nav carries NO glow');
  assert.ok(/filter: var\(--wordmark-glow\)/.test(stripComments(read('login.html'))) && /filter: var\(--wordmark-glow\)/.test(stripComments(read('set-password.html'))), 'login and set-password carry the glow filter');
});

test('⚠ every page links the glyph as its icon (the favicon row)', () => {
  const pages = fs.readdirSync(WEB).filter((x) => x.endsWith('.html') && !/archived/.test(x));
  assert.ok(pages.length >= 12, 'floor: ' + pages.length + ' pages');
  for (const f of pages) assert.ok(/<link rel="icon" type="image\/svg\+xml" href="\/scout-glyph\.svg">/.test(read(f)), f + ' has no favicon link');
});

const DASH = read('dashboard.html');
const STYLE = DASH.slice(DASH.indexOf('<style>'), DASH.indexOf('</style>') + '</style>'.length);
const NAV = DASH.slice(DASH.indexOf('<nav class="top-bar">'), DASH.indexOf('</nav>', DASH.indexOf('<nav class="top-bar">')) + 6)
  .replace('src="/scout-wordmark.svg"', 'src="data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64') + '"');
const PROBE = `(async () => { const img = document.querySelector('.brand-wordmark'); if (!img.complete) await new Promise((r) => { img.onload = r; });
  const r = img.getBoundingClientRect(); const K = 8; const W = Math.round(r.width * K), H = Math.round(r.height * K);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data; const A = (x, y) => d[(y * W + x) * 4 + 3];
  // the letters' cap: rows covered by ink in the FIRST letter column band (the S), which the mark does not touch
  let x0 = 0; while (x0 < W && ![...Array(H).keys()].some((y) => A(x0, y) >= 200)) x0++;
  let x1 = x0; while (x1 < W && [...Array(H).keys()].some((y) => A(x1, y) >= 200)) x1++;
  let top = H, bot = 0; for (let x = x0; x < x1; x++) for (let y = 0; y < H; y++) if (A(x, y) >= 200) { if (y < top) top = y; if (y > bot) bot = y; }
  return { boxW: r.width, boxH: r.height, capCss: (bot - top + 1) / K, filter: getComputedStyle(img).filter }; })()`;

test('⚠⚠ RENDERED: the nav wordmark keeps today\'s cap (12.1px) and width (165px) — measured on the cap, not the height value', () => {
  const page = '<!doctype html><html><head>' + STYLE + '</head><body data-view="overview">' + NAV + '</body></html>';
  const r = renderComputed(page, PROBE);
  assert.ok(Math.abs(r.capCss - 12.1) <= 0.35, 'rendered cap ' + r.capCss + 'px must be 12.1 ± 0.35 (the PNG wordmark\'s)');
  assert.ok(Math.abs(r.boxW - 165) <= 1.5, 'rendered width ' + r.boxW + ' must be 165 ± 1.5');
  assert.strictEqual(r.filter, 'none', 'the nav has no glow');
});
