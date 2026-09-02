'use strict';
/* ④(a) A FIELD READ AT THE CONSUMER AND SELECTED NOWHERE — undefined
   everywhere, with no error. Scope: lib/ and routes/, comments stripped.
   For each `.select('a, b, c')` whose result is assigned (`var x = await …`),
   the rows are whatever `x.data` feeds: `x.data.forEach(function (r) {…})`,
   `.map(function (r) …)`, `x.data[i]`, `x.data || []` aliased to another var,
   and `.maybeSingle()` results read as `x.data.field`. Every `r.field` read
   inside those callbacks (and `x.data.field`) is checked against the column
   list. Aliases in the list (`a:b`, `b(...)`) are honoured; `*` disables.
   CLAIM: "this property is read on rows of that select and is not in its
   column list" — the scope of a select ends at the next `x = await` so callbacks are never attributed to an earlier select; false when the row is enriched between select and read
   (`Object.assign`, a later `r.x = …`), which the script cannot see; the
   review checks that. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
const { mapper } = require('./raw-line');
function colsOf(list) {
  if (/\*/.test(list)) return null;
  return new Set(list.replace(/\([^)]*\)/g, '').split(',').map((c) => c.trim().split(':')[0].split('->')[0].trim()).filter(Boolean));
}

/* Cross-module reads: `countsAsObjection(o)` in lib/team-analytics.js reads
   `row.objection_class` inside lib/objection-strict.js — invisible to the
   same-file pass and the one real defect this detector was written for.
   Resolves `name` through `require('./x')` destructuring or `X.name` is not
   handled (only bare destructured/named imports); returns null when the name
   is not an import, so a local helper is left to the same-file pass. */
