'use strict';
/* ③ ONE QUESTION, MANY ANSWERS — the same string list, named threshold or
   direction declared in more than one place with NOTHING forcing agreement.
   Scope: lib/, routes/, web/dashboard.html, comments stripped; test/ is read
   only to find what PINS a pair (a mirror guard that asserts two copies equal
   counts as "something forcing agreement" and demotes the pair).
   Shapes:
     LIST      — an array literal of ≥3 quoted strings whose SET appears in ≥2
                 files (or twice in one), where the duplicating file does not
                 require() the file that also declares it. Order is compared
                 separately (a list whose ORDER is load-bearing — H090).
     THRESHOLD — `NAME = <number>` for the same NAME in ≥2 files with a number
                 on the right; differing numbers are the loud case.
     DIRECTION — `direction`/`targetDirection`/`side` values keyed by metric
                 id in ≥2 files.
   NOT a finding by construction: a copy that is `require()`d from the
   declaring module; a pair a mirror test pins (test/*mirror*, *carrier*,
   *one-definition*, *single-source*, *constants*). CLAIM: "these copies can
   answer differently and nothing checks" — whether they DO today is printed
   (same/different) so the review ranks by what divergence would cost. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
const { mapper } = require('./raw-line');
function listsIn(src, file) {
  const out = [];
  [...src.matchAll(/\[\s*((?:'[^'\n]{1,60}'\s*,\s*){2,}'[^'\n]{1,60}'\s*,?)\s*\]/g)].forEach((m) => {
    const items = [...m[1].matchAll(/'([^'\n]+)'/g)].map((x) => x[1]); if (items.length < 3 || items.length > 40) return;
    const line = src.slice(0, m.index).split('\n').length; out.push({ file, line, items, key: items.slice().sort().join('|') });
  });
  return out;
}
function thresholdsIn(src, file) {
  return [...src.matchAll(/(?:const|var|let)\s+([A-Z][A-Z0-9_]{2,})\s*=\s*(-?\d+(?:\.\d+)?)\s*[;,]/g)].map((m) => ({ file, name: m[1], value: Number(m[2]), line: src.slice(0, m.index).split('\n').length }));
}
function directionsIn(src, file) {
  const out = []; const re = /\b([a-z_]{4,})\s*:\s*\{[^{}]*?\b(?:direction|targetDirection|side)\s*:\s*'([a-z_]+)'/g; let m;
  while ((m = re.exec(src))) out.push({ file, key: m[1], value: m[2], line: src.slice(0, m.index).split('\n').length });
  return out;
}
function requiresOf(src) { return [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => path.basename(m[1]).replace(/\.js$/, '')); }
function analyse(files, testSrcs) {
  const lists = [], thresholds = [], directions = [], reqs = {};
  files.forEach((f) => { const raw = fs.readFileSync(f, 'utf8'); const src = stripComments(raw); const rawLine = mapper(raw, src); const fix = (xs) => xs.map((x) => Object.assign(x, { line: rawLine(x.line) || x.line })); lists.push(...fix(listsIn(src, f))); thresholds.push(...fix(thresholdsIn(src, f))); directions.push(...fix(directionsIn(src, f))); reqs[f] = requiresOf(src); }); /* RAW line numbers, via the mapper — the first run printed stripped lines */
  const pinned = (items) => testSrcs.some((t) => items.every((i) => t.indexOf("'" + i + "'") !== -1));
  const byKey = {}; lists.forEach((l) => (byKey[l.key] = byKey[l.key] || []).push(l));
  const listHits = Object.values(byKey).filter((v) => v.length > 1).map((v) => {
    const filesIn = [...new Set(v.map((x) => x.file))]; const base = filesIn.map((f) => path.basename(f).replace(/\.(js|html)$/, ''));
    const derived = filesIn.filter((f) => (reqs[f] || []).some((r) => base.includes(r)) );
    const orders = new Set(v.map((x) => x.items.join('|')));
    return { shape: 'LIST', items: v[0].items, sites: v.map((x) => x.file + ':' + x.line), files: filesIn.length, derivedSites: derived.length, sameOrder: orders.size === 1, pinnedByTest: pinned(v[0].items) };
  }).filter((h) => h.files > 1 || h.sites.length > 1);
  const byName = {}; thresholds.forEach((t) => (byName[t.name] = byName[t.name] || []).push(t));
  const thHits = Object.entries(byName).filter(([, v]) => new Set(v.map((x) => x.file)).size > 1).map(([name, v]) => ({ shape: 'THRESHOLD', name, sites: v.map((x) => x.file + ':' + x.line + '=' + x.value), agree: new Set(v.map((x) => x.value)).size === 1, pinnedByTest: testSrcs.some((t) => t.indexOf(name) !== -1) }));
  const byMetric = {}; directions.forEach((d) => (byMetric[d.key] = byMetric[d.key] || []).push(d));
  const dirHits = Object.entries(byMetric).filter(([, v]) => new Set(v.map((x) => x.file)).size > 1).map(([key, v]) => ({ shape: 'DIRECTION', key, sites: v.map((x) => x.file + ':' + x.line + '=' + x.value), agree: new Set(v.map((x) => x.value)).size === 1, pinnedByTest: testSrcs.some((t) => t.indexOf(key) !== -1 && /direction|side/.test(t)) }));
  return { listHits, thHits, dirHits };
}
function score() {
  const dir = path.join(__dirname, 'planted', 'one-question'); const files = fs.readdirSync(dir).filter((f) => /\.js$/.test(f) && !/test/.test(f)).map((f) => path.join(dir, f));
  const tests = fs.readdirSync(dir).filter((f) => /mirror/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  const r = analyse(files, tests);
  const flag = (pred) => [...r.listHits, ...r.thHits, ...r.dirHits].some(pred);
  const pos = { P1_list_two_files: flag((h) => h.shape === 'LIST' && h.items.includes('alpha') && h.derivedSites === 0 && !h.pinnedByTest),
                P2_threshold_two_values: flag((h) => h.shape === 'THRESHOLD' && h.name === 'MAX_ROWS' && !h.agree),
                P3_direction_disagrees: flag((h) => h.shape === 'DIRECTION' && h.key === 'call_time' && !h.agree),
                P4_list_same_file_twice: flag((h) => h.shape === 'LIST' && h.items.includes('one') && h.sites.length > 1),
                P5_threshold_same_value_unpinned: flag((h) => h.shape === 'THRESHOLD' && h.name === 'CHUNK' && h.agree && !h.pinnedByTest) };
  const neg = { N1_list_imported: flag((h) => h.shape === 'LIST' && h.items.includes('imp1') && h.derivedSites === 0),
                N2_list_pinned_by_mirror: flag((h) => h.shape === 'LIST' && h.items.includes('pin1') && !h.pinnedByTest),
                N3_different_lists_share_a_word: flag((h) => h.shape === 'LIST' && h.items.includes('shared') && h.items.length === 3 && h.sites.length > 1 && !h.items.includes('pin1')),
                N4_threshold_pinned: flag((h) => h.shape === 'THRESHOLD' && h.name === 'PINNED_MAX' && !h.pinnedByTest),
                N5_single_declaration: flag((h) => h.shape === 'THRESHOLD' && h.name === 'ONLY_ONCE') };
  return { caught: Object.values(pos).filter(Boolean).length + '/5', falsePositives: Object.values(neg).filter(Boolean).length + '/5', pos, neg };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const files = [...fs.readdirSync('lib').map((f) => 'lib/' + f), ...fs.readdirSync('routes').map((f) => 'routes/' + f), 'web/dashboard.html'].filter((f) => /\.(js|html)$/.test(f));
  const tests = fs.readdirSync('test').filter((f) => /mirror|carrier|one-definition|single-source|constants/.test(f)).map((f) => fs.readFileSync('test/' + f, 'utf8'));
  const r = analyse(files, tests);
  console.log(JSON.stringify({ lists: r.listHits.length, listsUnpinnedUnderived: r.listHits.filter((h) => !h.pinnedByTest && h.derivedSites === 0).length, thresholds: r.thHits.length, thresholdsDisagree: r.thHits.filter((h) => !h.agree).length, directions: r.dirHits.length, directionsDisagree: r.dirHits.filter((h) => !h.agree).length }));
  r.listHits.forEach((h) => console.log('LIST ' + (h.pinnedByTest ? '[pinned] ' : '') + (h.derivedSites ? '[derived:' + h.derivedSites + '] ' : '') + (h.sameOrder ? '' : '[ORDER DIFFERS] ') + JSON.stringify(h.items.slice(0, 6)) + (h.items.length > 6 ? '…' : '') + ' ← ' + h.sites.join(' ')));
  r.thHits.forEach((h) => console.log('THRESHOLD ' + (h.agree ? 'same ' : 'DIFFERENT ') + (h.pinnedByTest ? '[pinned] ' : '') + h.name + ' ← ' + h.sites.join(' ')));
  r.dirHits.forEach((h) => console.log('DIRECTION ' + (h.agree ? 'same ' : 'DIFFERENT ') + (h.pinnedByTest ? '[pinned] ' : '') + h.key + ' ← ' + h.sites.join(' ')));
  if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 1));
}
module.exports = { analyse, score };
