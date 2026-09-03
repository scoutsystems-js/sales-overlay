'use strict';
/**
 * ⚠⚠ ONE CLASS PER DESIGN (sweep ④b-1, fixed 2026-09-02, H685).
 *
 * `.sec-note` was declared twice, 3,400 lines apart, by two authors who did not
 * know of each other's block: 13px with an accent border (the manager's note on
 * a closer moment) and 12px italic (the section page's caveat). The browser
 * merged them — the Close drill-down rendered 12px italic WITH a border, a
 * design nobody wrote. Measured live before and after (H685).
 *
 * The pins are CARDINALITY (H267): a selector declared once, a declaration
 * stated once. A second `.sec-note {` — or a second `gap` on `.obj-card-head` —
 * is the defect returning.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');

const PAGE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
const CSS = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
assert.ok(CSS.length > 100000, 'floor: the stylesheet was found (' + CSS.length + ')');
const count = (re) => (CSS.match(re) || []).length;

test('④b-1 each note design has exactly one rule, and each renderer uses its own', () => {
  assert.strictEqual(count(/^\s*\.sec-note \{/gm), 1, '`.sec-note` is declared once');
  assert.strictEqual(count(/^\s*\.sec-moment-note \{/gm), 1, '`.sec-moment-note` is declared once');
  assert.ok(/\.sec-note \{[^}]*font-style: italic/.test(CSS), 'the caveat note is italic');
  assert.ok(!/\.sec-note \{[^}]*border-left/.test(CSS), 'the caveat note has NO border');
  assert.ok(/\.sec-moment-note \{[^}]*border-left: 2px solid var\(--accent\)/.test(CSS), 'the moment note has the accent border');
  assert.ok(!/\.sec-moment-note \{[^}]*italic/.test(CSS), 'the moment note is not italic');
  // the three renderers
  const lib = PAGE.slice(PAGE.indexOf('function sectionLibraryHtml'), PAGE.indexOf('function sectionLibraryHtml') + 4000);
  assert.ok(/class="sec-moment-note">' \+ escapeHtml\(m\.note\)/.test(lib), 'the manager note renders as .sec-moment-note');
  const hist = PAGE.slice(PAGE.indexOf('function sectionHistogramHtml'), PAGE.indexOf('function sectionHistogramHtml') + 1200);
  assert.ok(/class="sec-note">Uses the score/.test(hist), 'the histogram caveat renders as .sec-note');
  const hid = PAGE.slice(PAGE.indexOf('function closerHiddenNoteHtml'), PAGE.indexOf('function closerHiddenNoteHtml') + 800);
  assert.ok(/class="sec-note">Not shown/.test(hid), 'the Not-shown note renders as .sec-note');
});

test('④b cleanup — the seven dead declarations stay gone (cardinality)', () => {
  const bare = (sel) => (CSS.match(new RegExp('^\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*\\}', 'gm')) || []).join('\n');
  assert.strictEqual((bare('.obj-card-head').match(/\bgap:/g) || []).length, 1, '.obj-card-head states gap once (the 14px rule)');
  assert.strictEqual((bare('.page').match(/max-width:/g) || []).length, 1, '.page states max-width once (var(--page-w))');
  const navGroup = CSS.match(/\.sidebar \.nav-link,\s*\.sidebar \.nav-soon \{[^}]*\}/);
  assert.ok(navGroup, 'the nav group rule exists');
  assert.ok(!/line-height/.test(navGroup[0]), 'the nav group carries no line-height (nav-soon restates its own)');
  assert.ok(/\.sidebar \.nav-link \{ line-height: 1\.3; \}/.test(CSS), 'nav-link keeps 1.3 on its own rule');
  const badgeGroup = CSS.match(/\.dash-pin-badge, \.dash-default-badge \{[^}]*\}/);
  assert.ok(badgeGroup, 'the badge group exists');
  assert.ok(!/color:|opacity:/.test(badgeGroup[0]), 'the badge group carries no colour or opacity');
  assert.ok(/\.dash-default-badge \{ color: var\(--text\); opacity: 0\.65; \}/.test(CSS), 'the default badge keeps its own colour and opacity');
  const kbGroup = CSS.match(/\.kb-tab-panel input\[type="text"\],\s*\.kb-tab-panel input\[type="url"\],\s*\.kb-tab-panel input\[type="file"\],\s*\.kb-tab-panel textarea \{[^}]*\}/);
  assert.ok(kbGroup, 'the KB input group exists');
  assert.ok(!/font-family|padding:/.test(kbGroup[0]), 'the KB group carries no font-family or padding');
  assert.ok(/, \.kb-tab-panel textarea \{ padding: 10px 12px; \}/.test(CSS), 'text/url inputs and the textarea state their padding where it wins');
  assert.ok(/, \.kb-tab-panel input\[type="file"\] \{ font-family: inherit; \}/.test(CSS), 'the three inputs state font-family where it wins');
});
