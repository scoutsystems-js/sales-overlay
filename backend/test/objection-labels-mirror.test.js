// Guards for the ONE-SOURCE objection category naming (Justin's ruling 2026-08-26).
//
// Two schemes were live and disagreed about the same metric. The fix is a single
// canonical list in lib/objection-categories.js, mirrored inline in dashboard.html
// because a browser file cannot require(). THE MIRROR IS THE RISK, so it is guarded
// rather than trusted — same pattern as section-breakdown-mirror and tile-metrics-mirror.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const cats = require('../lib/objection-categories');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
const NEEDS = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-needs-work.js'), 'utf8');

// ⚠ LINE comments FIRST, then block comments. A block-comment opener sitting inside
// a line comment is a false opener that pairs with the next real closer and swallows
// real code — that latent bug sat in eleven guards in this repo.
function stripComments(src) {
  const noLine = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}

function slice(src, from, to, floor) {
  const a = src.indexOf(from);
  assert.ok(a !== -1, 'stale anchor: ' + from);
  const b = src.indexOf(to, a);
  assert.ok(b !== -1, 'stale end anchor: ' + to);
  const out = src.slice(a, b);
  assert.ok(out.length >= floor, 'slice too short (' + out.length + ') — a backwards slice tests nothing');
  return out;
}

test('the canonical list matches the Coaching Review, in its order', () => {
  // ⚠ Justin, 2026-08-26: the TEAM view moved to match the Coaching Review, not
  // the other way round. Order is load-bearing — two lists with the same names in
  // different orders still read as a difference.
  assert.deepStrictEqual(
    cats.OBJECTION_CATEGORIES.map(c => c.label),
    ['Fear', 'Logistical', 'Timing', 'Partner', 'Other']
  );
});

test('dashboard mirror matches the lib exactly', () => {
  const block = slice(HTML, 'var OBJECTION_CATEGORIES = [', '];', 120);
  cats.OBJECTION_CATEGORIES.forEach(c => {
    assert.ok(
      new RegExp("key:\\s*'" + c.key + "'\\s*,\\s*label:\\s*'" + c.label.replace('/', '\\/') + "'").test(block),
      'dashboard mirror has drifted from lib/objection-categories.js for: ' + c.key + ' / ' + c.label
    );
  });
  // and nothing extra
  assert.strictEqual((block.match(/key:/g) || []).length, cats.OBJECTION_CATEGORIES.length,
    'the mirror has a different number of categories from the lib');
});

test('every label fits the 30-char cap that truncated the live page', () => {
  // "Needs To Consult Spouse/Partne" reached production because a model-invented
  // 31-char label was cut mid-word by str(label, 30). Short fixed names make that
  // impossible — this asserts it rather than assuming it.
  cats.OBJECTION_CATEGORIES.forEach(c => {
    assert.ok(c.label.length <= 30, c.label + ' would truncate');
  });
});

test('the retired label spellings are gone from the render path', () => {
  const live = stripComments(HTML);
  ['Fear / money', 'Partner / spouse', 'Uncategorised'].forEach(old => {
    assert.strictEqual(live.split(old).length - 1, 0,
      'retired label still in the render path: ' + old);
  });
});

test('objectionLabel is total — null, unknown and legacy spellings all resolve', () => {
  [null, undefined, '', 'zzz', 'uncategorized', 'uncategorised'].forEach(k => {
    assert.strictEqual(cats.objectionLabel(k), 'Other', 'unresolved: ' + JSON.stringify(k));
  });
  assert.strictEqual(cats.objectionLabel('partner'), 'Partner');
  assert.strictEqual(cats.objectionLabel('FEAR'), 'Fear');
});

test('other is NOT a stored category — this is what makes it a rename, not a migration', () => {
  assert.ok(cats.STORED_OBJECTION_CATEGORIES.indexOf('other') === -1,
    'adding "other" to the stored set would require migrating the CHECK constraint');
  assert.deepStrictEqual(cats.STORED_OBJECTION_CATEGORIES.slice().sort(),
    ['fear', 'logistical', 'partner', 'timing']);
});

test('the extractor carries Justin\'s boundary and no longer contradicts it', () => {
  const prompt = slice(WORKER, '- objection_category: exactly one of', '- resolution: exactly one of', 400);
  assert.ok(/CANNOT AFFORD IT/.test(WORKER), 'the affordability test is missing from the extractor');
  assert.ok(/disqualify_signal/.test(WORKER), 'the DQ redirect target is missing');
  assert.ok(/WILLING BUT UNABLE/.test(WORKER), 'the one-line discriminator is missing');
  assert.ok(/CAN afford it and is hesitating/.test(prompt), 'fear is not defined by ability-plus-hesitation');
  assert.ok(/PHYSICALLY CANNOT/.test(prompt), 'logistical is not defined as an external blocker');
  assert.ok(/must consult SOMEONE ELSE/.test(prompt), 'partner is not defined by the need to consult');
});

