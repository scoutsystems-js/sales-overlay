'use strict';
/* Detectors run on the COMMENT-STRIPPED source, so their line numbers are
   stripped-line numbers — not the line a reader opens in the editor. This
   maps a stripped line back to the raw file by finding the same trimmed text
   in the raw lines, scanning forward from the previous match so repeated
   lines resolve in order. Returns the raw 1-based line, or null when the
   stripped line's text is not found verbatim (a line that had a trailing
   comment removed) — callers print `raw≈` from the nearest earlier match. */
function mapper(rawSrc, strippedSrc) {
  const raw = rawSrc.split('\n').map((l) => l.trim()); const stripped = strippedSrc.split('\n').map((l) => l.trim());
  let cursor = 0; const memo = {};
  return function rawLine(strippedLine) {
    if (memo[strippedLine] !== undefined) return memo[strippedLine];
    for (let s = 1; s <= strippedLine; s++) {
      if (memo[s] !== undefined) { cursor = memo[s]; continue; }
      const text = stripped[s - 1]; let found = null;
      if (text) { for (let r = cursor; r < raw.length; r++) { if (raw[r] === text || (raw[r].startsWith(text) && /^\s*(\/\/|\/\*)/.test(raw[r].slice(text.length)))) { found = r + 1; cursor = r + 1; break; } } }
      memo[s] = found;
    }
    return memo[strippedLine];
  };
}
module.exports = { mapper };
