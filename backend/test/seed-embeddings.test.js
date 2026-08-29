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

/* ⚠⚠ ENUMERATE BY CAPABILITY, NOT BY A HARDCODED LIST. The question is not
   "are these four named files fixed" — it is "does anything that WRITES to
   knowledge_base do so without an embedding". A list goes stale the moment
   someone adds a seed script; this predicate catches it automatically.

   ⚠ AND IT IS WHAT CORRECTED MY OWN FILING. The previous block reported "all
   five seed scripts had zero embedding references", which was true and
   misleading: two are 2-line dead stubs and a third only DELETES. Counting
   files that lack a reference is not the same as counting files that write
   blind rows, and only the second is a defect. */
test('every script that WRITES to knowledge_base embeds what it writes', () => {
  const dir = path.join(ROOT, 'scripts');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 4, 'no scripts found — the check is not measuring');

  const writers = files.filter(f => {
    const src = code(path.join(dir, f));
    return /\.from\(['"]knowledge_base['"]\)[\s\S]{0,120}\.insert\(/.test(src);
  });
  assert.ok(writers.length >= 1, 'no writers found — the predicate is broken, not the scripts');

  const blind = writers.filter(f => !/getVoyageEmbeddings/.test(code(path.join(dir, f))));
  assert.deepStrictEqual(blind, [],
    'these write knowledge_base rows with no embedding — present in the table and '
    + 'permanently invisible to similarity search: ' + blind.join(', '));
});

/* ⚠ The three that do NOT write are recorded here so nobody "fixes" them and so
   the distinction survives: two are retired stubs, one only clears. */
test('the non-writing scripts are non-writing for a stated reason', () => {
  const dir = path.join(ROOT, 'scripts');
  ['seed-client-ssi.js', 'seed-client-globalbanks.js'].forEach(f => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(/no longer used/i.test(src), f + ' should say it is retired');
    assert.ok(!/\.insert\(/.test(code(path.join(dir, f))), f + ' must not write');
  });
  const clear = code(path.join(dir, 'clear-and-reseed.js'));
  assert.ok(/\.delete\(\)/.test(clear), 'clear-and-reseed should delete');
  assert.ok(!/\.insert\(/.test(clear), 'clear-and-reseed must not insert — it only clears');
});
