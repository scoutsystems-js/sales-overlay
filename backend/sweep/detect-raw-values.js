'use strict';
/* ⑥ A VALUE WHERE A LABEL BELONGS — a stored value reaching customer-readable
   text without the label map that exists for it. Enumerated by CAPABILITY,
   not by pattern:
     1. LABEL MAPS first: object literals mapping stored-shaped keys to
        display-shaped strings; arrays of {key, label}; functions named
        named like xLabel / xTitle / xCaption / xDisplay whose body maps quoted keys to
        display strings (a switch, a ternary chain or an inner map).
     2. CARRIERS: every application site of a map (`MAP[x.field]`, `fn(x.field)`)
        names the FIELD that carries those values (`outcome`, `objection_category`…).
     3. RAW RENDERS: every site where such a carrier field reaches a TEXT
        position — `'>' + x.field + '<'`, `escapeHtml(x.field)` in text,
        `'Label: ' + x.field` in a text line — without a label map or label
        function in the same expression. Internal uses are excluded:
        `class="…' + x.field`, `data-*=`, `?field=`, `[x.field]`, `=== '…'`,
        cache/sort keys, `.replace(`/`.split(` operands.
   A carrier field whose values have NO map anywhere is listed separately as
   `noMap` (§4 of the report) and never flagged. Raw line numbers.
   Not covered by construction: maps built at runtime, values that hop through
   several variables before rendering, text assembled inside prompt strings
   (model input, not customer text). Planted: sweep/planted/raw-values.html. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip'); const { mapper } = require('./raw-line');
const LABEL_FN = /^[A-Za-z_]*(?:[Ll]abel|Title|Humani[sz]e|Caption|Display|Pretty)[A-Za-z_]*$/;
function findMaps(src, file, rl) {
  const maps = []; let m;
  const re = /(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*\{([^{}]{10,3000})\}/g;
  while ((m = re.exec(src))) { const entries = [...m[2].matchAll(/(?:'([a-z][a-z0-9_]*)'|\b([a-z][a-z0-9_]*))\s*:\s*'([^'\n]{1,80})'/g)].map((x) => ({ key: x[1] || x[2], label: x[3] }));
    if (entries.length >= 2 && entries.filter((e) => e.label !== e.key && /[A-Z]|\s/.test(e.label)).length >= entries.length * 0.6) maps.push({ kind: 'object', name: m[1], file, line: rl(src.slice(0, m.index).split('\n').length), keys: entries.map((e) => e.key) }); }
  const are = /(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*\[\s*\{[^\]]*?key\s*:\s*'([a-z_]+)'[^\]]*?label\s*:\s*'[^']+'/g;
  while ((m = are.exec(src))) { const block = src.slice(m.index, src.indexOf(']', m.index)); maps.push({ kind: 'array', name: m[1], file, line: rl(src.slice(0, m.index).split('\n').length), keys: [...block.matchAll(/key\s*:\s*'([a-z_]+)'/g)].map((x) => x[1]) }); }
  const fre = /function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  while ((m = fre.exec(src))) { if (!LABEL_FN.test(m[1])) continue; let d = 0, i = m.index + m[0].length - 1, s = i; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
    const body = src.slice(s, i); const keys = [...new Set([...body.matchAll(/(?:===\s*|case\s+|\{|,\s*)'([a-z][a-z0-9_]*)'(?=\s*[:?)]|\s*:)/g)].map((x) => x[1]).concat([...body.matchAll(/\b([a-z][a-z0-9_]*)\s*:\s*'[^'\n]{1,80}'/g)].map((x) => x[1])))];
    if (keys.length >= 2) maps.push({ kind: 'function', name: m[1], file, line: rl(src.slice(0, m.index).split('\n').length), keys }); }
  return maps;
}
function carriersOf(src, maps) {
  const out = {}; const add = (f, n) => { if (f === 'length') return; (out[f] = out[f] || new Set()).add(n); };
  maps.forEach((mp) => {
    /* application sites: MAP[x.field] / fn(x.field) */
    const re = new RegExp('\\b' + mp.name + (mp.kind === 'function' ? '\\(' : '\\[') + '\\s*(?:[A-Za-z_]\\w*\\.)+([a-z][a-z0-9_]*)\\s*[\\])]', 'g'); let m;
    while ((m = re.exec(src))) add(m[1], mp.name);
    /* key-literal evidence: a field compared to or assigned one of the map's keys (≥2 distinct keys) —
       finds carriers the call syntax hides (`objectionLabel(cat)` with a bare variable) */
    const byField = {}; mp.keys.forEach((k) => { const kre = new RegExp("\\.([a-z][a-z0-9_]*)\\s*[!=]==?\\s*'" + k + "'|\\b([a-z][a-z0-9_]*)\\s*:\\s*'" + k + "'", 'g'); let km; while ((km = kre.exec(src))) { const f = km[1] || km[2]; (byField[f] = byField[f] || new Set()).add(k); } });
    Object.entries(byField).forEach(([f, ks]) => { if (ks.size >= 2 && f !== 'key' && f !== 'label' && f !== 'value') add(f, mp.name); });
  });
  return out;
}
const INTERNAL = /class="[^"]*'\s*\+\s*[^+]*\.FIELD|class=\\?"[^"]*'\s*\+\s*[A-Za-z_.]*\.FIELD|data-[a-z-]+="[^"]*'\s*\+\s*[A-Za-z_.]*\.FIELD|[?&][a-z_]+=\s*'\s*\+\s*[A-Za-z_.]*\.FIELD|\[[A-Za-z_.]*\.FIELD\]|\.FIELD\s*[!=]==?\s*'|'\s*[!=]==?\s*[A-Za-z_.]*\.FIELD|\.FIELD\s*\)\s*\.(?:replace|split|toLowerCase|indexOf)|encodeURIComponent\([A-Za-z_.]*\.FIELD/;
function rawRenders(src, file, rl, carriers, allMapNames) {
  const hits = []; const lines = src.split('\n');
  Object.keys(carriers).forEach((field) => { const fre = new RegExp('(?:[A-Za-z_]\\w*\\.)+' + field + '\\b'); const internal = new RegExp(INTERNAL.source.replace(/FIELD/g, field));
    lines.forEach((l0, i) => { if (!fre.test(l0)) return; const l = l0.replace(/class=\\?"[^"]*\\?"/g, 'class=""'); /* a class fragment on the same line must not hide a rendered use (P2) */
      const text = /['"`][^'"`]*>\s*['"`]\s*\+\s*(?:escapeHtml\()?\s*(?:[A-Za-z_]\w*\.)+FIELD|\+\s*(?:escapeHtml\()?\s*(?:[A-Za-z_]\w*\.)+FIELD\s*\)?\s*\+\s*['"`]\s*<|['"`][A-Za-z][^'"`]*:\s*['"`]\s*\+\s*(?:[A-Za-z_]\w*\.)+FIELD|(?:lines|parts|out|rows)\.push\([^)]*\+\s*(?:[A-Za-z_]\w*\.)+FIELD|textContent\s*=\s*(?:[A-Za-z_]\w*\.)+FIELD/.source.replace(/FIELD/g, field);
      if (!new RegExp(text).test(l)) return; if (internal.test(l)) return;
      const labelled = allMapNames.some((n) => new RegExp('\\b' + n + '\\s*[\\[(][^;]*\\.' + field + '\\b').test(l)) || /(?:[Ll]abel|Title|Caption|Display|titleCase|humanize)\w*\([^;]*\.FIELD/.source.replace(/FIELD/g, field) && new RegExp(/(?:[Ll]abel|Title|Caption|Display|titleCase|humanize)\w*\([^;]*\.FIELD/.source.replace(/FIELD/g, field)).test(l);
      if (!labelled) hits.push({ file, line: rl(i + 1), field, maps: [...carriers[field]], text: l0.trim().slice(0, 140) }); }); });
  return hits;
}
function analyse(files) {
  const per = files.map((f) => { const raw = fs.readFileSync(f, 'utf8'); const src = stripComments(raw); return { f, src, rl: mapper(raw, src) }; });
  const maps = []; per.forEach((p) => maps.push(...findMaps(p.src, p.f, p.rl)));
  const allNames = [...new Set(maps.map((m) => m.name))];
  const carriers = {}; per.forEach((p) => { const c = carriersOf(p.src, maps); Object.entries(c).forEach(([k, v]) => { carriers[k] = carriers[k] || new Set(); v.forEach((x) => carriers[k].add(x)); }); });
  const hits = []; per.forEach((p) => hits.push(...rawRenders(p.src, p.f, p.rl, carriers, allNames)));
  return { maps, carriers: Object.fromEntries(Object.entries(carriers).map(([k, v]) => [k, [...v]])), hits };
}
function score() {
  const r = analyse([path.join(__dirname, 'planted', 'raw-values.html')]);
  const at = (n) => r.hits.some((h) => h.line === n); const lines = fs.readFileSync(path.join(__dirname, 'planted', 'raw-values.html'), 'utf8').split('\n');
  const tag = (t) => lines.findIndex((l) => l.indexOf('// ' + t) !== -1) + 1;
  const pos = ['P1', 'P2', 'P3', 'P4', 'P5'], neg = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'];
  return { caught: pos.filter((t) => at(tag(t))).length + '/' + pos.length, falsePositives: neg.filter((t) => at(tag(t))).length + '/' + neg.length, hits: r.hits.map((h) => h.line + ':' + h.field), carriers: r.carriers };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const files = [...fs.readdirSync('lib').map((f) => 'lib/' + f), ...fs.readdirSync('routes').map((f) => 'routes/' + f), ...fs.readdirSync('web').filter((f) => f.endsWith('.html')).map((f) => 'web/' + f), ...fs.readdirSync('web/js').map((f) => 'web/js/' + f)].filter((f) => /\.(js|html)$/.test(f) && fs.statSync(f).isFile());
  const r = analyse(files);
  console.log(JSON.stringify({ maps: r.maps.length, carrierFields: Object.keys(r.carriers).length, rawRenderCandidates: r.hits.length }));
  Object.entries(r.carriers).forEach(([f, ms]) => console.log('CARRIER ' + f + ' ← ' + ms.join(', ')));
  r.hits.forEach((h) => console.log('CANDIDATE ' + h.file + ':' + h.line + ' [' + h.field + ' ← ' + h.maps.join(',') + '] ' + h.text));
  if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 1));
}
module.exports = { analyse, score, findMaps };
