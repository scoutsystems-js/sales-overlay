/**
 * CARD C (Justin's pick, 2026-09-03, H705), RENDERED under the host view: the green
 * carrying light on the headline, glowing bars with THE WEAKEST IN RED (--bad — the one
 * judgement colour on the card), the monogram, the scoped sage edge, and
 * the three stats stripped to value + arrow + label — no counts, no side tag, no band clause.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderComputed } = require('./helpers/electron-render');
const { liveCard, JOSH, DRE, STATE, HTML, LIVE } = require('./helpers/rep-card-live');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length);

function page(reps, observatory = true, view = 'team-performance') {
  const card = liveCard()(STATE);
  const shell = observatory
    ? '<div class="observatory-page observatory-performance"><section class="section fade-in observatory-reps-panel"><div class="rep-card-list" id="grid">'
    : '<div><section><div class="rep-card-list" id="grid">';
  const close = observatory ? '</div></section></div>' : '</div></section></div>';
  return '<!doctype html><html><head>' + STYLE + '</head><body data-view="' + view + '"><main class="page">' + shell
    + reps.map((r, i) => card(Object.assign({}, r, { user_id: r.user_id + i }))).join('') + close + '</main></body></html>';
}
const PROBE = `[...document.querySelectorAll('.rep-card')].map((el) => { const cs = getComputedStyle(el); const before = getComputedStyle(el, '::before'); const band = el.querySelector('.rep-card-band'); const bandAfter = getComputedStyle(band, '::after');
  const fills = [...el.querySelectorAll('.rep-bar')].map((b) => { const f = b.querySelector('.rep-bar-fill'); const fc = getComputedStyle(f); return { weak: b.classList.contains('weak'), bg: fc.backgroundColor, glow: fc.boxShadow }; });
  const lead = el.querySelector('.rep-card-lead-val'); const lc = lead ? getComputedStyle(lead) : null; const mono = getComputedStyle(el.querySelector('.rep-mono'));
  return { edge: cs.borderTopColor, glow: cs.boxShadow, radius: cs.borderTopLeftRadius, wash: before.backgroundImage.slice(0, 40), washDisplay: before.display, washHasRings: /repeating-radial-gradient/.test(before.backgroundImage),
    topLine: { display: bandAfter.display, w: bandAfter.width, h: bandAfter.height, bg: bandAfter.backgroundColor }, mono: { color: mono.color, glow: mono.boxShadow },
    lead: lc ? { color: lc.color, shadow: lc.textShadow, family: lc.fontFamily, weight: lc.fontWeight } : null, fills } })`;

test('⚠⚠ RENDERED: Observatory Performance card — sage edge, dark panel, compact monogram and green headline', () => {
  const cards = renderComputed(page([JOSH, DRE]), PROBE);
  assert.strictEqual(cards.length, 2, 'floor: two cards rendered');
  for (const c of cards) {
    assert.strictEqual(c.edge, 'rgba(215, 236, 222, 0.14)', 'the Observatory edge is sage: ' + c.edge);
    assert.ok(/rgba\(0, 0, 0, 0.24/.test(c.glow), 'the Observatory card keeps its dark shadow: ' + c.glow);
    assert.strictEqual(c.radius, '20px');
    assert.strictEqual(c.washDisplay, 'none', 'the Observatory card hides the old ring wash');
    assert.strictEqual(c.topLine.display, 'none', 'the Observatory card hides the old top line');
    assert.strictEqual(c.mono.color, 'rgb(189, 249, 205)');
  }
  const josh = cards[0];
  assert.strictEqual(josh.lead.color, 'rgb(9, 213, 67)', 'the headline is Scout green');
  assert.strictEqual(josh.lead.shadow, 'none', 'the Observatory headline stays clean');
  assert.ok(/Saira/.test(josh.lead.family), 'Saira, not monospace');
  assert.ok(Number(josh.lead.weight) <= 500, 'weight ≤ 500, got ' + josh.lead.weight);
});

test('⚠ the custom dashboard host keeps the prior Card C edge and top treatment', () => {
  const c = renderComputed(page([JOSH], false, 'overview'), PROBE)[0];
  assert.strictEqual(c.edge, 'rgb(255, 255, 255)');
  assert.strictEqual(c.radius, '16px');
  assert.notStrictEqual(c.washDisplay, 'none');
  assert.strictEqual(c.topLine.h, '2px');
});

test('⚠⚠ RENDERED: the bars glow green and THE WEAKEST IS RED — the one judgement colour on the card', () => {
  const cards = renderComputed(page([JOSH]), PROBE);
  const fills = cards[0].fills;
  assert.strictEqual(fills.length, 5);
  const weak = fills.filter((f) => f.weak), rest = fills.filter((f) => !f.weak);
  assert.strictEqual(weak.length, 1, 'exactly one weakest');
  assert.strictEqual(weak[0].bg, 'rgb(248, 113, 113)', '--bad, not a hotter green: ' + weak[0].bg);
  assert.ok(/rgba\(248, 113, 113/.test(weak[0].glow), 'the red glows');
  rest.forEach((f) => { assert.ok(/rgba\(9, 213, 67/.test(f.bg) || /rgba\(9, 213, 67/.test(f.glow), 'the others are green: ' + f.bg + ' / ' + f.glow); assert.ok(!/248, 113, 113/.test(f.bg), 'never red'); });
});

test('⚠⚠ the three stats are value + arrow + label — no counts, no side tag, no band clause, and the label reads "Objection handle %"', () => {
  const html = liveCard()(STATE)(Object.assign({}, JOSH, { close_delta: 8, obj_delta: 13, time_delta: 8.3 }));
  assert.ok(!/rep-card-lead-sub|of \d+ prospects|rep-side|in the band|\d+ of \d+<\/div>/.test(html), 'stripped: ' + html.slice(html.indexOf('rep-card-lead'), html.indexOf('rep-card-bars')));
  assert.ok(/rep-stat-label">Objection handle %</.test(html), 'the label changed');
  assert.ok(/Avg call time</.test(html) && /Closing rate</.test(html));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/24% ▲ 8% Closing rate 13% ▲ 13% Objection handle % 47\.3 min ▲ 8\.3 min Avg call time/.test(text), 'Justin\'s exact shape: ' + text.slice(0, 220));
  assert.ok(!/\.rep-card-lead-sub \{|\.rep-side \{/.test(LIVE), 'the removed elements\' CSS left with them');
});
