'use strict';
/* ⚠ LINE COMMENTS FIRST, THEN BLOCK — leading and trailing. This codebase
   archives removed code in place, so a raw match reports the documentation of
   a rule as a violation of it. Strip for MATCHING; run the raw source for
   EXECUTION. */
/* ⚠⚠ THE ONE STRIPPER (fix #5, H682). 112 private copies were routed through this
   on 2026-09-02; everything inherits it, so its own defect was fixed first: the
   block pass used to open on a slash-star INSIDE A STRING ('/*' in a data URI, a
   prompt line, a version note) and swallow code up to the next star-slash (sweep
   ②-4, K4 — ten such literals exist in product source). The block pass now skips
   single-line string literals (double, single, template) so a slash-star inside one
   is text, not a comment. Line comments first, then blocks (H131) — a `/*` at the
   end of a line comment (`/admin/*`, dashboard.html:6136) is never seen by the block
   pass, which is what blinded eleven copies to 42 lines. An apostrophe in prose
   only shields the rest of ITS line (strings never span lines here), so it can leak
   a comment on that line but can never lose code — the safe direction.
   Scored against the five killers in sweep/detect-stripper-copies.js and verified on
   dashboard.html (the inline script still parses, 549 functions, zero code lines
   lost against the reference tokenizer). */
function stripComments(src) {
  const noLine = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return noLine.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`)|\/\*[\s\S]*?\*\//g, function (m, str) { return str ? str : ''; });
}
/* The body of `function NAME(` by brace matching from its first `{`. Throws when
   the function is not found, so a renamed function fails loudly instead of
   silently passing an empty body. */
function fnBody(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('function ' + name + ' not found');
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('function ' + name + ' never closes');
}
module.exports = { stripComments, fnBody };
