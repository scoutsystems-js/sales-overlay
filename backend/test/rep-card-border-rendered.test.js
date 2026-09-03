'use strict';
/**
 * ⚠⚠ THE REP CARD'S WHITE EDGE, MEASURED AS RENDERED (Justin, 2026-09-02: "so it
 * looks like a playing card"; H686).
 *
 * This is a RULED EXCEPTION to the design pass, which removed borders everywhere
 * and replaced them with space: the rep card is the one surface where the
 * border IS the metaphor — the same standing as the call-review verdict border.
 * A `border: 0` shorthand once destroyed that exemption with nothing failing
 * (H267), so this guard does not read the stylesheet; it lays the page's real
 * stylesheet out in Chromium (Electron, offscreen) around the real `repCardHtml`
 * output, in BOTH placements — the Performance grid of eight and the catalog's
 * widget slot — and reads the computed edge back.
 */
const test = require('node:test');
const assert = require('node:assert');
const { renderComputed } = require('./helpers/electron-render');
const { liveCard, JOSH, DRE, DANIEL, STATE, HTML } = require('./helpers/rep-card-live');

const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length);
assert.ok(STYLE.length > 100000, 'floor: the stylesheet was found (' + STYLE.length + ')');

function page() {
  const card = liveCard()(STATE);
  const eight = [JOSH, DRE, DANIEL, JOSH, DRE, JOSH, DRE, JOSH].map((r, i) => card(Object.assign({}, r, { user_id: r.user_id + i }))).join('');
  return '<!doctype html><html><head>' + STYLE + '</head><body>'
    + '<div class="page"><div class="rep-card-list" id="grid">' + eight + '</div>'
    + '<div class="dash-grid"><div class="dash-card" id="slot" style="grid-column:span 2;">' + card(JOSH) + '</div></div></div>'
    + '</body></html>';
}

const PROBE = `[...document.querySelectorAll('.rep-card')].map((el) => { const cs = getComputedStyle(el); return {
  where: el.closest('#slot') ? 'slot' : 'grid',
  edge: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
  edges: [cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].join('|'),
  radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].join(' '),
  clip: cs.overflow } })`;

test('⚠⚠ RENDERED: every rep card, in the grid and in the widget slot, has a 1px WHITE edge and 16px corners', () => {
  const cards = renderComputed(page(), PROBE);
  assert.strictEqual(cards.length, 9, 'floor: eight grid cards and one slot card rendered');
  assert.ok(cards.some((c) => c.where === 'slot') && cards.filter((c) => c.where === 'grid').length === 8, 'both placements present');
  for (const c of cards) {
    assert.strictEqual(c.edge, '1px solid rgb(255, 255, 255)', c.where + ': the edge must be 1px solid white as rendered, got ' + c.edge);
    assert.strictEqual(c.edges, 'rgb(255, 255, 255)|rgb(255, 255, 255)|rgb(255, 255, 255)', c.where + ': all four sides white');
    assert.strictEqual(c.radius, '16px 16px 16px 16px', c.where + ': playing-card corners (--radius-lg), got ' + c.radius);
    assert.strictEqual(c.clip, 'hidden', c.where + ': the band must clip to the rounded corner');
  }
});

test('⚠ the exception is recorded beside the token, so the next sweep reads it before removing it', () => {
  const at = HTML.indexOf('--rep-card-edge: #ffffff;');
  assert.ok(at !== -1, 'the token exists');
  const above = HTML.slice(Math.max(0, at - 900), at);
  assert.ok(/DELIBERATE EXCEPTION/.test(above) && /playing card/.test(above), 'the ruling is stated where the value lives');
});
