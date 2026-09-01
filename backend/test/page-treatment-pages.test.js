'use strict';
/**
 * ⚠⚠ THE TREATMENT'S ORDER IS THE THING BEING GUARDED, NOT THE LOOK.
 *
 * Part 1 of this design pass removed cards FIRST and put 95 of 105 text
 * elements onto a full-brightness background raster. The rule that came out of
 * it is GROUND FIRST, THEN CARDS OFF — and it is invisible in a diff, because
 * both edits look equally reasonable on their own.
 *
 * So this asserts the PAIRING per view: any view whose `.section` has been
 * flattened must ALSO have a painted `.page`. A view in one list and not the
 * other is the exact defect part 1 shipped.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* line comments FIRST, then block — a `/*` inside a `//` line is a false opener
   that pairs with the next real closer and swallows everything between. */
const CODE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/.exec(CODE)[1];

function viewsIn(re) {
  const out = new Set();
  let m;
  const rx = new RegExp(re, 'g');
  while ((m = rx.exec(STYLE))) out.add(m[1]);
  return out;
}

test('every view with its cards off also has a painted ground', () => {
  const ground = viewsIn('body\\[data-view="([a-z-]+)"\\] \\.page,');
  const cardsOff = viewsIn('body\\[data-view="([a-z-]+)"\\] \\.section,');
  assert.ok(ground.size >= 15, 'ground list looks unread: ' + ground.size);
  assert.ok(cardsOff.size >= 15, 'cards-off list looks unread: ' + cardsOff.size);
  const missing = [...cardsOff].filter((v) => !ground.has(v));
  assert.deepStrictEqual(missing, [],
    'GROUND FIRST, THEN CARDS OFF — these views lost their cards with no floor: ' + missing.join(', '));
});

test('the nine pages continued in this block are in both lists', () => {
  const ground = viewsIn('body\\[data-view="([a-z-]+)"\\] \\.page,');
  const cardsOff = viewsIn('body\\[data-view="([a-z-]+)"\\] \\.section,');
  for (const v of ['section', 'performance', 'objections-intel', 'kb',
                   'account', 'prospects', 'needs-work', 'team-members']) {
    assert.ok(ground.has(v), v + ' has no ground');
    assert.ok(cardsOff.has(v), v + ' still draws its section card');
  }
});

/* ⚠ The boxes these pages nested INSIDE their sections. Flattening the section
   alone leaves a bordered card inside a borderless one, which reads worse than
   before it was touched. */
test('the nested content boxes on section / kb / prospects are flattened', () => {
  const rules = {
    '.sec-headline': 'the section page headline',
    '.sec-group': 'the section page moment group',
    '.kb-item': 'a knowledge-base row',
    '.kb-expand-panel': 'the knowledge-base expand panel',
    '.kb-pattern-card': 'a knowledge-base pattern card',
    '.merge-card': 'a prospect merge proposal',
    '.empty-card': 'an empty state'
  };
  for (const sel of Object.keys(rules)) {
    const m = new RegExp('\\n\\s*\\' + sel + ' \\{([^}]*)\\}').exec(STYLE);
    assert.ok(m, 'rule not found: ' + sel);
    const body = m[1];
    assert.ok(/background:\s*(none|transparent)/.test(body),
      rules[sel] + ' (' + sel + ') still has a fill');
    assert.ok(/border:\s*0/.test(body),
      rules[sel] + ' (' + sel + ') still has a full border');
  }
});

/* ⚠⚠ A LOUD NUMBER MUST COME FROM THE PAGE'S OWN PAYLOAD. Reading another
   page's lane is how a figure appears only when you arrive by clicking and
   vanishes on a deep link — a defect this product has already shipped once. */
test('the needs-work lead rate is POOLED and reads its own payload', () => {
  const at = CODE.indexOf('function renderNeedsWorkView');
  assert.ok(at > 0, 'renderNeedsWorkView not found');
  const fn = CODE.slice(at, CODE.indexOf('\n  function ', at + 10));
  assert.ok(fn.length > 400 && fn.length < 4000, 'slice must cover the function: ' + fn.length);
  assert.ok(/state\.needsWork\s*&&\s*state\.needsWork\.detail/.test(fn),
    'must read its own lane, not another page\'s');
  assert.ok(/h \+= \(x\.handled \|\| 0\); t \+= \(x\.total \|\| 0\);/.test(fn),
    'must POOL the counts — a mean of the per-bucket rates would disagree with the counts printed under it');
  assert.ok(/true objections/.test(fn),
    'the sub-label must name the denominator, because this page excludes DQs and logistical barriers');
});

test('the prospects lead count is suppressed while loading and at zero', () => {
  const at = CODE.indexOf('function renderProspectsView');
  const fn = CODE.slice(at, CODE.indexOf('\n  function ', at + 10));
  assert.ok(fn.length > 400 && fn.length < 4000, 'slice must cover the function: ' + fn.length);
  assert.ok(/state\.mergeLoading \|\| !cands\.length \? ''/.test(fn),
    'a 0 flashing during the fetch is a wrong answer, not a slow one');
});
