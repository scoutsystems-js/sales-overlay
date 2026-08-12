/**
 * 7b — derive the DISCOVERY AREAS a rep's own material says matter.
 *
 * These areas become the coverage map in 7c and the filter key for the
 * "here's a call where you asked it well" library in 7e. Deriving them from the
 * rep's OWN offer / qualifications / script is what makes the later coaching
 * specific rather than generic — and what makes it fall silent for a customer
 * who has uploaded nothing, instead of inventing a rubric for them.
 *
 * THE TWO NON-NEGOTIABLES:
 *   1. SILENT ON THIN MATERIAL. No usable material → no areas → NO Claude call.
 *      The degradation path is the DEFAULT path: 4 of 5 live users have no
 *      usable material at all (offers of 3-26 chars, demo residue).
 *   2. COACHING ONLY. These areas must never reach SELLING CONTEXT. KB ruling 1
 *      exists because SELLING CONTEXT tells the grader not to penalise what the
 *      material endorses — feeding a coverage rubric in there would make the
 *      grader mark its own homework.
 */
const test = require('node:test');
const assert = require('node:assert');
const areas = require('../lib/coaching-areas');

const RICH = {
  offer: 'Done for you market research to identify local agencies to place tenants, plus A-Z education on licensing, property and scaling.',
  qualifications: '10k saved, not living paycheck to paycheck, 640 or above credit score',
  script_raw: 'Where are you calling from today? So tell me a bit about your current setup, are you already managing any properties? And what does your income goal look like?',
};

// ─── the silence contract ──────────────────────────────────────────────────

test('no material at all → no areas, and NO model call', async () => {
  let called = false;
  const out = await areas.deriveAreas({ profile: {}, ask: async () => { called = true; return []; } });
  assert.deepStrictEqual(out.areas, []);
  assert.strictEqual(out.reason, 'no_material');
  assert.strictEqual(called, false, 'a customer with nothing uploaded must not cost a Claude call');
});

test('DEMO-RESIDUE material ("Ava") is not material — still silent', async () => {
  // Live data: four users have offers of 3-26 chars left by seeding. Treating
  // "Ava" as an offer would generate a confident rubric out of a first name.
  let called = false;
  for (const junk of ['Ava', 'Ben', 'Cara', '   ', 'x']) {
    const out = await areas.deriveAreas({ profile: { offer: junk }, ask: async () => { called = true; return []; } });
    assert.deepStrictEqual(out.areas, [], 'junk offer: ' + junk);
    assert.strictEqual(out.reason, 'no_material');
  }
  assert.strictEqual(called, false);
});

test('a SHORT offer alone is not enough to found a rubric — silent, no model call', async () => {
  // Live case: one user's whole offer is "6 month real estate course" (26
  // chars). It clears the selling-context bar, and the model happily produced
  // five areas from it — general knowledge about real estate courses dressed up
  // as a personalised rubric. That is the confident nonsense this must not do.
  let called = false;
  const out = await areas.deriveAreas({
    profile: { offer: '6 month real estate course' },
    ask: async () => { called = true; return [{ key: 'time_availability', label: 'Time availability' }]; },
  });
  assert.deepStrictEqual(out.areas, []);
  assert.strictEqual(out.reason, 'no_material');
  assert.strictEqual(called, false);
});

test('a short offer IS enough once the criteria or script say what it requires', async () => {
  // The bar is about knowing what the offer demands of a buyer, not length for
  // its own sake — qualification criteria supply exactly that.
  const out = await areas.deriveAreas({
    profile: { offer: '6 month real estate course', qualifications: RICH.qualifications },
    ask: async () => [{ key: 'financial_position', label: 'Financial position' }],
  });
  assert.strictEqual(out.areas.length, 1);
  assert.strictEqual(out.reason, null);
});

test('a SUBSTANTIAL offer alone is enough', async () => {
  const out = await areas.deriveAreas({
    profile: { offer: RICH.offer.repeat(2) },
    ask: async () => [{ key: 'current_setup', label: 'Current setup' }],
  });
  assert.strictEqual(out.areas.length, 1);
});

test('a single usable field is enough to derive from', async () => {
  const out = await areas.deriveAreas({
    profile: { qualifications: RICH.qualifications },
    ask: async () => [{ key: 'financial_position', label: 'Financial position' }],
  });
  assert.strictEqual(out.areas.length, 1);
  assert.strictEqual(out.reason, null);
});

// ─── shape + sanitation: the model's output is never trusted raw ───────────

