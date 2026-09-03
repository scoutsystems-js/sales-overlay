'use strict';
/**
 * ⚠⚠ CONTROLS INHERIT BY CAPABILITY — MEASURED AS RENDERED (D-1, 2026-09-03, H688).
 *
 * The defect: inputs were styled one TYPE at a time, so an `input[type=email]`
 * beside two styled text fields was 22px of white Arial, the Need-help dialog's
 * select and url input were white browser defaults, and every <select> in the
 * product rendered in Arial. The guard lays the page's real stylesheet out in
 * Chromium around a battery of every control the product uses — plus the REAL
 * Add-rep dialog and Need-help dialog markup lifted from the page — and runs the
 * inverse check that found the defect: a control whose background AND border
 * equal an `all: revert` clone of its own tag has inherited nothing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderComputed } = require('./helpers/electron-render');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length);
assert.ok(STYLE.length > 100000, 'floor: the stylesheet was found');
function block(id) {
  const at = HTML.indexOf('id="' + id + '"');
  assert.ok(at !== -1, 'markup for #' + id + ' must exist');
  const start = HTML.lastIndexOf('<div', at);
  // the dialog block ends at the first '</div>\n</div>' pair after the close of its inner card
  const end = HTML.indexOf('\n</div>', HTML.indexOf('\n</div>', at) + 1) + '\n</div>'.length;
  return HTML.slice(start, end).replace(/ hidden"/g, '"').replace(/class="hidden"/g, '');
}
const BATTERY = ['text', 'email', 'url', 'number', 'search', 'password', 'tel', 'date']
  .map((t) => '<input type="' + t + '" id="in-' + t + '" value="x">').join('')
  + '<select id="in-select"><option>a</option></select><textarea id="in-textarea">t</textarea>'
  + '<button type="button" id="in-button">b</button><input type="file" id="in-file"><input type="checkbox" id="in-check">';
const PAGE = '<!doctype html><html><head>' + STYLE + '</head><body data-view="overview"><main class="page"><div id="battery">' + BATTERY + '</div>'
  + block('memberAddModal') + block('supportModal') + '</main></body></html>';

const PROBE = `(() => {
  const defaults = {};
  const def = (tag, type) => { const k = tag + (type || ''); if (!defaults[k]) { const d = document.createElement(tag); if (type) d.type = type; d.style.cssText = 'all:revert;position:absolute;left:-9999px;top:0'; d.textContent = 'x'; document.body.appendChild(d); const c = getComputedStyle(d); defaults[k] = { bg: c.backgroundColor, bc: c.borderTopColor }; d.remove(); } return defaults[k]; };
  const out = [];
  for (const el of document.querySelectorAll('input, select, textarea, button')) {
    const cs = getComputedStyle(el); const tag = el.tagName.toLowerCase(); const type = tag === 'input' ? el.type : '';
    const d = def(tag, type);
    out.push({ id: el.id || (tag + (el.className ? '.' + String(el.className).split(' ')[0] : '')), tag, type, font: cs.fontFamily, bg: cs.backgroundColor, bc: cs.borderTopColor, radius: cs.borderTopLeftRadius,
      h: Math.round(el.getBoundingClientRect().height), unstyled: cs.backgroundColor === d.bg && cs.borderTopColor === d.bc });
  }
  return out;
})()`;

const FIELD_LIKE = new Set(['text', 'email', 'url', 'number', 'search', 'password', 'tel', 'date', '']);
test('⚠⚠ RENDERED: every control inherits Saira, and no field-like control equals the browser default', () => {
  const rows = renderComputed(PAGE, PROBE);
  assert.ok(rows.length >= 20, 'floor: the battery and both dialogs rendered (' + rows.length + ' controls)');
  const arial = rows.filter((r) => !/Saira/.test(r.font)).map((r) => r.id);
  assert.deepStrictEqual(arial, [], 'controls not inheriting the face: ' + arial.join(', '));
  const raw = rows.filter((r) => r.unstyled && (r.tag !== 'input' || FIELD_LIKE.has(r.type)) && r.tag !== 'button').map((r) => r.id + ' (' + r.tag + '/' + r.type + ')');
  assert.deepStrictEqual(raw, [], 'field-like controls equal to their all:revert clone: ' + raw.join(', '));
});

test('⚠⚠ the Add-rep EMAIL box lines up with the two name fields it sits beside', () => {
  const rows = renderComputed(PAGE, PROBE);
  const by = (id) => rows.find((r) => r.id === id);
  const email = by('maEmail'), first = by('maFirst'), last = by('maLast');
  assert.ok(email && first && last, 'the three Add-rep fields rendered');
  assert.strictEqual(email.h, first.h, 'email height ' + email.h + ' must equal first-name height ' + first.h);
  assert.strictEqual(email.bg, first.bg, 'same surface'); assert.strictEqual(email.radius, first.radius, 'same radius');
  assert.ok(email.h >= 36, 'and it is a field, not a 22px strip (got ' + email.h + ')');
});

test('⚠ the Need-help dialog has no white control left in it', () => {
  const rows = renderComputed(PAGE, PROBE);
  const inSupport = rows.filter((r) => /^supportModal|^support|^sup|\.support/.test(r.id) || ['supportCategory', 'supportText', 'supportLink', 'supportFile'].includes(r.id));
  const white = rows.filter((r) => r.bg === 'rgb(255, 255, 255)').map((r) => r.id);
  assert.deepStrictEqual(white, [], 'white-backgrounded controls: ' + white.join(', '));
  assert.ok(rows.some((r) => r.tag === 'select' && !r.unstyled), 'a select rendered styled');
});
