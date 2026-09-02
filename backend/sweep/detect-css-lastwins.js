'use strict';
/* ④(b) CSS LAST-WINS: a selector declared more than once where a LATER block
   sets a property the EARLIER block also set, to a different value — the later
   one silently wins. Scope: the <style> block of one HTML file, comments
   stripped. CLAIM: "these two blocks share a selector and disagree on this
   property" — whether the override is deliberate is the review's call.
   Not covered (stated): overrides across DIFFERENT selectors of equal
   specificity, and `border: 0`-style shorthands killing a longhand (a separate
   list the script prints as 'shorthand-after-longhand'). */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
function analyse(html) {
  const code = stripComments(html); const css = code.slice(code.indexOf('<style>'), code.indexOf('</style>'));
  const blocks = [...css.matchAll(/(^|\n)\s*([^{}\n@][^{}\n]*?)\s*\{([^}]*)\}/g)].map((m) => ({ sel: m[2].trim(), body: m[3], at: m.index }));
  const bySel = {}; blocks.forEach((b) => { (bySel[b.sel] = bySel[b.sel] || []).push(b); });
  const conflicts = [];
  Object.entries(bySel).filter(([, v]) => v.length > 1).forEach(([sel, list]) => {
    const seen = {};
    list.forEach((b, i) => {
      [...b.body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].forEach((d) => {
        const prop = d[1].trim(), val = d[2].trim();
        if (seen[prop] !== undefined && seen[prop].val !== val) conflicts.push({ sel, prop, earlier: seen[prop].val, later: val, block: i + 1 });
        seen[prop] = { val };
      });
    });
  });
  const shorthand = blocks.filter((b) => /(^|;)\s*border\s*:\s*0\s*;/.test(b.body) && /border-(top|left|right|bottom)/.test(b.body)).map((b) => b.sel);
  return { blocks: blocks.length, duplicatedSelectors: Object.values(bySel).filter((v) => v.length > 1).length, conflicts, shorthandAfterLonghand: shorthand };
}
function score() {
  const r = analyse(fs.readFileSync(path.join(__dirname, 'planted', 'css-lastwins.html'), 'utf8'));
  const hit = (sel, prop) => r.conflicts.some((c) => c.sel === sel && c.prop === prop);
  const pos = [['.p1', 'color'], ['.p2', 'padding'], ['.p3', 'display'], ['.p4', 'font-size'], ['.p5', 'background']];
  const neg = [['.n1', 'color'], ['.n2', 'margin'], ['.n3', 'color'], ['.n4', 'color'], ['.n5', 'color']];
  return { caught: pos.filter(([s, p]) => hit(s, p)).length + '/5', falsePositives: neg.filter(([s, p]) => hit(s, p)).length + '/5', conflicts: r.conflicts.map((c) => c.sel + ':' + c.prop) };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const r = analyse(fs.readFileSync('web/dashboard.html', 'utf8'));
  console.log(JSON.stringify({ blocks: r.blocks, duplicatedSelectors: r.duplicatedSelectors, conflicts: r.conflicts.length, shorthandAfterLonghand: r.shorthandAfterLonghand.length }));
  r.conflicts.forEach((c) => console.log('CONFLICT ' + c.sel + ' { ' + c.prop + ': ' + c.earlier + ' → ' + c.later + ' } (block ' + c.block + ')'));
  r.shorthandAfterLonghand.forEach((s) => console.log('SHORTHAND-KILLS-LONGHAND ' + s));
}
module.exports = { analyse, score };
