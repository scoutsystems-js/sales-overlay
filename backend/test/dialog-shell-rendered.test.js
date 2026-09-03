'use strict';
/**
 * ⚠⚠ ONE DIALOG SHELL, RENDERED (D-6, Justin 2026-09-03, H689). Four shells rendered
 * before this: the KB dialog, the Need-help card, the confirm/prompt dialog (its CSS is
 * a string in scout-modal.js) and the Add-a-card picker. The KB dialog's shell won.
 * This renders all four under the real stylesheets and asserts the SHELL — surface,
 * edge, radius, max width, padding — is identical; what each puts inside is its own.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderComputed } = require('./helpers/electron-render');

const WEB = path.join(__dirname, '..', 'web');
const HTML = fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length);
const MODAL = fs.readFileSync(path.join(WEB, 'js', 'scout-modal.js'), 'utf8');
const cssMatch = MODAL.match(/var CSS = \[([\s\S]*?)\]\.join\(''\);/);
assert.ok(cssMatch, 'the modal CSS string exists');
const MODAL_CSS = new Function('return [' + cssMatch[1] + '].join("");')();

const PAGE = '<!doctype html><html><head>' + STYLE + '<style>' + MODAL_CSS + '</style></head><body data-view="overview">'
  + '<div class="kb-modal"><div class="kb-modal-dialog" id="s-kb">kb</div></div>'
  + '<div class="support-modal"><div class="support-card" id="s-support">support</div></div>'
  + '<div class="dash-picker-backdrop"><div class="dash-picker" id="s-picker">picker</div></div>'
  + '<div class="scout-modal-backdrop"><div class="scout-modal" id="s-confirm">confirm</div></div>'
  + '</body></html>';
const PROBE = `['s-kb','s-support','s-picker','s-confirm'].map((id) => { const el = document.getElementById(id); const cs = getComputedStyle(el); return { id, bg: cs.backgroundColor, edge: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius, maxW: cs.maxWidth, pad: cs.paddingTop }; })`;

test('⚠⚠ RENDERED: the four dialogs share one shell — surface, hairline edge, --radius, 520 wide, 28px padding', () => {
  const rows = renderComputed(PAGE, PROBE);
  assert.strictEqual(rows.length, 4, 'floor: four shells rendered');
  const kb = rows[0];
  assert.strictEqual(kb.bg, 'rgb(19, 19, 19)', 'the shell surface is --bg-elevated'); assert.strictEqual(kb.edge, '1px solid rgb(31, 31, 31)', 'the shell edge is the hairline');
  assert.strictEqual(kb.radius, '12px', 'the shell radius is --radius'); assert.strictEqual(kb.maxW, '520px'); assert.strictEqual(kb.pad, '28px');
  for (const r of rows.slice(1)) for (const k of ['bg', 'edge', 'radius', 'maxW']) assert.strictEqual(r[k], kb[k], r.id + ' ' + k + ' differs from the KB shell: ' + r[k] + ' vs ' + kb[k]);
  /* padding is the shell's too for the three plain cards; the card picker is a flex column whose
     header and scrolling list carry their own padding (the list scrolls INSIDE the shell), so its
     outer box is 0 by construction — asserted so a change there is a decision, not a drift */
  for (const r of rows.filter((x) => x.id !== 's-picker')) assert.strictEqual(r.pad, '28px', r.id + ' padding');
  assert.strictEqual(rows.find((x) => x.id === 's-picker').pad, '0px', 'the picker pads its children, not its shell');
});
