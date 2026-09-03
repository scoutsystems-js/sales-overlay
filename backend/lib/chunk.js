/* ⚠⚠ THE ONE CHUNK SIZE FOR EVERY `.in()` ID LIST (③-6, 2026-09-02).
 *
 * An unchunked `.in()` fails OUTRIGHT above ~395 ids — the URL length, not the
 * 1,000-row cap (measured 2026-09-02: 390 ok, 400 `fetch failed`, no PostgREST
 * error object; H663). Twenty-three sites in thirteen files carried the literal
 * 100 by hand (one carried 50) and nothing forced them to agree; a single site
 * edited to 500 would fail at the ceiling with nothing else changing.
 *
 * Pinned by test/duplicated-constants.test.js: every `slice(i, i + N)` in lib/
 * and routes/ names this constant, no loop steps by a literal, and the value
 * stays under the measured ceiling. */
var CHUNK = 100;

module.exports = { CHUNK: CHUNK };
