'use strict';
/* ⑤ DEAD COMPUTATIONS AND DEAD CSS in web/dashboard.html.
   Functions: every `  function name(` / `  async function name(` at two-space
   indent in the inline scripts. A reference is ANY occurrence of the bare
   identifier outside its own definition, in stripped code — this covers calls,
   callbacks (`.map(fn)`), `setTimeout(fn, …)`, `onclick="fn(...)"` strings and
   `window.fn =`. It does NOT cover names built from strings (`window['f' + x]`)
   — stated as the claim's limit; review checks for that.
   CSS classes: every `.class` in the <style> block; a reference is the bare
   class name anywhere in the stripped markup/JS after </style>, including
   inside string-built class attributes and admin.html/login.html (which share
   nothing with this stylesheet today, checked, but scanned anyway).
   ⚠ The first version counted only `name(` and was wrong by 61% — recorded. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
function analyse(html, extraMarkup) {
  const code = stripComments(html);
  /* EVERY <style> block (the first version read only the first — the same defect
     ④(b) had; P6 pins it). `rest` is everything that is not a style block. */
  const css = [...code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const rest = code.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '') + (extraMarkup || '');
  const fns = [...code.matchAll(/^\s{2}(?:async )?function ([A-Za-z0-9_]+)\(/gm)].map((m) => m[1]);
  const deadFns = fns.filter((n) => ((code.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length - 1) === 0);
  const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))].filter((c) => !/^\d/.test(c));
  const deadClasses = classes.filter((c) => !new RegExp('(^|[^\\w-])' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(rest));
  /* A class whose PREFIX is built in a string (`'eod-chip-' + band`, `'kb-cat-' + c`,
     `' + grade + '` for .A/.B/.C) is used INDIRECTLY and cannot be called dead by
     this detector — it is listed separately as `dynamic` (N6 pins it). The
     single-letter grade classes are matched through `review-grade-letter ' +`. */
  const dynamic = deadClasses.filter((c) => {
    const parts = c.split(/(?<=-)/); let pre = '';
    for (let i = 0; i < parts.length - 1; i++) { pre += parts[i]; if (new RegExp("'[^']*" + pre.replace(/-/g, '\\-') + "'\\s*\\+").test(rest)) return true; }
    return /^[A-F]$/.test(c) && /grade-letter ' \+/.test(rest);
  });
  const trulyDead = deadClasses.filter((c) => !dynamic.includes(c));
  /* Bytes: what removing them would buy, against the file and its comment-stripped size. */
  const ruleBytes = trulyDead.reduce((n, c) => n + [...css.matchAll(new RegExp('[^{}]*\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])[^{}]*\\{[^}]*\\}', 'g'))].reduce((m, x) => m + x[0].length, 0), 0);
  const fnBytes = deadFns.reduce((n, f) => { const at = code.search(new RegExp('^\\s{2}(?:async )?function ' + f + '\\(', 'm')); if (at < 0) return n; const end = code.indexOf('\n  }\n', at); return n + (end > at ? end - at + 4 : 0); }, 0);
  /* Inverse: classes referenced in markup (`class="…"` literals in the page) with NO rule — a
     control that lost its styling renders here, not in the dead list. Utility hooks used by
     JS selectors (`querySelector('.x')`, `closest('.x')`) are excluded. */
  const used = new Set(); [...rest.matchAll(/class="([^"']*)/g)].forEach((m) => m[1].split(/\s+/).forEach((t) => { if (/^[a-zA-Z][\w-]*$/.test(t)) used.add(t); }));
  const ruleSet = new Set(classes);
  const unstyled = [...used].filter((t) => !ruleSet.has(t) && !new RegExp("(querySelector(All)?|closest|matches)\\(['\"][^'\"]*\\." + t.replace(/-/g, '\\-') + "(?![\\w-])").test(rest) && !/^(hidden|active|open|selected|is-|has-)/.test(t));
  return { fns: fns.length, deadFns, classes: classes.length, deadClasses: trulyDead, dynamic, bytes: { deadFunctions: fnBytes, deadCss: ruleBytes, file: html.length, stripped: code.length }, unstyled };
}
function score() {
  const html = fs.readFileSync(path.join(__dirname, 'planted', 'dead-code.html'), 'utf8');
  const r = analyse(html, '<div class="lc-admin"></div>');
  const expect = { deadFns: ['deadOne', 'deadTwo', 'deadThree', 'deadFour', 'deadFive'], liveFns: ['viaOnclick', 'viaTimeout', 'viaMap', 'viaWindow', 'viaDirect'],
                   deadClasses: ['dc-one', 'dc-two', 'dc-three', 'dc-four', 'dc-five', 'dc-six'], liveClasses: ['lc-markup', 'lc-string', 'lc-classlist', 'lc-template', 'lc-attr', 'dyn-good', 'lc-admin'] };
  return { functions: { caught: expect.deadFns.filter((n) => r.deadFns.includes(n)).length + '/5', falsePositives: expect.liveFns.filter((n) => r.deadFns.includes(n)).length + '/5' },
           classes: { caught: expect.deadClasses.filter((n) => r.deadClasses.includes(n)).length + '/' + expect.deadClasses.length, falsePositives: expect.liveClasses.filter((n) => r.deadClasses.includes(n)).length + '/' + expect.liveClasses.length },
           flagged: { fns: r.deadFns, classes: r.deadClasses } };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score(), null, 1)); process.exit(0); }
  const html = fs.readFileSync('web/dashboard.html', 'utf8');
  const extra = ['web/admin.html', 'web/login.html'].map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n');
  const r = analyse(html, extra);
  console.log(JSON.stringify({ functions: r.fns, deadFunctions: r.deadFns.length, classes: r.classes, deadClasses: r.deadClasses.length }));
  console.log('DEAD FUNCTIONS: ' + r.deadFns.join(', '));
  console.log('DEAD CLASSES: ' + r.deadClasses.join(', '));
  console.log('DYNAMIC (indirect, not dead by this detector): ' + r.dynamic.join(', '));
  console.log('BYTES ' + JSON.stringify(r.bytes));
  console.log('UNSTYLED (in markup, no rule, no JS hook): ' + r.unstyled.join(', '));
  if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 1));
}
module.exports = { analyse, score };
