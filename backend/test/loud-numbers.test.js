'use strict';
/**
 * ⚠⚠ ONE LOUD NUMBER PER PAGE, AT 48 (Justin's rulings, 2026-09-03, H690).
 * Objections: the handle rate is the page's number; its two counts are supporting
 * stats. Knowledge Base: the counter is the page's number. Both EXECUTED against
 * the real render, not read from the source.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');

const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));

test('⚠⚠ EXECUTED: the Objections tiles — the handle rate renders at the display step, the two counts at --fs-number', () => {
  const card = new Function('escapeHtml', fnBody(LIVE, 'objStatCard') + '\nreturn objStatCard;')((s) => String(s));
  const loud = card('Handle Rate', '11%', '113 resolution-tagged', true);
  const quiet = card('Objections', 113, '73 calls');
  assert.ok(/font-size:var\(--fs-display\);font-weight:var\(--fw-display\)/.test(loud), 'the loud tile is 48/300: ' + loud);
  assert.ok(/font-size:var\(--fs-number\);font-weight:var\(--fw-normal\)/.test(quiet), 'a quiet tile is 20/400: ' + quiet);
  assert.ok(!/30px/.test(loud + quiet), 'the 30px literal is gone');
  // and the page passes `loud` to exactly ONE of its three calls — the handle rate
  const at = LIVE.indexOf('function renderObjectionsIntel');
  const body = LIVE.slice(at, at + 12000);
  const calls = body.match(/objStatCard\('[^']+'[\s\S]*?\)\n/g) || [];
  assert.strictEqual(calls.length, 3, 'three tiles');
  const loudCalls = calls.filter((c) => /,\s*true\)\n$/.test(c));
  assert.strictEqual(loudCalls.length, 1, 'exactly one loud tile');
  assert.ok(/'Handle Rate'/.test(loudCalls[0]), 'and it is the handle rate');
});

test('⚠ the Knowledge Base counter is the page\'s one loud number, at the display step', () => {
  const rule = LIVE.match(/\.kb-counter-card \.kbc-num \{[^}]*\}/);
  assert.ok(rule, 'the rule exists');
  assert.ok(/font-size: var\(--fs-display\)/.test(rule[0]) && /font-weight: var\(--fw-display\)/.test(rule[0]), rule[0]);
  assert.ok(!/42px/.test(LIVE.slice(LIVE.indexOf('<style>'), LIVE.indexOf('</style>'))), 'no 42px left in the stylesheet');
});

test('⚠ the landing page declares its two exemptions with their reason, and uses them', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(/--fs-hero:\s*58px/.test(idx) && /--fs-section:\s*32px/.test(idx), 'the two named tokens');
  assert.ok(/NAMED EXCEPTIONS FOR THIS PAGE ONLY/.test(idx) && /landing page is not a dashboard/i.test(idx), 'declared as an exemption with its reason');
  const css = stripComments(idx);
  assert.ok(/\.hero h1 \{[^}]*font-size: var\(--fs-hero\)[^}]*font-weight: var\(--fw-display\)/.test(css), 'the hero uses them at 300');
  assert.ok(/h2 \{ font-size: var\(--fs-section\)/.test(css), 'the section headings use them');
});
