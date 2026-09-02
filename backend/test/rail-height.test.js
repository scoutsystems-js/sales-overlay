'use strict';
/* ⚠⚠ THE RAIL IS SIZED BY ITS CONTENT, NOT THE VIEWPORT (Justin, 2026-09-02).
   It ends ~16px below the last nav item with the Team menu expanded, so the
   mesh shows beneath it at every width — including 1366, where there is
   otherwise none. A future "tidy" that restores `bottom: var(--rail-inset)`
   (full height) is the defect this guards against. The scroll cap is DERIVED
   from the viewport so a short window keeps its navigation; the menu animates
   so the card does not jump. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = RAW.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
function railRule(src) {
  const at = src.indexOf('\n    .sidebar {');
  assert.ok(at > -1, 'stale anchor — the rail rule');
  const rule = src.slice(at, src.indexOf('\n    }', at));
  assert.ok(rule.length > 300 && rule.length < 1400, 'rule slice: ' + rule.length);
  return rule;
}
test('⚠⚠ the rail does NOT run full height — bottom is auto, never an inset', () => {
  const r = railRule(LIVE);
  assert.ok(/\n\s*bottom:\s*auto;/.test(r), 'bottom must be auto (content-sized)');
  assert.ok(!/bottom:\s*var\(--rail-inset\)/.test(r), 'a bottom inset pins the card to the window — the full-height defect');
});
test('⚠ the scroll cap is DERIVED from the viewport, and the card scrolls inside it', () => {
  const r = railRule(LIVE);
  assert.ok(/max-height:\s*calc\(100vh - 51px - var\(--rail-inset\) \* 2\)/.test(r),
    'max-height must be 100vh minus the nav and both insets — a px cap is right at one window height only');
  assert.ok(/overflow-y:\s*auto/.test(r), 'and the card must scroll rather than lose its navigation');
});
test('⚠ the menu animates its height so the content-sized card does not jump', () => {
  assert.ok(/\.sidebar \.nav-team-menu \{ display: grid; grid-template-rows: 1fr; transition: grid-template-rows [0-9]+ms/.test(LIVE), 'the open state');
  assert.ok(/\.sidebar \.nav-team-menu\.is-collapsed \{ grid-template-rows: 0fr; \}/.test(LIVE), 'the collapsed state');
  assert.ok(/nav-team-menu-inner \{ overflow: hidden; min-height: 0; \}/.test(LIVE), 'the row clips through the inner wrapper');
  assert.ok(/class="nav-team-menu-inner"/.test(LIVE), 'the builder must emit the inner wrapper or nothing clips');
  assert.ok(/classList\.add\('is-collapsed'\); setTimeout/.test(LIVE), 'close animates then removes');
  assert.ok(/fresh\.classList\.remove\('is-collapsed'\)/.test(LIVE), 'open releases from 0fr');
});
test('reduced motion turns the transition off', () => {
  const rm = LIVE.slice(LIVE.indexOf('@media (prefers-reduced-motion: reduce) {'));
  assert.ok(/\.sidebar \.nav-team-menu \{ transition: none; \}/.test(rm.slice(0, 1200)), 'the rail menu must not animate under reduced motion');
});
test('⚠ NON-VACUITY — restoring the full-height inset fails the guard', () => {
  const broken = LIVE.replace(/\n(\s*)bottom:\s*auto;/, '\n$1bottom: var(--rail-inset);');
  assert.notStrictEqual(broken, LIVE, 'the fixture must actually change');
  const r = railRule(broken);
  assert.ok(/bottom:\s*var\(--rail-inset\)/.test(r) && !/bottom:\s*auto;/.test(r), 'the guard must see the inset');
});
