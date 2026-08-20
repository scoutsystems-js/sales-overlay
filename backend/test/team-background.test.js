/**
 * THE SITE-WIDE RASTER BASE LAYER (Justin, 2026-08-20).
 *
 * ⚠⚠ WHAT CHANGED, AND WHY THIS FILE IS NO LONGER ABOUT "TEAM".
 * The raster used to be a per-view override on `team` alone, with the mesh as
 * the base everywhere else. Justin's rulings: mesh OFF on the dashboard, the
 * raster on EVERY view, FULL BRIGHTNESS, one image one position. So there is
 * now exactly ONE painting rule and this file guards it for all fifteen views.
 *
 * ⚠⚠ THE LOAD-BEARING PROPERTY IS NOT A CONTRAST RATIO — IT IS THAT NO TEXT
 * TOUCHES THE IMAGE. Full brightness is safe BY CONSTRUCTION: every text leaf
 * on every view resolves to an opaque painted ancestor, so there is no
 * contrast equation to solve. That is why `opacity: 1` is assertable at all.
 * The three carded classes below are what make it true, and if any of them
 * loses its fill the property silently dies with no error and no failing
 * render — just text on a photograph. Hence the pins.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'web', 'dashboard.html');
const RAW = fs.readFileSync(HTML_PATH, 'utf8');

/* ⚠ STRIP COMMENTS, LINE COMMENTS FIRST. This codebase archives removed code in
   place, so a raw match reports archived rules as live. And `//` before `/*`
   matters: a `/*` inside a line comment is a FALSE OPENER that can swallow
   hundreds of lines and make a present import look absent. */
const LIVE = RAW.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The single painting rule, extracted with a bounded slice. */
function paintingRule() {
  const at = LIVE.indexOf('body[data-view]::before {');
  assert.ok(at > -1, 'the painting rule must exist');
  const end = LIVE.indexOf('}', at);
  const rule = LIVE.slice(at, end + 1);
  // ⚠ length assertion: a backwards or truncated slice tests an empty string
  // and every negative assertion below would pass vacuously.
  assert.ok(rule.length > 80 && rule.length < 3000,
    'painting-rule slice must cover the rule, got ' + rule.length);
  return rule;
}

test('⚠⚠ EXACTLY ONE rule sets background-image, and it is the raster', () => {
  const rule = paintingRule();
  const imgs = LIVE.match(/body\[data-view[^{]*\{[^}]*background-image[^}]*\}/g) || [];
  assert.strictEqual(imgs.length, 1,
    'a SECOND rule silently supersedes the first — CSS is last-wins and a grep ' +
    'finds the earlier one. Found ' + imgs.length);
  assert.ok(/background-image:\s*url\('\/team-background\.webp'\)/.test(rule),
    'the base rule must paint the raster');
  assert.ok(!/var\(--motif-mesh\)/.test(rule),
    'the mesh must not be the base image any more');
});

test('⚠⚠ EXACTLY ONE background-position and ONE background-size in the rule', () => {
  const rule = paintingRule();
  // ⚠ CARDINALITY, NOT PRESENCE. A duplicate declaration later in the same rule
  // wins, so asserting the right value is PRESENT proves nothing about what
  // RENDERS. This exact defect shipped once: two background-position pairs left
  // the intended one inert and the ink 207px from where it was measured.
  assert.strictEqual((rule.match(/background-position\s*:/g) || []).length, 1,
    'exactly one background-position, or the last one silently wins');
  assert.strictEqual((rule.match(/background-size\s*:/g) || []).length, 1,
    'exactly one background-size');
  assert.ok(/background-size:\s*cover/.test(rule), 'cover');
  assert.ok(/background-position:\s*50%\s+50%/.test(rule), 'centred');
});

test('⚠⚠ ZERO per-view rules — one image, one position (Justin\'s ruling)', () => {
  const perView = LIVE.match(/body\[data-view="[a-z-]+"\]::before/g) || [];
  assert.strictEqual(perView.length, 0,
    'per-page variation is retired; found ' + perView.length + ': ' + perView.join(', '));
  // ⚠ NON-VACUITY — the matcher must be able to find one. Assert it fires
  // against an injected rule, or this test passes on an empty string forever.
  const broken = LIVE + '\nbody[data-view="overview"]::before { background-position: 0% 0%; }';
  assert.strictEqual((broken.match(/body\[data-view="[a-z-]+"\]::before/g) || []).length, 1,
    'non-vacuity: the matcher must detect a reintroduced per-view rule');
});

