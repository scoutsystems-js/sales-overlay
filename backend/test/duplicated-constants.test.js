'use strict';
/**
 * ⚠⚠ CONSTANTS THAT NOTHING FORCED TO AGREE (sweep ③-4…③-7, fixed 2026-09-02, H685).
 *
 * Four pairs were typed twice and agreed by coincidence. Drift there is silent:
 * a class added to one copy moves the needs-work RATE (which is deliberately
 * note-free); a highlight type coached on but refused as evidence, or anchored
 * by the worker but not badged on the review page, drifts by omission; a chunk
 * literal edited to 500 fails outright at the ~395-id URL ceiling; a ranked view
 * offered for one widget and not its bar twin renders nothing.
 *
 * Where a shared import is possible the pin is IDENTITY (`===`) — a retyped
 * literal that happens to agree still fails. Where it is not (the page cannot
 * import), the page's literal is EXECUTED and compared as a set.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('③-4 needs-work reads the v37 objection classes from objection-strict — the same array', () => {
  const strict = require('../lib/objection-strict');
  const nw = require('../lib/team-needs-work');
  assert.ok(Array.isArray(strict.OBJECTION_CLASSES) && strict.OBJECTION_CLASSES.length >= 3, 'floor: the class set exists');
  assert.strictEqual(nw.BUCKET_CLASSES, strict.OBJECTION_CLASSES, 'BUCKET_CLASSES must BE OBJECTION_CLASSES (identity), not a copy of it');
});

test('③-5 the coachable set IS the evidence rule\'s negative set — the same array', () => {
  const er = require('../lib/evidence-rule');
  const co = require('../lib/coaching');
  assert.ok(er.NEGATIVE_TYPES.length >= 5, 'floor: the negative set exists');
  assert.strictEqual(co.COACHABLE_TYPES, er.NEGATIVE_TYPES, 'COACHABLE_TYPES must BE NEGATIVE_TYPES (identity)');
});

test('③-5 the review page\'s HANDLING_TYPES executes to the worker\'s PROSPECT_POSITION_TYPES, as a set', () => {
  const worker = require('../lib/analysis-worker');
  const page = stripComments(read('web/dashboard.html'));
  const m = page.match(/var HANDLING_TYPES = (\[[^\]]*\]);/);
  assert.ok(m, 'the page must declare HANDLING_TYPES as a literal');
  const pageSet = new Function('return ' + m[1])();
  assert.ok(Array.isArray(worker._PROSPECT_POSITION_TYPES) && worker._PROSPECT_POSITION_TYPES.length >= 3, 'floor: the worker set exists');
  assert.deepStrictEqual([...pageSet].sort(), [...worker._PROSPECT_POSITION_TYPES].sort(),
    'a type anchored by the worker must be badged on the review page, and vice versa');
  // both sites read the set with indexOf, so order is not load-bearing at either — asserted here so a reorder is not mistaken for drift
  assert.ok(/HANDLING_TYPES\.indexOf\(/.test(page), 'the page reads the set by membership');
  assert.ok(/PROSPECT_POSITION_TYPES\.indexOf\(/.test(stripComments(read('lib/analysis-worker.js'))), 'the worker reads the set by membership');
});

test('③-7 by_rep and bar_rep are ONE array — identity, not two lists that agree', () => {
  const C = require('../lib/widget-catalog');
  assert.ok(C._RENDERABLE.by_rep.length >= 5, 'floor: the ranked set exists');
  assert.strictEqual(C._RENDERABLE.by_rep, C._RENDERABLE.bar_rep, 'the two keys must point at the same array');
});

/* ③-6 — enumerated BY CAPABILITY: every `slice(i, i + N)` in lib/ and routes/ (the
   shape every chunked `.in()` uses) must name CHUNK; no loop steps by a literal
   chunk; every file that uses CHUNK requires it OUTSIDE a comment; and the value
   stays under the measured ceiling. */
function sources(dir) {
  return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js'))
    .map((f) => ({ rel: dir + '/' + f, src: stripComments(read(dir + '/' + f), { trailing: true }) }));
}
test('③-6 CHUNK is under the measured ~395-id ceiling', () => {
  const { CHUNK } = require('../lib/chunk');
  assert.ok(Number.isInteger(CHUNK) && CHUNK > 0, 'CHUNK is a positive integer');
  assert.ok(CHUNK <= 390, 'CHUNK must stay at or under 390 — 400 ids in one .in() failed outright (H663); got ' + CHUNK);
});
test('③-6 every slice(i, i + N) in lib/ and routes/ names CHUNK, and every user requires it', () => {
  const files = sources('lib').concat(sources('routes'));
  const literal = [];
  let named = 0;
  const users = [];
  for (const { rel, src } of files) {
    const re = /\.slice\(\s*(\w+)\s*,\s*\1\s*\+\s*([A-Za-z_$][\w$]*|\d+)\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      if (/^\d+$/.test(m[2])) literal.push(rel + ': ' + m[0]);
      else if (m[2] === 'CHUNK') named++;
    }
    // loop HEADERS only — a score's `s += 10` is not a chunk; 1000 is the row-cap page, a different constant
    const steps = src.match(/for \([^)]*\+=\s*\d{2,}\b[^)]*\)/g) || [];
    for (const s of steps) if (!/\+=\s*1000\b/.test(s)) literal.push(rel + ': loop steps by ' + s);
    // `CHUNK` the identifier — not CHUNK_WORDS, CONTEXT_CHUNK_WORDS or a CHUNKED comment (comments are stripped)
    if (rel !== 'lib/chunk.js' && /(?<![\w$])CHUNK(?![\w$])/.test(src)) users.push({ rel, src });
  }
  assert.ok(named >= 20, 'floor: the chunked sites exist (' + named + ' named slices)');
  assert.deepStrictEqual(literal, [], 'a chunk size typed as a literal:\n' + literal.join('\n'));
  const missing = users.filter(({ src }) => !/require\(['"](\.\.\/lib|\.)\/chunk['"]\)/.test(src)).map((u) => u.rel);
  assert.ok(users.length >= 13, 'floor: ' + users.length + ' files use CHUNK');
  assert.deepStrictEqual(missing, [], 'uses CHUNK without requiring it outside a comment');
});
