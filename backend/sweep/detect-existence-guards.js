'use strict';
/* ① A GUARD THAT PROVES EXISTENCE, NOT BEHAVIOUR. Scope: test/*.test.js,
   comments stripped. A test file is SOURCE-ONLY when it reads product source
   (`readFileSync` of lib/, routes/ or web/) and never executes anything from
   it: no `require('../lib|routes/…')`, no route driven (`http.request`,
   `fetch(`, `supertest`, `app.`, `router.handle`, a handler called with a
   forged req/res), no `new Function`/`vm.` evaluation of the source, no
   dashboard-runtime harness (`loadDashboard`/`jsdom`). Its assertions can
   only be text matches — `indexOf`, `includes`, `match`, `.test(src)`.
   A ① CANDIDATE is a source-only file whose name or test titles claim to
   guard spend, permission or scope (owner|permission|403|forbidden|role|
   scope|spend|budget|token cap|cost|purge|delete|grading|admin) — the matched
   word is printed beside each candidate so the review can discard a title
   that merely contains the word.
   CLAIM: "this file's verdict rests on text matches alone" — the review
   decides whether the property it names is one text can prove (a removal
   guard legitimately is) or one that needs the entry point executed. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
const EXEC = [/require\(['"](?:\.\.\/)+(?:lib|routes|web)\//, /require\(['"]\.\.\/(?:server|app)['"]/, /\bhttp\.request\(/, /\bfetch\(/, /supertest/, /\bapp\.(?:get|post|listen|handle)\b/, /router\.handle/, /new Function\(/, /\bvm\.(?:runInNewContext|runInContext|Script)\b/, /jsdom/i, /loadDashboard|dashboardRuntime|evalDashboard|runInlineScript/, /handler\(\s*\{?\s*(?:req|user|body)/];
const READS_SOURCE = /readFileSync\([^)]*(?:lib|routes|web)[\/'"]/;
const CLAIM = /owner[- ]only|owner\b|permission|\b403\b|forbidden|role[- ]gat|\brole\b|\bscope\b|spend|budget|token cap|max_tokens|\bcost\b|purge|\bdelete\b|grading|admin/i;
function classify(src) {
  const readsSource = READS_SOURCE.test(src); const executes = EXEC.some((re) => re.test(src));
  const titles = [...src.matchAll(/test\(\s*['"`]([^'"`]*)['"`]/g)].map((m) => m[1]).join(' | ');
  return { readsSource, executes, sourceOnly: readsSource && !executes, titles };
}
function scan(dir, file) {
  const src = stripComments(fs.readFileSync(path.join(dir, file), 'utf8')); const c = classify(src);
  const cm = CLAIM.exec(file + ' ' + c.titles); return Object.assign({ file, claims: !!cm, claimWord: cm ? cm[0] : null }, c);
}
function score() {
  const dir = path.join(__dirname, 'planted', 'guards'); const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => scan(dir, f));
  const flagged = rows.filter((r) => r.sourceOnly && r.claims).map((r) => r.file);
  const pos = rows.filter((r) => /^p/.test(r.file)).map((r) => r.file), neg = rows.filter((r) => /^n/.test(r.file)).map((r) => r.file);
  return { caught: pos.filter((f) => flagged.includes(f)).length + '/' + pos.length, falsePositives: neg.filter((f) => flagged.includes(f)).length + '/' + neg.length, flagged };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const rows = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => scan('test', f));
  const so = rows.filter((r) => r.sourceOnly); const cand = so.filter((r) => r.claims);
  cand.forEach((r) => console.log('CANDIDATE test/' + r.file + '  (claim word: ' + r.claimWord + ')'));
  console.log(JSON.stringify({ testFiles: rows.length, readSource: rows.filter((r) => r.readsSource).length, sourceOnly: so.length, candidates: cand.length }));
  if (process.argv[2] === '--all') so.filter((r) => !r.claims).forEach((r) => console.log('source-only (no guard claim) test/' + r.file));
}
module.exports = { classify, scan, score };