test('the bucketer uses the canonical vocabulary, not invented labels', () => {
  const live = stripComments(NEEDS);
  assert.ok(/objectionCats = require\('\.\/objection-categories'\)/.test(live),
    'team-needs-work does not import the canonical list');
  assert.ok(/canonicalKeyForLabel/.test(live), 'the label coercion is missing');
  // The old free-invention instruction must be gone from the prompt.
  assert.ok(!/Give each a short human label/.test(live),
    'the bucketer still invents its own labels — that is how the two schemes diverged');
  assert.ok(/CLASSIFICATION_GUIDANCE/.test(live),
    'the bucketer does not receive the shared boundary');
});

test('the shared boundary states all four cases', () => {
  const g = cats.CLASSIFICATION_GUIDANCE;
  assert.ok(/cannot afford/i.test(g), 'missing the affordability case');
  assert.ok(/DISQUALIFICATION/.test(g), 'missing the DQ verdict');
  assert.ok(/logistical/.test(g), 'missing the external-blocker case');
  assert.ok(/fear/.test(g), 'missing the hesitation case');
  assert.ok(/partner/.test(g), 'missing the consult-someone case');
  assert.ok(/EXCUSE IS NOT THE CLASSIFICATION/.test(g), 'missing the excuse rule');
});

test('the coercion maps every label the live page currently shows', () => {
  // ⚠ These are the REAL labels the bucketer invented and rendered in production,
  // including the mid-word truncation Justin reported. The model is now told to
  // emit only canonical names, so this path is a SAFETY NET — but a net that sent
  // "Trust / Proof / Skepticism" to Other would silently contradict Justin's
  // explicit ruling that it is fear.
  const src = slice(NEEDS, 'function canonicalKeyForLabel', '\nasync function getBucketMapping', 600);
  const keyFor = new Function('objectionCats', src + '\n; return canonicalKeyForLabel;')(cats);
  const expected = [
    ['Trust / Proof / Skepticism', 'Fear'],          // Justin's explicit mapping
    ['Price / too expensive', 'Fear'],               // price folds into fear by default
    ['Needs To Consult Spouse/Partne', 'Partner'], // the truncated live label
    ['Needs To Consult Spouse/Partner', 'Partner'],
    ['Needs More Time / Stalling', 'Timing'],
    ['Payment failure', 'Logistical'],
    ['card declined', 'Logistical'],
    ['Fear', 'Fear'], ['Logistical', 'Logistical'], ['Other', 'Other'],
    ['total garbage', 'Other'], [null, 'Other'], ['', 'Other'],
  ];
  expected.forEach(([input, want]) => {
    assert.strictEqual(cats.objectionLabel(keyFor(input)), want,
      JSON.stringify(input) + ' should map to ' + want);
  });
});

