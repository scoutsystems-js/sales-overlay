'use strict';
/* ② PRIVATE COMMENT-STRIPPERS IN THE TEST SUITE, RUN AGAINST KNOWN KILLERS.
   One shared stripper exists (test/helpers/strip-comments.js); most tests carry
   their own copy. Each copy is EXTRACTED as code (a `function name(src) {…}`
   whose body strips comments, or an inline `.replace(/\/\*…/)…` chain on a
   loaded source) and EXECUTED against inputs that have broken strippers before:
     K1 a `//` inside a string on a code line (URL)        — "anywhere //" copies cut the line
     K2 an apostrophe in prose, before code                  — quote-tracking copies shred
     K3 a slash-star inside a LINE comment, then code, then a real block — block-FIRST copies swallow the code (H131 family)
     K4 a slash-star inside a STRING, then code, then a real block — every regex copy swallows the code
     K5 a star-slash inside a string                          — a block regex ends early and leaves the tail
   A copy CORRUPTS when a code line is lost or altered; it LEAKS when comment
   text survives (an absence guard then fails on documentation — the other
   direction of the same defect). Scope: test/*.test.js; copies that cannot be
   extracted are listed as such, not assumed safe. Planted: sweep/planted/strippers.js. */
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const KILLERS = [
  { id: 'K1', src: "var u = 'http://x.y/z'; // trailing\nvar k = 1;", keep: ["var u = 'http://x.y/z';", 'var k = 1;'], gone: ['trailing'] },
  { id: 'K2', src: "// don't strip the next line\nvar a = 1;\n/* it's a block */\nvar b = 'http://h'; var c = 2;", keep: ['var a = 1;', "var b = 'http://h';", 'var c = 2;'], gone: ["don't", "it's"] },
  { id: 'K3', src: "// a line with /* inside\nvar c = 3;\nvar d = 4; /* real block */\nvar e = 5;", keep: ['var c = 3;', 'var d = 4;', 'var e = 5;'], gone: ['real block', 'a line with'] },
  { id: 'K4', src: "var g = \"/* not a comment\";\nvar h = 6;\n/* real */\nvar i = 7;", keep: ['var g = "/* not a comment";', 'var h = 6;', 'var i = 7;'], gone: ['real'] },
  { id: 'K5', src: "var s = 'a */ b'; /* c */\nvar t = 8;", keep: ["var s = 'a */ b';", 'var t = 8;'], gone: [] },
];
function extract(src) {
  /* function form: the smallest `function name(arg) {…}` whose body strips */
  const fre = /function\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)\s*\{/g; let m;
  while ((m = fre.exec(src))) {
    let depth = 0, i = m.index + m[0].length - 1, start = i;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    const body = src.slice(start, i + 1);
    if (/\[\\s\\S\]\*\?\\\*\\\//.test(body) || /\\\/\\\/\.\*/.test(body) || /indexOf\('\/\/'\)/.test(body)) return { kind: 'function', name: m[1], code: 'function ' + m[1] + '(' + m[2] + ') ' + body };
  }
  /* inline form: `const X = SRC<chain>;` where the chain strips */
  const ire = /(?:const|var|let)\s+[A-Za-z_]\w*\s*=\s*([A-Za-z_]\w*)((?:\s*\.(?:replace|split|filter|join|map)\((?:[^()]|\([^()]*\))*\))+)\s*;/g;
  while ((m = ire.exec(src))) { if (/\[\\s\\S\]\*\?\\\*\\\//.test(m[2]) || /\\\/\\\/\.\*/.test(m[2])) return { kind: 'inline', name: m[1], code: 'function strip(src) { return src' + m[2] + '; }' }; }
  return null;
}
function runCopy(code, name) {
  const ctx = {}; vm.runInNewContext(code + '\nresult = ' + (name || 'strip') + ';', ctx);
  return KILLERS.map((k) => { let out; try { out = ctx.result(k.src); } catch (e) { return { id: k.id, error: String(e).slice(0, 60) }; }
    const lost = k.keep.filter((line) => out.indexOf(line) === -1); const leaked = k.gone.filter((t) => out.indexOf(t) !== -1);
    return { id: k.id, corrupts: lost, leaks: leaked }; });
}
function analyseFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (/require\(['"]\.\/helpers\/strip-comments['"]\)/.test(src) && !/\[\\s\\S\]\*\?\\\*\\\//.test(src)) return { file, shared: true };
  const ex = extract(src); if (!ex) return { file, extracted: false };
  const res = runCopy(ex.code, ex.kind === 'function' ? ex.name : 'strip');
  return { file, extracted: true, kind: ex.kind, corrupts: res.filter((r) => r.corrupts && r.corrupts.length).map((r) => r.id), leaks: res.filter((r) => r.leaks && r.leaks.length).map((r) => r.id), errors: res.filter((r) => r.error).map((r) => r.id + ':' + r.error) };
}
function score() {
  const planted = require('./planted/strippers'); const out = {};
  Object.entries(planted).forEach(([name, fn]) => { out[name] = runCopy('var f = ' + fn.toString() + ';', 'f').filter((r) => (r.corrupts && r.corrupts.length)).map((r) => r.id); });
  const bad = Object.keys(planted).filter((n) => /^bad/.test(n)), good = Object.keys(planted).filter((n) => /^good/.test(n));
  return { caught: bad.filter((n) => out[n].length).length + '/' + bad.length, falsePositives: good.filter((n) => out[n].length).length + '/' + good.length, detail: out };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => 'test/' + f);
  const rows = files.map(analyseFile); const copies = rows.filter((r) => r.extracted);
  const summary = { testFiles: files.length, shared: rows.filter((r) => r.shared).length, copies: copies.length, notExtracted: rows.filter((r) => r.extracted === false && !r.shared).length };
  const byKiller = {}; KILLERS.forEach((k) => { byKiller[k.id] = { corrupt: copies.filter((r) => r.corrupts.includes(k.id)).length, leak: copies.filter((r) => r.leaks.includes(k.id)).length }; });
  console.log(JSON.stringify({ summary, byKiller }));
  const sharedRes = runCopy(fs.readFileSync('test/helpers/strip-comments.js', 'utf8').replace(/module\.exports[\s\S]*$/, ''), 'stripComments');
  console.log('SHARED stripper: ' + JSON.stringify(sharedRes));
  copies.forEach((r) => console.log((r.corrupts.length ? 'CORRUPTS ' + r.corrupts.join(',') : 'safe    ') + ' leaks ' + (r.leaks.join(',') || '-') + '  ' + r.file + ' (' + r.kind + ')' + (r.errors.length ? ' ERR ' + r.errors.join(';') : '')));
  if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
  if (process.argv[2] === '--targets') {
    /* THE EVIDENCE THAT MATTERS: on the file each test actually reads, how many CODE lines
       does its copy lose (and how many comment lines does it keep) against a tokenizing
       stripper that honours strings? A test asserting on a view missing code lines is
       asserting against mangled source. */
    const { good_tokenizer } = require('./planted/strippers');
    const lineSet = (t) => new Set(t.split('\n').map((l) => l.trim()).filter(Boolean));
    copies.forEach((r) => {
      const src = fs.readFileSync(r.file, 'utf8'); const ex = extract(src); const ctx = {}; vm.runInNewContext(ex.code + '\nresult = ' + (ex.kind === 'function' ? ex.name : 'strip') + ';', ctx);
      const targets = [...new Set([...src.matchAll(/readFileSync\(([^;]*?)['"]([^'"]+\.(?:js|html|css))['"]/g)].map((m) => m[2]))];
      targets.forEach((t) => {
        const cands = ['web/' + t, 'lib/' + t, 'routes/' + t, t, 'web/js/' + t, 'scripts/' + t].filter((c) => fs.existsSync(c)); if (!cands.length) return;
        const raw = fs.readFileSync(cands[0], 'utf8'); let mine; try { mine = ctx.result(raw); if (Array.isArray(mine)) mine = mine.join('\n'); /* a copy extracted before its .join */ } catch (e) { console.log('ERR ' + r.file + ' on ' + t + ': ' + String(e).slice(0, 60)); return; }
        /* Code loss = lines of the tokenized RAW that are absent from the tokenized COPY OUTPUT
           (so a trailing comment the copy keeps is not counted as lost code). Leak = lines the
           copy left that are comment-only. */
        const ref = good_tokenizer(raw); const a = lineSet(good_tokenizer(mine)), b = lineSet(ref);
        const lost = [...b].filter((l) => !a.has(l)); const kept = mine.split('\n').map((l) => l.trim()).filter((l) => /^(\/\/|\/\*|\*)/.test(l));
        console.log('TARGET ' + r.file + ' → ' + cands[0] + ': code lines LOST ' + lost.length + ', comment lines KEPT ' + kept.length + (lost.length ? '  e.g. ' + JSON.stringify(lost[0].slice(0, 70)) : ''));
      });
    });
  }
}
module.exports = { analyseFile, runCopy, KILLERS, score, extract };
