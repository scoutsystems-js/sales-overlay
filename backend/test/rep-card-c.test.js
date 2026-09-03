/**
 * CARD C (Justin's pick, 2026-09-03, H705), RENDERED under the host view: the faint ring
 * wash in the ground, the green carrying light on the headline, glowing bars with THE
 * WEAKEST IN RED (--bad — the one judgement colour on the card), the lit top edge and
 * monogram, the accent glow OUTSIDE a WHITE edge (the playing-card ruling stands), and
 * the three stats stripped to value + arrow + label — no counts, no side tag, no band clause.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderComputed } = require('./helpers/electron-render');
const { liveCard, JOSH, DRE, STATE, HTML, LIVE } = require('./helpers/rep-card-live');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + '</style>'.length);

function page(reps) {
  const card = liveCard()(STATE);
  return '<!doctype html><html><head>' + STYLE + '</head><body data-view="team-performance"><main class="page"><div><div class="section fade-in"><div class="rep-card-list" id="grid">'
    + reps.map((r, i) => card(Object.assign({}, r, { user_id: r.user_id + i }))).join('') + '</div></div></div></main></body></html>';
}
const PROBE = `[...document.querySelectorAll('.rep-card')].map((el) => { const cs = getComputedStyle(el); const before = getComputedStyle(el, '::before'); const band = el.querySelector('.rep-card-band'); const bandAfter = getComputedStyle(band, '::after');
  const fills = [...el.querySelectorAll('.rep-bar')].map((b) => { const f = b.querySelector('.rep-bar-fill'); const fc = getComputedStyle(f); return { weak: b.classList.contains('weak'), bg: fc.backgroundColor, glow: fc.boxShadow }; });
  const lead = el.querySelector('.rep-card-lead-val'); const lc = lead ? getComputedStyle(lead) : null; const mono = getComputedStyle(el.querySelector('.rep-mono'));
  return { edge: cs.borderTopColor, glow: cs.boxShadow, radius: cs.borderTopLeftRadius, wash: before.backgroundImage.slice(0, 40), washHasRings: /repeating-radial-gradient/.test(before.backgroundImage),
    topLine: { w: bandAfter.width, h: bandAfter.height, bg: bandAfter.backgroundColor }, mono: { color: mono.color, glow: mono.boxShadow },
    lead: lc ? { color: lc.color, shadow: lc.textShadow, family: lc.fontFamily, weight: lc.fontWeight } : null, fills } })`;

test('⚠⚠ RENDERED: card C — white edge with an outer accent glow, the ring wash, the lit top line and monogram, the green headline', () => {
  const cards = renderComputed(page([JOSH, DRE]), PROBE);
  assert.strictEqual(cards.length, 2, 'floor: two cards rendered');
  for (const c of cards) {
    assert.strictEqual(c.edge, 'rgb(255, 255, 255)', 'the edge stays WHITE (playing card): ' + c.edge);
    assert.ok(/rgba\(9, 224, 70/.test(c.glow), 'an accent glow outside the edge: ' + c.glow);
    assert.strictEqual(c.radius, '16px');
    assert.ok(c.washHasRings, 'the ring wash is in the ground: ' + c.wash);
    assert.strictEqual(c.topLine.h, '2px'); assert.strictEqual(c.topLine.w, '96px'); assert.strictEqual(c.topLine.bg, 'rgb(9, 224, 70)');
    assert.strictEqual(c.mono.color, 'rgb(9, 224, 70)'); assert.ok(/rgba\(9, 224, 70/.test(c.mono.glow), 'lit monogram');
  }
  const josh = cards[0];
  assert.strictEqual(josh.lead.color, 'rgb(9, 224, 70)', 'the headline is green');
  assert.ok(/rgba\(9, 224, 70/.test(josh.lead.shadow), 'and carries light');
  assert.ok(/Saira/.test(josh.lead.family), 'Saira, not monospace');
  assert.ok(Number(josh.lead.weight) <= 500, 'weight ≤ 500, got ' + josh.lead.weight);
});

test('⚠⚠ RENDERED: the bars glow green and THE WEAKEST IS RED — the one judgement colour on the card', () => {
  const cards = renderComputed(page([JOSH]), PROBE);
  const fills = cards[0].fills;
  assert.strictEqual(fills.length, 5);
  const weak = fills.filter((f) => f.weak), rest = fills.filter((f) => !f.weak);
  assert.strictEqual(weak.length, 1, 'exactly one weakest');
  assert.strictEqual(weak[0].bg, 'rgb(248, 113, 113)', '--bad, not a hotter green: ' + weak[0].bg);
  assert.ok(/rgba\(248, 113, 113/.test(weak[0].glow), 'the red glows');
  rest.forEach((f) => { assert.ok(/rgba\(9, 224, 70/.test(f.bg) || /rgba\(9, 224, 70/.test(f.glow), 'the others are green: ' + f.bg + ' / ' + f.glow); assert.ok(!/248, 113, 113/.test(f.bg), 'never red'); });
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