test('area keys are normalised to stable snake_case ids', async () => {
  // The key is a JOIN KEY — 7e filters stored moments on it. Free-form keys
  // would silently stop matching the moment library after any re-derivation.
  const out = await areas.deriveAreas({
    profile: RICH,
    ask: async () => [{ key: 'Current Setup!', label: 'Current setup' }, { key: 'income-goal', label: 'Income goal' }],
  });
  assert.deepStrictEqual(out.areas.map(a => a.key), ['current_setup', 'income_goal']);
});

test('malformed entries are dropped, not repaired into something invented', async () => {
  const out = await areas.deriveAreas({
    profile: RICH,
    ask: async () => [
      { key: 'good_one', label: 'Good one' },
      { key: '', label: 'no key' },
      { label: 'missing key entirely' },
      { key: 'no_label' },
      'not an object',
      null,
    ],
  });
  assert.deepStrictEqual(out.areas.map(a => a.key), ['good_one']);
});

test('duplicate keys collapse to one', async () => {
  const out = await areas.deriveAreas({
    profile: RICH,
    ask: async () => [{ key: 'income_goal', label: 'Income goal' }, { key: 'Income Goal', label: 'Income goal again' }],
  });
  assert.strictEqual(out.areas.length, 1);
});

test('the area list is CAPPED — an unbounded rubric is unusable coaching', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ key: 'area_' + i, label: 'Area ' + i }));
  const out = await areas.deriveAreas({ profile: RICH, ask: async () => many });
  assert.ok(out.areas.length <= areas.MAX_AREAS, 'expected <= ' + areas.MAX_AREAS + ', got ' + out.areas.length);
});

test('a model failure degrades to silence, never throws', async () => {
  const out = await areas.deriveAreas({ profile: RICH, ask: async () => { throw new Error('anthropic 429'); } });
  assert.deepStrictEqual(out.areas, []);
  assert.strictEqual(out.reason, 'derivation_failed');
});

test('a non-array model response degrades to silence', async () => {
  for (const junk of [null, undefined, 'text', 42, {}]) {
    const out = await areas.deriveAreas({ profile: RICH, ask: async () => junk });
    assert.deepStrictEqual(out.areas, [], 'junk response: ' + JSON.stringify(junk));
  }
});

// ─── cache key: material changes must invalidate ───────────────────────────

test('the cache key changes when ANY source field changes', () => {
  const base = areas.materialHash(RICH);
  assert.notStrictEqual(base, areas.materialHash(Object.assign({}, RICH, { offer: RICH.offer + ' extra' })));
  assert.notStrictEqual(base, areas.materialHash(Object.assign({}, RICH, { qualifications: 'different' })));
  assert.notStrictEqual(base, areas.materialHash(Object.assign({}, RICH, { script_raw: 'different' })));
  assert.strictEqual(base, areas.materialHash(Object.assign({}, RICH)), 'identical material must hash identically');
});

test('the hash ignores fields that are not usable material', () => {
  // Otherwise a demo "Ava" offer being edited to "Ben" would churn the cache
  // and re-derive for a user who legitimately gets no areas at all.
  assert.strictEqual(areas.materialHash({ offer: 'Ava' }), areas.materialHash({ offer: 'Ben' }));
});

// ─── ruling: coaching-only, never selling context ──────────────────────────

test('RULING GUARD: coaching areas are absent from the grader context categories', () => {
  // The mirror of kb-hash-guard for KB ruling 1. If a future change routes the
  // area list into fetchSellingContext, the grader would be told the rep's own
  // coverage rubric is material it must not penalise — marking its own homework.
  const selling = require('../lib/selling-context');
  const cats = []
    .concat(selling.GRADER_CATEGORIES || [])
    .concat(selling.SYNTHESIS_CATEGORIES || []);
  assert.ok(cats.length > 0, 'category lists not exported — this guard would pass vacuously');
  assert.ok(cats.indexOf(areas.AREA_CATEGORY) === -1,
    'coaching areas must never be a selling-context category (KB ruling 1)');
});

test('RULING GUARD: the module does not IMPORT selling-context', () => {
  // Checks the require, not the word: the header comment explains this ruling
  // at length and must stay. The risk is the code coupling, not the prose.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coaching-areas.js'), 'utf8');
  assert.ok(!/require\(['"][^'"]*selling-context['"]\)/.test(src),
    'coaching-areas must not reach into selling-context — the coupling is the risk');

  // And the reverse direction, which is the one that would actually breach
  // ruling 1: selling-context must not pull coaching areas into the grader.
  const sellingSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'selling-context.js'), 'utf8');
  assert.ok(!/require\(['"][^'"]*coaching-areas['"]\)/.test(sellingSrc),
    'selling-context must never import coaching areas — that is KB ruling 1 breached');
});
