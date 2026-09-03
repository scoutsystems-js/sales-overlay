const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠ POSTGREST CARRIES `.in()` IN THE URL, SO AN UNCHUNKED LIST FAILS ONCE A
   BOARD GROWS — AND `if (err) return {}` MAKES THAT FAILURE INVISIBLE.

   Measured on the live Sober Living board 2026-08-28 (600 call ids, 30 days):
     .in() with 100 ids -> 100 rows
     .in() with 300 ids -> 300 rows
     .in() with 600 ids -> TypeError: fetch failed   (URL ~22,199 chars)

   Every rep card on that board read "0 prospects" and a null close rate while
   the database held 109-254 prospects each. It was reported as ONE rep's card
   being wrong; it was EVERY card, on any board large enough to cross the limit.
   That is why it appeared only as the company grew. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'prospect-entity.js'), 'utf8');
// Strip line comments first (a `/*` inside a `//` line is a false opener), then blocks.
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠ the outcome lookup is CHUNKED, not one .in() over every call id', () => {
  const at = LIVE.indexOf("from('call_analyses')");
  assert.ok(at !== -1, 'the outcome lookup must exist');
  const around = LIVE.slice(Math.max(0, at - 400), at + 400);
  /* ⚠ RE-PINNED 2026-09-02 (③-6, H685): the chunk size is the shared CHUNK constant,
     never a literal — this guard used to pin `100`, which is the drift it now forbids. */
  assert.ok(/\+= CHUNK\b/.test(around) || /slice\(\w+, \w+ \+ CHUNK\)/.test(around),
    'the call_analyses lookup must page in chunks of CHUNK, not pass the whole id list');
  assert.ok(!/\+= 100\b|\+ 100\)/.test(around), 'the old literal form must be absent');
  assert.ok(!/\.in\('fathom_call_id', Object\.keys\(byId\)\)/.test(LIVE),
    'passing every id in one .in() is the defect this guards');
});

test('⚠ a failed lookup is LOGGED, not silently turned into an empty result', () => {
  // Returning {} is still the right answer — a wrong close rate is worse than
  // none — but a silent {} sent everyone looking at the data instead of the query.
  const at = LIVE.indexOf('outcome lookup failed');
  assert.ok(at !== -1, 'the error path must say something');
  const around = LIVE.slice(Math.max(0, at - 200), at + 200);
  assert.ok(/console\.error/.test(around), 'and it must reach the log');
});

test('⚠ the guard is about the SHAPE, so it names the ONE chunk constant the codebase uses', () => {
  // CONVERTED 2026-09-02 (③-6): this used to count `+= 100` literals, so a future
  // edit to 600 "because it is fewer round trips" would fail here — for THIS file
  // only. The constant is now shared (lib/chunk.js) and its ceiling is pinned once,
  // for every site, in test/duplicated-constants.test.js; this file must require it.
  assert.ok(/require\('\.\/chunk'\)/.test(LIVE), 'prospect-entity requires the shared chunk size');
  const chunks = (LIVE.match(/\+= CHUNK\b/g) || []).length;
  assert.ok(chunks >= 1, 'expected at least one CHUNK-sized pager, found ' + chunks);
  assert.strictEqual((LIVE.match(/\+= 100\b/g) || []).length, 0, 'no literal pager remains');
  const { CHUNK } = require('../lib/chunk');
  assert.ok(CHUNK <= 390, 'the shared size stays under the measured ceiling');
});
