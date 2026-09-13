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

/* ⚠⚠ RENDERED UNDER THE REAL HOST, OR IT GUARDS NOTHING. The first version of
   this guard rendered the cards under a bare <body> and passed while the live
   Team Performance page showed NO border at all: a `body[data-view="team-performance"]
   .rep-card { border: 0 }` rule (the 2026-09-01 "rows, not boxes" pass) only
   fires under the page's data-view attribute and ancestor chain. So each
   placement is rendered under the view that hosts it, inside the ancestors the
   page actually builds (read from the live DOM 2026-09-02). */
const HOSTS = [
  { view: 'team-performance', open: '<main class="page"><div class="observatory-page observatory-performance"><section class="section fade-in observatory-reps-panel"><div class="rep-card-list" id="grid">', close: '</div></section></div></main>', count: 8, observatory: true },
  { view: 'team-dashboard',   open: '<main class="page"><div><div class="section fade-in"><div class="dash-grid"><div class="dash-card" id="slot" style="grid-column:span 2;">', close: '</div></div></div></div></main>', count: 1 },
];
function page(host) {
  const card = liveCard()(STATE);
  const reps = [JOSH, DRE, DANIEL, JOSH, DRE, JOSH, DRE, JOSH].slice(0, host.count);
  const cards = reps.map((r, i) => card(Object.assign({}, r, { user_id: r.user_id + i }))).join('');
  return '<!doctype html><html><head>' + STYLE + '</head><body data-view="' + host.view + '">' + host.open + cards + host.close + '</body></html>';
}

const PROBE = `[...document.querySelectorAll('.rep-card')].map((el) => { const cs = getComputedStyle(el); return {
  where: el.closest('#slot') ? 'slot' : 'grid',
  edge: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
  edges: [cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].join('|'),
  radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].join(' '),
  clip: cs.overflow } })`;

test('⚠⚠ RENDERED under each host view: Observatory Performance uses a sage edge and 20px cards; the dashboard keeps its white playing-card edge', () => {
  let seen = 0;
  for (const host of HOSTS) {
    const cards = renderComputed(page(host), PROBE);
    assert.strictEqual(cards.length, host.count, host.view + ': floor — ' + host.count + ' card(s) rendered');
    for (const c of cards) {
      seen++;
      const expectedEdge = host.observatory ? '1px solid rgba(215, 236, 222, 0.14)' : '1px solid rgb(255, 255, 255)';
      const expectedEdges = host.observatory ? 'rgba(215, 236, 222, 0.14)|rgba(215, 236, 222, 0.14)|rgba(215, 236, 222, 0.14)' : 'rgb(255, 255, 255)|rgb(255, 255, 255)|rgb(255, 255, 255)';
      const expectedRadius = host.observatory ? '20px 20px 20px 20px' : '16px 16px 16px 16px';
      assert.strictEqual(c.edge, expectedEdge, host.view + '/' + c.where + ': unexpected rendered edge ' + c.edge);
      assert.strictEqual(c.edges, expectedEdges, host.view + ': unexpected rendered edge colors');
      assert.strictEqual(c.radius, expectedRadius, host.view + ': unexpected card radius ' + c.radius);
      assert.strictEqual(c.clip, 'hidden', host.view + ': the band must clip to the rounded corner');
    }
  }
  assert.strictEqual(seen, 9, 'nine cards measured across both hosts');
});

test('⚠ the exception is recorded beside the token, so the next sweep reads it before removing it', () => {
  const at = HTML.indexOf('--edge-white: #ffffff;');   /* promoted from --rep-card-edge on 2026-09-03 — the background switch shares it */
  assert.ok(at !== -1, 'the token exists');
  const above = HTML.slice(Math.max(0, at - 900), at);
  assert.ok(/DELIBERATE EXCEPTION/.test(above) && /playing card/.test(above), 'the ruling is stated where the value lives');
});
