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
  const styleA = code.indexOf('<style>'), styleB = code.indexOf('</style>');
  const css = code.slice(styleA, styleB); const rest = code.slice(styleB) + (extraMarkup || '');
  const fns = [...code.matchAll(/^\s{2}(?:async )?function ([A-Za-z0-9_]+)\(/gm)].map((m) => m[1]);
  const deadFns = fns.filter((n) => ((code.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length - 1) === 0);
  const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))].filter((c) => !/^\d/.test(c));
  const deadClasses = classes.filter((c) => !new RegExp('(^|[^\\w-])' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(rest));
  return { fns: fns.length, deadFns, classes: classes.length, deadClasses };
}
function score() {
  const html = fs.readFileSync(path.join(__dirname, 'planted', 'dead-code.html'), 'utf8');
  const r = analyse(html, '');
  const expect = { deadFns: ['deadOne', 'deadTwo', 'deadThree', 'deadFour', 'deadFive'], liveFns: ['viaOnclick', 'viaTimeout', 'viaMap', 'viaWindow', 'viaDirect'],
                   deadClasses: ['dc-one', 'dc-two', 'dc-three', 'dc-four', 'dc-five'], liveClasses: ['lc-markup', 'lc-string', 'lc-classlist', 'lc-template', 'lc-attr'] };
  return { functions: { caught: expect.deadFns.filter((n) => r.deadFns.includes(n)).length + '/5', falsePositives: expect.liveFns.filter((n) => r.deadFns.includes(n)).length + '/5' },
           classes: { caught: expect.deadClasses.filter((n) => r.deadClasses.includes(n)).length + '/5', falsePositives: expect.liveClasses.filter((n) => r.deadClasses.includes(n)).length + '/5' },
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
}
module.exports = { analyse, score };
