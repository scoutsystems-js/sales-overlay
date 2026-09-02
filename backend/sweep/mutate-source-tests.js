'use strict';
/* ② A CHECK THAT PASSES WHILE MEASURING NOTHING — the mutation harness.
   For every SOURCE-ONLY test (reads product source, executes nothing from it),
   take each POSITIVE anchor it asserts — a string literal passed to
   indexOf/includes not compared to -1, or the longest plain token of a regex
   literal in assert.match / .test( — find the product lines carrying it, and
   mutate the product TWICE: M1 delete those lines; M2 move them into a
   comment (`//` in JS, block in CSS, `<!-- -->` in markup). Run ONLY that test
   each time. A test that PASSES either mutation measures nothing about that
   anchor — under M2 it is reading documentation as code (the H131 family).
   Negative anchors (`=== -1`, `!includes`, `doesNotMatch`) are skipped: their
   vacuity has the opposite shape. Every mutation is reverted from a byte copy
   and the revert asserted. Scope: the files named on the command line; caps
   40 anchors per test, 30 lines per anchor; anchors absent from every target
   are reported as such (a presence assertion on an absent string that still
   passes is vacuous by itself). Planted: sweep/planted/vacuous/. */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
function anchorsOf(src) {
  const out = []; const lines = src.split('\n');
  lines.forEach((l, i) => {
    if (/\bassert\.(?:doesNotMatch|notEqual|notStrictEqual)\b|,\s*-1\s*\)|(?<![!=])===?\s*-1|!\s*[A-Za-z_.]+\.includes\(|!\/|\.strictEqual\([^,]*\.indexOf\([^)]*\),\s*-1/.test(l)) return; /* `!== -1` is POSITIVE — the first version matched its `== -1` tail and skipped every such assertion */
    [...l.matchAll(/(?:indexOf|includes)\((['"])((?:\\.|(?!\1).){3,})\1\)/g)].forEach((m) => out.push({ text: m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'), line: i + 1 }));
    [...l.matchAll(/(?:assert\.match\([^,]+,\s*|\.test\()\/((?:\\.|[^\/\n])+)\/[gimsuy]*|\/((?:\\.|[^\/\n])+)\/[gimsuy]*\.test\(/g)].map((m) => [m[0], m[1] || m[2]]).forEach((m) => { const toks = m[1].replace(/\\[sSdDwWbB.*+?()\[\]{}|^$\/]/g, ' ').replace(/[()\[\]{}|^$*+?.]/g, ' ').split(/\s+/).filter((t) => t.length >= 3).sort((a, b) => b.length - a.length); if (toks[0]) out.push({ text: toks[0], line: i + 1, fromRegex: true }); });
  });
  const seen = {}; return out.filter((a) => { if (seen[a.text]) return false; seen[a.text] = true; return true; }).slice(0, 40);
}
function targetsOf(testFile, src) {
  const dir = path.dirname(testFile);
  return [...new Set([...src.matchAll(/readFileSync\(([^)]*?)\)/g)].map((m) => { const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]); return parts.join('/').replace(/\/{2,}/g, '/'); }))]
    .map((p) => { const cands = [path.resolve(dir, p), path.resolve(dir, '..', p), path.resolve(dir, '..', 'web', p), path.resolve(dir, '..', 'lib', p), path.resolve(dir, '..', 'routes', p), path.resolve(dir, '..', 'web', 'css', p), path.resolve(dir, '..', 'scripts', p)]; return cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()); }).filter(Boolean);
}
function region(lines, i) { let s = false, c = false; for (let k = 0; k <= i; k++) { if (/<script\b/.test(lines[k])) s = true; if (/<\/script>/.test(lines[k])) s = false; if (/<style\b/.test(lines[k])) c = true; if (/<\/style>/.test(lines[k])) c = false; } return s ? 'js' : c ? 'css' : 'html'; }
const ORIGINALS = new Map(); /* every file touched → its bytes; restored on ANY exit (a crash once left `// router.get('/digest'` in routes/team.js) */
process.on('exit', () => { ORIGINALS.forEach((bytes, f) => { try { if (fs.readFileSync(f, 'utf8') !== bytes) fs.writeFileSync(f, bytes); } catch (e) {} }); });
function mutate(file, anchor, mode) {
  const raw = fs.readFileSync(file, 'utf8'); if (!ORIGINALS.has(file)) ORIGINALS.set(file, raw); const lines = raw.split('\n'); const idx = []; lines.forEach((l, i) => { if (l.indexOf(anchor) !== -1) idx.push(i); });
  if (!idx.length) return null; const isJs = /\.js$/.test(file);
  idx.slice(0, 30).forEach((i) => { if (mode === 'delete') lines[i] = ''; else { const r = isJs ? 'js' : region(lines, i); lines[i] = r === 'js' ? '// ' + lines[i] : r === 'css' ? '/* ' + lines[i].replace(/\*\//g, '* /') + ' */' : '<!-- ' + lines[i].replace(/--/g, '- -') + ' -->'; } });
  fs.writeFileSync(file, lines.join('\n')); return { raw, n: idx.length };
}
function runTest(testFile) { try { execSync('node --test "' + testFile + '"', { stdio: 'pipe' }); return 'pass'; } catch (e) { return 'fail'; } }
function review(testFile) {
  const src = fs.readFileSync(testFile, 'utf8'); const anchors = anchorsOf(src); const targets = targetsOf(testFile, src); const rows = [];
  if (runTest(testFile) !== 'pass') return { testFile, baseline: 'FAILS UNMUTATED', rows };
  anchors.forEach((a) => {
    let found = false;
    targets.forEach((t) => {
      const res = {}; ['delete', 'comment'].forEach((mode) => { const m = mutate(t, a.text, mode); if (!m) return; found = true; res[mode] = runTest(testFile); fs.writeFileSync(t, m.raw); if (fs.readFileSync(t, 'utf8') !== m.raw) throw new Error('REVERT FAILED ' + t); res.lines = m.n; });
      if (res.delete) rows.push({ anchor: a.text.slice(0, 60), target: path.basename(t), lines: res.lines, delete: res.delete, comment: res.comment, vacuous: res.delete === 'pass' || res.comment === 'pass' });
    });
    if (!found) rows.push({ anchor: a.text.slice(0, 60), target: null, absent: true, vacuous: !/\\/.test(a.text), unresolved: /\\/.test(a.text) }); /* an escaped anchor (`\\u201c`) is an extraction artefact, not an absent string */
  });
  return { testFile, baseline: 'pass', targets: targets.map((t) => path.basename(t)), rows };
}
function score() {
  const dir = path.join(__dirname, 'planted', 'vacuous'); const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'));
  const flagged = files.filter((f) => review(path.join(dir, f)).rows.some((r) => r.vacuous));
  const pos = files.filter((f) => /^p/.test(f)), neg = files.filter((f) => /^n/.test(f));
  return { caught: pos.filter((f) => flagged.includes(f)).length + '/' + pos.length, falsePositives: neg.filter((f) => flagged.includes(f)).length + '/' + neg.length, flagged };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const args = process.argv.slice(2); const j0 = args.indexOf('--json'); const jsonPath = j0 > -1 ? args.splice(j0, 2)[1] : null; const files = args.filter((f) => !f.startsWith('--')); const out = []; console.log('reviewing ' + files.length + ' files' + (jsonPath ? ', json → ' + jsonPath : '')); /* the --json PATH is not a test file (the first run reviewed it and crashed before writing) */
  files.forEach((f) => { const r = review(f); out.push(r); const v = r.rows.filter((x) => x.vacuous); console.log((v.length ? 'VACUOUS ' + v.length + '/' + r.rows.length : 'ok      ' + r.rows.length + ' anchors') + '  ' + f + (r.baseline !== 'pass' ? '  [' + r.baseline + ']' : '') + (v.length ? '  e.g. ' + JSON.stringify(v[0]) : '')); });
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1));
}
module.exports = { anchorsOf, targetsOf, review, score };
