'use strict';
/* FIX #5 — route every test through the ONE stripper (test/helpers/strip-comments.js).
   Uses the sweep's own extractor to find each file's private copy — a `function
   name(arg) {…}` whose body strips, or an inline `const X = SRC.replace(…)…;` chain —
   and rewrites it to call the shared helper, keeping the local name so call sites
   do not change. Files whose copy cannot be lifted are listed for a hand edit.
   `--dry` prints the plan; without it, writes. Every rewrite keeps the file parseable
   (node -c) or is rolled back and reported. */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const { extract } = require('./detect-stripper-copies');
const REQUIRE = "const { stripComments } = require('./helpers/strip-comments');";
function convert(file, dry) {
  const src = fs.readFileSync(file, 'utf8');
  if (/require\(['"]\.\/helpers\/strip-comments['"]\)/.test(src) && !/\[\\s\\S\]\*\?\\\*\\\//.test(src)) return { file, status: 'already shared' };
  const ex = extract(src); if (!ex) return { file, status: 'NOT LIFTED — hand edit', reason: 'no function or inline chain found' };
  let out = src;
  if (ex.kind === 'function') {
    const m = new RegExp('function\\s+' + ex.name + '\\s*\\(\\s*([A-Za-z_]\\w*)\\s*\\)\\s*\\{').exec(src); const arg = m[1];
    let d = 0, i = m.index + m[0].length - 1, s = i; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
    out = src.slice(0, m.index) + 'function ' + ex.name + '(' + arg + ') { return stripComments(' + arg + '); }   /* ⚠ ONE stripper — fix #5 (H682); this used to be a private copy */' + src.slice(i + 1);
  } else {
    /* inline: `const X = SRC<chain>;` → `const X = stripComments(SRC);` — the chain starts at the first .replace/.split after `= SRC` */
    const re = new RegExp('((?:const|var|let)\\s+[A-Za-z_]\\w*\\s*=\\s*)' + ex.name + '((?:\\s*\\.(?:replace|split|filter|join|map)\\((?:[^()]|\\([^()]*\\))*\\))+)\\s*;');
    const m = re.exec(src); if (!m) return { file, status: 'NOT LIFTED — hand edit', reason: 'inline chain shape changed' };
    if (!/\[\\s\\S\]\*\?\\\*\\\//.test(m[2]) && !/\\\/\\\/\.\*/.test(m[2])) return { file, status: 'NOT LIFTED — hand edit', reason: 'chain is not a stripper' };
    out = src.slice(0, m.index) + m[1] + 'stripComments(' + ex.name + ');   /* ⚠ ONE stripper — fix #5 (H682); this used to be a private chain */' + src.slice(m.index + m[0].length);
  }
  if (!/require\(['"]\.\/helpers\/strip-comments['"]\)/.test(out)) {
    const firstReq = out.search(/^(const|var|let)\s+[^=]*=\s*require\(/m); const at = firstReq > -1 ? out.indexOf('\n', firstReq) + 1 : 0;
    out = out.slice(0, at) + REQUIRE + '\n' + out.slice(at);
  }
  if (dry) return { file, status: 'would convert (' + ex.kind + ' ' + ex.name + ')' };
  fs.writeFileSync(file, out);
  try { execSync('node -c "' + file + '"', { stdio: 'pipe' }); } catch (e) { fs.writeFileSync(file, src); return { file, status: 'ROLLED BACK — does not parse after rewrite' }; }
  return { file, status: 'converted (' + ex.kind + ' ' + ex.name + ')' };
}
if (require.main === module) {
  const dry = process.argv.includes('--dry');
  const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => 'test/' + f);
  const rows = files.map((f) => convert(f, dry)); const tally = {};
  rows.forEach((r) => { const k = r.status.replace(/\(.*\)/, '').trim(); tally[k] = (tally[k] || 0) + 1; });
  console.log(JSON.stringify(tally));
  rows.filter((r) => /NOT LIFTED|ROLLED BACK/.test(r.status)).forEach((r) => console.log(r.status + ': ' + r.file + (r.reason ? ' — ' + r.reason : '')));
}
module.exports = { convert };