test('no emitted label can reach the 30-char cut that truncated the live page', () => {
  const src = slice(NEEDS, 'function canonicalKeyForLabel', '\nasync function getBucketMapping', 600);
  const keyFor = new Function('objectionCats', src + '\n; return canonicalKeyForLabel;')(cats);
  ['Needs To Consult Spouse/Partner', 'a'.repeat(120), 'Trust / Proof / Skepticism', null]
    .forEach(input => {
      const out = cats.objectionLabel(keyFor(input));
      assert.ok(out.length <= 30 && out.length > 0, 'emitted label was ' + out.length + ' chars');
    });
  // and the truncating call itself is gone from the module
  assert.ok(!/str\(bk && bk\.label/.test(stripComments(NEEDS)),
    'the label truncation is back — that is what produced "Spouse/Partne"');
});

test('the Coaching Review derives its category list — it does not keep its own', () => {
  // ⚠⚠ THE WHOLE POINT. The two surfaces diverged because each had its own copy;
  // the earlier sweep unified three maps in the team area and MISSED these three
  // in the Coaching Review, which is why they still disagreed. Assert the
  // DERIVATION, not the resulting strings — a literal list that happens to match
  // today is exactly how this drifts again.
  const live = stripComments(HTML);
  assert.ok(/var cats = OBJ_DRILL_ORDER\.map/.test(live),
    'the By Category table still holds its own [key,label] pairs');
  assert.ok(/var order = OBJ_DRILL_ORDER;/.test(live),
    'the objection feed still holds its own order');
  assert.ok(/var labels = OBJ_DRILL_LABELS;/.test(live),
    'the objection feed still holds its own labels');
  assert.ok(/var labelMap = OBJECTION_LABEL;/.test(live),
    'objSynthSection still holds its own labelMap');
  // ⚠ And exactly ONE place spells the labels out — the mirror itself. Written
  // against the mirror's real shape (key/label pairs); an earlier draft of this
  // assertion used a pattern the mirror does not use, so it matched nothing and
  // was checking nothing.
  assert.strictEqual((live.match(/label:\s*'Fear'/g) || []).length, 1,
    'more than one place spells out the category labels');
  assert.strictEqual((live.match(/label:\s*'Partner'/g) || []).length, 1,
    'more than one place spells out the category labels');
});

test('both surfaces render the same names in the same ORDER', () => {
  // Order is load-bearing: same words in a different sequence still reads as a
  // difference. Executing the real derivations rather than trusting the source.
  const slicePart = (from, to) => {
    const a = HTML.indexOf(from); assert.ok(a !== -1, 'stale anchor: ' + from);
    const b = HTML.indexOf(to, a); assert.ok(b !== -1, 'stale end anchor: ' + to);
    const out = HTML.slice(a, b);
    assert.ok(out.length > 80, 'slice too short: ' + out.length);
    return out;
  };
  const src = [
    slicePart('var OBJECTION_CATEGORIES = [', 'var OBJECTION_CATEGORY_OPTIONS'),
    slicePart('var OBJECTION_CATEGORY_OPTIONS = [', '// ⚠ TOGGLEABLE'),
    slicePart('var OBJ_DRILL_ORDER = OBJECTION_CATEGORIES', 'function renderTeamObjectionsView'),
  ].join('\n');
  const r = new Function(src + '; return { OBJ_DRILL_ORDER, OBJ_DRILL_LABELS };')();
  const rendered = r.OBJ_DRILL_ORDER.map(k => r.OBJ_DRILL_LABELS[k]);
  assert.deepStrictEqual(rendered, ['Fear', 'Logistical', 'Timing', 'Partner', 'Other']);
  // the lib agrees, so the mirror cannot drift in order either
  assert.deepStrictEqual(rendered, cats.OBJECTION_CATEGORIES.map(c => c.label));
  // the catch-all keeps its API key while showing the new name
  assert.strictEqual(r.OBJ_DRILL_ORDER[4], 'uncategorized');
  assert.strictEqual(r.OBJ_DRILL_LABELS.uncategorized, 'Other');
});

/* ── every category is listed, including the empty ones ───────────────────────
   Justin, 2026-08-26: the per-closer grid showed FIVE columns while "Handle rate
   by objection type" below it showed THREE, because categories with no
   objections in range were dropped at BOTH ends — built lazily on the server and
   filtered again on the client.

   ⚠ ZERO IS A MEASUREMENT, ABSENCE IS NOT. A missing category reads as "does not
   exist"; 0/0 reads as "nothing came up this period". */

test('the server SEEDS all five buckets rather than building them from what appears', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-objections.js'), 'utf8');
  const live = stripComments(src);
  assert.ok(/CANONICAL_CATEGORIES\.forEach\(function \(c\) \{\s*bucketTotals\[c\.label\]/.test(live),
    'bucketTotals is not seeded — an empty category would never reach the client');
  assert.ok(/require\('\.\/objection-categories'\)/.test(live),
    'team-objections does not read the canonical list');
});

test('the client does NOT filter empty buckets out again', () => {
  const live = stripComments(HTML);
  assert.ok(!/\}\)\.filter\(function \(b\) \{ return b\.total > 0; \}\)/.test(live),
    'the drop-empty filter is back — the list will disagree with the grid above it');
});

test('an empty category sorts LAST and cannot produce NaN', () => {
  // n/0 is NaN, and NaN comparisons make a sort silently incoherent — so the
  // empty rows are separated out rather than ranked against measured ones.
  const src = slice(HTML, 'var brs = (d.bucket_rates', 'bucketRows = ', 400);
  const sortFn = new Function('return ' + src.slice(src.indexOf('function (a, b) {'), src.indexOf('});', src.indexOf('function (a, b) {')) + 1))();
  const measured = { total: 10, handled: 2, credited: 0 };
  const better = { total: 10, handled: 8, credited: 0 };
  const empty = { total: 0, handled: 0, credited: 0 };
  assert.ok(sortFn(measured, better) < 0, 'weakest must sort first');
  assert.ok(sortFn(empty, measured) > 0, 'an empty category must sort after a measured one');
  assert.ok(sortFn(measured, empty) < 0, 'and symmetrically');
  assert.strictEqual(sortFn(empty, empty), 0, 'two empties are equal, not NaN');
  [sortFn(measured, better), sortFn(empty, measured), sortFn(measured, empty)]
    .forEach(v => assert.ok(!Number.isNaN(v), 'sort produced NaN'));
});
