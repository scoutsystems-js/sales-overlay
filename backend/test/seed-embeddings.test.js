/**
 * A SEED SCRIPT THAT WRITES ROWS WITH NO EMBEDDING IS A CODE FAULT, NOT A DATA
 * ONE. `scripts/seed-frameworks.js` wrote 170 framework rows on 6 April with
 * `embedding: null`, which leaves them present in the table and PERMANENTLY
 * INVISIBLE to similarity search. Those rows were backfilled on 2026-08-29 —
 * and without this, the next seed would simply have recreated the gap.
 *
 * ⚠ The point of the guard is that a data fix must not stand in for a code fix.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SEED = path.join(ROOT, 'scripts', 'seed-frameworks.js');

function code(p) {
  return fs.readFileSync(p, 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the framework seed embeds what it writes', () => {
  const src = code(SEED);
  assert.ok(src.length > 500, 'seed script slice too short: ' + src.length);
  assert.ok(/getVoyageEmbeddings/.test(src), 'it must embed, not insert bare rows');
  assert.ok(/embedding: vectors\[i\] \|\| null/.test(src),
    'the vector must reach the inserted row');
});

test('⚠ it REFUSES to seed without the capability, and says why', () => {
  /* Opposite of the live path's rule, deliberately: there a row must still be
     written unembedded rather than lost. Here nothing is lost by stopping — the
     seed can be re-run — and writing rows nobody can find is the whole defect. */
  const src = code(SEED);
  assert.ok(/embeddingCapability\(\)/.test(src), 'it must check the capability');
  assert.ok(/REFUSING TO SEED/.test(src), 'and refuse loudly rather than degrade');
  assert.ok(/--no-embeddings/.test(src), 'with an explicit escape for anyone who wants it');
});

test('ONE batched request, not one per row', () => {
  const src = code(SEED);
  const calls = (src.match(/getVoyageEmbeddings\(/g) || []).length;
  assert.strictEqual(calls, 1, 'a per-row loop is what rate-limits; found ' + calls);
});

test('an unembedded row is REPORTED rather than passing silently', () => {
  const src = code(SEED);
  assert.ok(/unembedded > 0/.test(src),
    'the only moment an unembedded row is visible is at write time — say so');
});

/* ⚠⚠ THE OTHER FOUR SEED SCRIPTS SHARE THE FAULT AND ARE FILED, NOT FIXED.
   This test PINS the list, so a future session finds a failing check naming
   them rather than rediscovering the gap. Fixing one and moving the count down
   is the intended way to retire it. */
test('the remaining seed scripts that still write unembedded rows are pinned', () => {
  const unfixed = ['clear-and-reseed.js', 'seed-client-globalbanks.js',
                   'seed-client-ssi.js', 'seed-knowledge-base.js'];
  const still = unfixed.filter(f => {
    const p = path.join(ROOT, 'scripts', f);
    if (!fs.existsSync(p)) return false;
    return !/getVoyageEmbeddings/.test(code(p));
  });
  assert.deepStrictEqual(still.sort(), unfixed.sort(),
    'a seed script changed state — update this list and the BUILD-LIST row together');
});
