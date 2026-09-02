'use strict';
/* ⚠ LINE COMMENTS FIRST, THEN BLOCK — leading and trailing. This codebase
   archives removed code in place, so a raw match reports the documentation of
   a rule as a violation of it. Strip for MATCHING; run the raw source for
   EXECUTION. */
function stripComments(src) {
  const noLine = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
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
