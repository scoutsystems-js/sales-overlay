'use strict';
/* ⚠⚠ EVERY CLOSER WITH OBJECTIONS GETS COACHED (Justin, 2026-08-30, enforced
   2026-09-01). `focusOf` returned null for `thin_types` — no single category is
   big enough to RANK — which silently withheld coaching from closers who plainly
   have objections. Ranking asks whether one category STANDS OUT; that is a
   different question from whether there is anything worth saying. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const lane = require('../lib/team-objection-summary.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-objection-summary.js'), 'utf8');
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('a thin_types closer with real objections is now coachable', () => {
  // Josh N on the live board: 0 of 10 overall, top category fear at 0 of 4
  const f = lane._focusOf({ state: 'thin_types', ranking: [], top: { total: 4, handled: 0, category: 'fear', rate_pct: 0 } });
  assert.ok(f, 'must not be withheld');
  assert.strictEqual(f.category, 'fear');
  assert.strictEqual(f.total, 4);
  assert.strictEqual(f.handled, 0);
});

test('⚠⚠ baseline_pct is strictly NULL, never undefined — the prompt tests === null', () => {
  const f = lane._focusOf({ state: 'thin_types', ranking: [], top: { total: 4, handled: 0, category: 'fear', rate_pct: 0 } });
  /* ⚠ `top` carries no baseline. The prompt builder branches on
     `s.baseline_pct === null` STRICTLY, so an undefined would emit
     "undefined% across their other categories" INTO A MODEL PROMPT — a
     placeholder that is a valid value of its own type, which that check
     cannot see. */
  assert.strictEqual(f.baseline_pct, null, 'must be null, not undefined');
  assert.notStrictEqual(f.baseline_pct, undefined);
  // and the prompt line must therefore take the safe branch
  const line = (f.baseline_pct === null) ? 'no comparable baseline' : f.baseline_pct + '%';
  assert.strictEqual(line, 'no comparable baseline');
});

test('the existing states are untouched', () => {
  const rg = lane._focusOf({ focus: { category: 'fear', total: 9, handled: 3, baseline_pct: 40 } });
  assert.strictEqual(rg.category, 'fear');
  assert.strictEqual(rg.baseline_pct, 40, 'rate_gap keeps its real baseline');
  const ep = lane._focusOf({ ranking: [{ category: 'timing', total: 6, handled: 2, baseline_pct: 35 }] });
  assert.strictEqual(ep.category, 'timing');
});

test('⚠ genuinely nothing to point at still returns null', () => {
  assert.strictEqual(lane._focusOf({ state: 'thin_types', ranking: [], top: { total: 0, handled: 0, category: 'fear' } }), null,
    'a top with no objections in it is not a focus');
  assert.strictEqual(lane._focusOf({ state: 'thin_types', ranking: [], top: null }), null);
  assert.strictEqual(lane._focusOf(null), null);
});

test('⚠⚠ the comment no longer claims a single exception above a filter with two', () => {
  const live = strip(SRC);
  assert.ok(/focusOf\(c\) !== null/.test(live), 'the filter still has both conditions');
  // the stale claim must be gone from the PROSE
  assert.strictEqual(/`no_data` is the ONE exception and it survives/.test(SRC), false,
    'the comment asserted one exception while the filter had two');
});

test('⚠ the lane version moved — who gets coached is cached', () => {
  assert.ok(/^v10-/.test(lane._PROMPT_VERSION),
    'a change to WHO is coached must invalidate the cache, or it ships nothing: ' + lane._PROMPT_VERSION);
});