function importedReads(src, name, file) {
  if (!file) return null;
  const dre = new RegExp('(?:var|let|const)\\s*\\{([^}]*)\\}\\s*=\\s*require\\(\'([^\']+)\'\\)', 'g'); let dm;
  while ((dm = dre.exec(src))) {
    const names = dm[1].split(',').map((x) => x.trim().split(':').pop().trim());
    if (!names.includes(name)) continue;
    let target; try { target = require.resolve(path.resolve(path.dirname(file), dm[2])); } catch (e) { return null; }
    const tsrc = stripComments(fs.readFileSync(target, 'utf8'));
    const fm = new RegExp('function\\s+' + name + '\\s*\\(\\s*([A-Za-z_]\\w*)').exec(tsrc); if (!fm) return null;
    const param = fm[1]; let depth = 0, i = tsrc.indexOf('{', fm.index), start = i;
    for (; i < tsrc.length; i++) { if (tsrc[i] === '{') depth++; else if (tsrc[i] === '}' && --depth === 0) break; }
    const body = tsrc.slice(start, i);
    return [...new Set([...body.matchAll(new RegExp('\\b' + param + '\\.([a-z_][a-z0-9_]*)', 'g'))].map((x) => x[1]))];
  }
  return null;
}
function analyse(src, ctx) {
  ctx = ctx || {}; const rawLine = ctx.raw ? mapper(ctx.raw, src) : (l) => l;
  const hits = [];
  const re = /(?:(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*await\s+[^;]*?\.select\('([^']*)'\)|([A-Za-z_]\w*)\.push\([^;]*?\.select\('([^']*)'\))/g; let m;
  while ((m = re.exec(src))) {
    const chunked = !!m[3]; const v = chunked ? m[3] : m[1], cols = colsOf(chunked ? m[4] : m[2]); if (!cols) continue;
    if (chunked) m[2] = m[4];
    let start = m.index + m[0].length;
    let scope;
    if (chunked) {
      const pa = src.indexOf('Promise.all(' + v, start); if (pa < 0) continue;
      const stmtStart = src.lastIndexOf('\n', pa); const stmt = src.slice(stmtStart, src.indexOf(';', pa));
      const nested = /(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*await\s+Promise\.all\(\[/.exec(stmt);
      const plain = /(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*await\s+Promise\.all\(([A-Za-z_]\w*)\)/.exec(stmt);
      if (nested) {
        const items = stmt.slice(stmt.indexOf('[') + 1).replace(/\]\)*\s*$/, '').split(/,(?![^(]*\))/).map((x) => x.trim()); const idx = items.findIndex((x) => x === 'Promise.all(' + v + ')' || x === v);
        if (idx < 0) continue;
        const anchor = src.indexOf(nested[1] + '[' + idx + ']', pa); if (anchor < 0) continue;
        const others = src.slice(anchor + 1).search(new RegExp('\\b' + nested[1] + '\\[(?!' + idx + '\\])\\d+\\]')); scope = src.slice(anchor, others > -1 ? anchor + 1 + others : anchor + 3500);
        const nx3 = scope.search(/(?:var|let|const)\s+[A-Za-z_]\w*\s*=\s*await\s/); if (nx3 > -1) scope = scope.slice(0, nx3);
      } else if (plain) {
        const anchor = src.indexOf(plain[1] + '.', pa); if (anchor < 0) continue; scope = src.slice(anchor, anchor + 3500);
        const nx2 = scope.search(/(?:var|let|const)\s+[A-Za-z_]\w*\s*=\s*await\s/); if (nx2 > -1) scope = scope.slice(0, nx2);
      } else continue;
    } else {
      scope = src.slice(start, start + 3500); const nx = scope.search(/(?:var|let|const)\s+[A-Za-z_]\w*\s*=\s*await\s/); if (nx > -1) scope = scope.slice(0, nx);
    }
    if (chunked) { /* rows of a chunk are read as `(x.data || []).forEach(function (o)` on the Promise.all results */
      const rr = /\.data\s*\|\|\s*\[\]\)\.(?:forEach|map|filter|some|find)\(function \(([A-Za-z_]\w*)/g; let x; const readers = []; while ((x = rr.exec(scope))) readers.push({ name: x[1], at: x.index });
      const line = src.slice(0, m.index).split('\n').length;
      readers.forEach((rd) => { const body = scope.slice(rd.at, rd.at + 1200);
        [...body.matchAll(new RegExp('\\b' + rd.name + '\\.([a-z_][a-z0-9_]*)', 'g'))].forEach((f) => { if (!cols.has(f[1])) hits.push({ line: rawLine(line) || line, select: m[2].slice(0, 60), var: v, field: f[1] }); });
        [...body.matchAll(new RegExp('\\b([A-Za-z_]\\w*)\\(' + rd.name + '(?:\\s*[,)])', 'g'))].forEach((c) => { const fields = importedReads(src, c[1], ctx.file); if (!fields) return; fields.forEach((field) => { if (!cols.has(field)) hits.push({ line: rawLine(line) || line, select: m[2].slice(0, 60), var: v, field, via: c[1] }); }); }); });
      continue;
    }
    const paramRe = new RegExp('\\b' + v + '\\.data(?:\\s*\\|\\|\\s*\\[\\])?\\)?\\.(?:forEach|map|filter|some|find)\\(function \\(([A-Za-z_]\\w*)', 'g'); let pm;
    const readers = []; while ((pm = paramRe.exec(scope))) readers.push({ name: pm[1], at: pm.index });
    const aliasRe = new RegExp('(?:var|let|const)\\s+([A-Za-z_]\\w*)\\s*=\\s*\\(?' + v + '\\.data\\s*\\|\\|\\s*\\[\\]\\)?;', 'g'); let am;
    while ((am = aliasRe.exec(scope))) { const a = am[1]; const r2 = new RegExp('\\b' + a + '\\.(?:forEach|map|filter|some|find)\\(function \\(([A-Za-z_]\\w*)', 'g'); let x; while ((x = r2.exec(scope))) readers.push({ name: x[1], at: x.index }); }
    const line = src.slice(0, m.index).split('\n').length;
    readers.forEach((rd) => {
      const body = scope.slice(rd.at, rd.at + 1200);
      [...body.matchAll(new RegExp('\\b' + rd.name + '\\.([a-z_][a-z0-9_]*)', 'g'))].forEach((f) => { const field = f[1]; if (!cols.has(field) && !/^(id)$/.test(field) === true) hits.push({ line: rawLine(line) || line, select: m[2].slice(0, 60), var: v, field }); });
    });
    readers.forEach((rd) => {
      const body = scope.slice(rd.at, rd.at + 1200);
      [...body.matchAll(new RegExp('\\b([A-Za-z_]\\w*)\\(' + rd.name + '(?:\\s*[,)])', 'g'))].forEach((c) => {
        const fields = importedReads(src, c[1], ctx.file); if (!fields) return;
        fields.forEach((field) => { if (!cols.has(field)) hits.push({ line: rawLine(line) || line, select: m[2].slice(0, 60), var: v, field, via: c[1] }); });
      });
    });
    [...scope.matchAll(new RegExp('\\b' + v + '\\.data\\.([a-z_][a-z0-9_]*)', 'g'))].forEach((f) => { if (!cols.has(f[1]) && !/^(length|filter|map|forEach|some|find|slice|reduce|every|sort|concat|indexOf|includes)$/.test(f[1])) hits.push({ line: rawLine(line) || line, select: m[2].slice(0, 60), var: v, field: f[1] }); });
  }
  const seen = {}; return hits.filter((h) => { const k = h.line + ':' + h.field; if (seen[k]) return false; seen[k] = true; return true; });
}
function score() {
  const src = stripComments(fs.readFileSync(path.join(__dirname, 'planted', 'selected-vs-read.js'), 'utf8'));
  const hits = analyse(src, { file: path.join(__dirname, 'planted', 'selected-vs-read.js') }); const fields = hits.map((h) => h.field);
  const pos = ['p_one', 'p_two', 'p_three', 'p_four', 'p_five', 'p_six', 'p_seven', 'p_eight'], neg = ['n_one', 'n_two', 'n_three', 'n_four', 'n_five', 'name', 'n_seven', 'n_eight'];
  return { caught: pos.filter((f) => fields.includes(f)).length + '/8', falsePositives: neg.filter((f) => fields.includes(f)).length + '/8', flagged: fields };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const files = [...fs.readdirSync('lib').map((f) => 'lib/' + f), ...fs.readdirSync('routes').map((f) => 'routes/' + f)].filter((f) => f.endsWith('.js'));
  let n = 0; files.forEach((f) => { const rawSrc = fs.readFileSync(f, 'utf8'); const hits = analyse(stripComments(rawSrc), { file: path.resolve(f), raw: rawSrc }); hits.forEach((h) => { n++; console.log('CANDIDATE ' + f + ':' + h.line + ' reads `' + h.field + '`' + (h.via ? ' (inside ' + h.via + '())' : '') + ' on rows selected as `' + h.select + '`'); }); });
  console.log('candidates', n);
}
module.exports = { analyse, score };