test('⚠⚠ FULL BRIGHTNESS — opacity 1, and no ceiling variable to drift', () => {
  const rule = paintingRule();
  assert.strictEqual((rule.match(/opacity\s*:/g) || []).length, 1, 'exactly one opacity');
  assert.ok(/opacity:\s*1\s*;/.test(rule),
    'Justin ruled full brightness; it is safe because nothing exposes text to it');
  assert.ok(!/--motif-alpha/.test(rule),
    'the alpha variable is gone — a var with a fallback made the rendered value ' +
    'unreadable from the source (the source said 0.25, the render said 0.40)');
});

test('⚠⚠ THE THREE CARDED CONTAINERS — this is what makes opacity 1 safe', () => {
  /* Each of these was measured EXPOSED on the live page before this commit.
     They are pinned individually because losing any one is invisible: the page
     renders perfectly and the text simply sits on a photograph. */

  // 1 · call-review's own header (6 exposed leaves: title, date, duration,
  //     status badge, Fathom link). Every other view uses .page-header.
  const rp = LIVE.match(/\.review-page-header\s*\{[^}]*\}/);
  assert.ok(rp, '.review-page-header rule must exist');
  assert.ok(/background:\s*var\(--bg-elevated\)/.test(rp[0]),
    '.review-page-header must be carded — it was call-review\'s only exposure');

  // 2 · the objections synthesis panel (66 of 75 exposed leaves sat inside it).
  const sp = LIVE.match(/\.synth-panel\s*\{[^}]*\}/);
  assert.ok(sp, '.synth-panel rule must exist');
  assert.ok(/background:\s*var\(--bg-elevated\)/.test(sp[0]),
    '.synth-panel had a border and no fill — it read as a card and behaved as a hole');

  // 3 · the objections metric tiles (9 exposed leaves). Built as unclassed
  //     inline-styled divs, so the fill lives in the generator, not in CSS.
  const at = LIVE.indexOf('function objStatCard');
  assert.ok(at > -1, 'objStatCard must exist');
  // ⚠ fromIndex on the end search, and a length assertion — an unbounded
  // indexOf finds the FIRST '}' in the whole file, which is far earlier, and
  // slice(bigger, smaller) silently returns ''.
  const stat = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(stat.length > 100 && stat.length < 1500,
    'objStatCard slice must cover the function, got ' + stat.length);
  assert.ok(/background:\s*var\(--bg-elevated\)/.test(stat),
    'objStatCard tiles must carry an opaque fill; no class rule can reach them');

  // ⚠ AND THE REFERENCE CARD MUST STILL BE OPAQUE — if .page-header ever loses
  // its fill, thirteen views lose their headers to the image at once.
  const ph = LIVE.match(/\n\s*\.page-header\s*\{[^}]*\}/);
  assert.ok(ph, '.page-header rule must exist');
  assert.ok(/background:\s*var\(--bg-elevated\)/.test(ph[0]),
    '.page-header is the carding mechanism for every other view');
});

test('⚠ NON-VACUITY — the carding guard fails when a fill is removed', () => {
  // Proven, not assumed: strip .synth-panel's background and confirm the
  // assertion above would go red. An absence check that has never been seen to
  // fail is the easiest test in the codebase to write and have mean nothing.
  const stripped = LIVE.replace(
    /(\.synth-panel\s*\{)\s*background:\s*var\(--bg-elevated\);/,
    '$1');
  assert.notStrictEqual(stripped, LIVE, 'the fixture must actually change');
  const sp = stripped.match(/\.synth-panel\s*\{[^}]*\}/);
  assert.ok(sp && !/background:\s*var\(--bg-elevated\)/.test(sp[0]),
    'with the fill removed the guard must not still report it carded');
});

test('the asset ships and is nowhere near the 9 MB source', () => {
  const p = path.join(__dirname, '..', 'web', 'team-background.webp');
  const st = fs.statSync(p);
  assert.ok(st.size > 50 * 1024, 'suspiciously small — did the encode fail?');
  assert.ok(st.size < 600 * 1024,
    'this is now on EVERY view, so its weight is paid on every page: ' + st.size);
});
