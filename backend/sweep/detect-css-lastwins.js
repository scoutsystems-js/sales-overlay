'use strict';
/* ④(b) CSS LAST-WINS: a selector declared more than once IN THE SAME AT-RULE
   CONTEXT where a LATER block sets a property the EARLIER block also set, to a
   different value — the later one silently wins. Scope: the <style> block of
   one HTML file, comments stripped, parsed with a brace walker that tracks
   at-rule nesting (the first version parsed at-rule bodies as flat selectors,
   so a rule inside `@media (max-width: 900px)` looked like a desktop override;
   N5/N7 pin that). CLAIM: "these two blocks share selector AND context and
   disagree on this property" — whether the override is deliberate is the
   review's call, on the LIVE page. Same selector in DIFFERENT contexts is
   counted separately as `crossContext` and is not a conflict.
   Shorthand-after-longhand: a `border: 0|none` (or margin/padding/background
   shorthand) declared AFTER a longhand of the same family, within one block or
   in a later block of the same selector+context. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
const FAMILY = { border: /^border-(top|right|bottom|left|color|style|width)/, margin: /^margin-/, padding: /^padding-/, background: /^background-/, font: /^font-(size|weight|family|style)/ };
function parse(css) {
  const rules = []; const stack = []; let i = 0, buf = '', n = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = buf.trim(); buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); i++; continue; }
      const end = css.indexOf('}', i); const body = css.slice(i + 1, end);
      prelude.split(',').map((s) => s.trim()).filter(Boolean).forEach((sel) => rules.push({ sel, body, ctx: stack.join(' > ') || '(top)', order: n++ }));
      i = end + 1; continue;
    }
    if (ch === '}') { stack.pop(); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  return rules;
}
function decls(body) { return [...body.matchAll(/([a-z-]+)\s*:\s*([^;]+);?/g)].map((d) => ({ prop: d[1].trim(), val: d[2].trim() })); }
function analyse(html) {
  const code = stripComments(html); const css = [...code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'); /* EVERY style block — the first version read only the first one */
  const rules = parse(css);
  const byKey = {}; const bySel = {};
  rules.forEach((r) => { (byKey[r.ctx + '|' + r.sel] = byKey[r.ctx + '|' + r.sel] || []).push(r); (bySel[r.sel] = bySel[r.sel] || new Set()).add(r.ctx); });
  const conflicts = [], shorthand = [];
  Object.entries(byKey).forEach(([key, list]) => {
    const seen = {}; const longhands = {};
    list.forEach((b, bi) => {
      decls(b.body).forEach((d) => {
        if (seen[d.prop] !== undefined && seen[d.prop].val !== d.val && list.length > 1) conflicts.push({ sel: b.sel, ctx: b.ctx, prop: d.prop, earlier: seen[d.prop].val, later: d.val, block: bi + 1, of: list.length });
        seen[d.prop] = { val: d.val };
        Object.entries(FAMILY).forEach(([short, re]) => {
          if (re.test(d.prop)) (longhands[short] = longhands[short] || []).push(d.prop + ': ' + d.val);
          else if (d.prop === short && longhands[short] && longhands[short].length && /^(0|none|initial|unset)\b/.test(d.val)) shorthand.push({ sel: b.sel, ctx: b.ctx, shorthand: d.prop + ': ' + d.val, kills: longhands[short].slice(), block: bi + 1 });
        });
      });
    });
  });
  const crossContext = Object.values(bySel).filter((s) => s.size > 1).length;
  return { rules: rules.length, duplicatedKeys: Object.values(byKey).filter((v) => v.length > 1).length, crossContext, conflicts, shorthandAfterLonghand: shorthand };
}
function score() {
  const r = analyse(fs.readFileSync(path.join(__dirname, 'planted', 'css-lastwins.html'), 'utf8'));
  const hit = (sel, prop) => r.conflicts.some((c) => c.sel === sel && c.prop === prop);
  const sh = (sel) => r.shorthandAfterLonghand.some((s) => s.sel === sel);
  const pos = [['.p1', 'color'], ['.p2', 'padding'], ['.p3', 'display'], ['.p4', 'font-size'], ['.p5', 'background'], ['.p6', 'color']];
  const neg = [['.n1', 'color'], ['.n2', 'margin'], ['.n3', 'color'], ['.n4', 'color'], ['.n5', 'color'], ['.n7', 'color']];
  const shPos = ['.s1', '.s3'], shNeg = ['.s2', '.s4'];
  return { caught: pos.filter(([s, p]) => hit(s, p)).length + '/' + pos.length, falsePositives: neg.filter(([s, p]) => hit(s, p)).length + '/' + neg.length,
    shorthandCaught: shPos.filter(sh).length + '/' + shPos.length, shorthandFalse: shNeg.filter(sh).length + '/' + shNeg.length };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const r = analyse(fs.readFileSync('web/dashboard.html', 'utf8'));
  console.log(JSON.stringify({ rules: r.rules, duplicatedKeys: r.duplicatedKeys, sameSelectorDifferentContext: r.crossContext, conflicts: r.conflicts.length, shorthandAfterLonghand: r.shorthandAfterLonghand.length }));
  r.conflicts.forEach((c) => console.log('CONFLICT [' + c.ctx + '] ' + c.sel + ' { ' + c.prop + ': ' + c.earlier + ' → ' + c.later + ' } (block ' + c.block + ' of ' + c.of + ')'));
  r.shorthandAfterLonghand.forEach((s) => console.log('SHORTHAND-KILLS-LONGHAND [' + s.ctx + '] ' + s.sel + ' { ' + s.shorthand + ' } after ' + s.kills.join(', ') + ' (block ' + s.block + ')'));
  if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 1));
}
module.exports = { analyse, parse, score };
