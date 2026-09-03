'use strict';
/* ⑦ AN ABSENT FIELD PASSING A CHECK WRITTEN FOR A WRONG ONE. Three tells,
   each scored against a planted case modelled on a real incident:
     S1 `obj.f === null` / `!== null` where `obj` can lack `f` entirely —
        the rows come from a `.select('…')` in the same function whose column
        list does not name `f`, or from an object literal built without `f`.
        `undefined` is not `null`; the null branch never runs (H048/H094/H634).
     S2 a sentinel string winning a truthiness test — `x.closer_response ? …`
        or `x.closer_response || …` outside `lib/closer-side.js` and its
        guards (`displayCloserResponse`, `provenCloserResponse`, `isSentinel`):
        `'__no_reply__'` is non-empty, so it wins (H109/H611).
     S3 a lane payload read as arrived without the ONE predicate — a renderer
        that reads `d.<field>` / `d.length` / `Array.isArray(d)` on a lane that
        can hold `{ _error }` or `{ _forbidden }`, with no `laneProblem(d)`,
        `d._error` or `d._forbidden` test before it (H569).
   S1 resolves the origin only within the enclosing function; a site whose
   origin it cannot see is printed as `origin: unresolved` for the review, never
   flagged. Raw line numbers. Planted: sweep/planted/absent-field.js */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip'); const { mapper } = require('./raw-line');
function fnBodies(src) {
  const out = []; const re = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*\{/gm; let m;
  while ((m = re.exec(src))) { let d = 0, i = m.index + m[0].length - 1, s = i; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; } out.push({ name: m[1], start: m.index, body: src.slice(s, i + 1), line: src.slice(0, m.index).split('\n').length }); }
  return out;
}
function analyse(files) {
  const hits = [];
  files.forEach((f) => {
    const raw = fs.readFileSync(f, 'utf8'); const src = stripComments(raw); const rl = mapper(raw, src); const fns = fnBodies(src);
    fns.forEach((fn) => {
      const lines = fn.body.split('\n');
      lines.forEach((l, i) => {
        const line = rl(fn.line + i) || (fn.line + i);
        /* S1 */
        [...l.matchAll(/\b([A-Za-z_]\w*)\.([a-z_][a-z0-9_]*)\s*(===|!==)\s*null\b/g)].forEach((m) => {
          const obj = m[1], field = m[2];
          const sel = [...fn.body.matchAll(/\.select\('([^']*)'\)/g)].map((x) => x[1]);
          const lit = [...fn.body.matchAll(new RegExp('(?:var|let|const)\\s+' + obj + '\\s*=\\s*\\{([^{}]*)\\}', 'g'))].map((x) => x[1]);
          let origin = 'unresolved', absent = false;
          if (sel.length) { origin = 'select(' + sel.map((s) => s.slice(0, 40)).join(' | ') + ')'; absent = !sel.some((s) => s === '*' || new RegExp('(^|[,\\s])' + field + '(\\s*[,:]|$)').test(s)); }
          else if (lit.length) { origin = 'literal'; absent = !lit.some((b) => new RegExp('(^|[,\\s{])' + field + '\\s*:').test(b)); }
          hits.push({ tell: 'S1', file: f, line, fn: fn.name, expr: obj + '.' + field + ' ' + m[3] + ' null', origin, flagged: absent, text: l.trim().slice(0, 120) });
        });
        /* S4: `X.error` / `X.data` read where X came from `await …catch(() => undefined)` — X can be undefined, a TypeError, not a branch (the "five dangling promises" shape, H702) */
        [...l.matchAll(/\b([A-Za-z_]\w*)\.(?:error|data)\b/g)].forEach((m) => {
          const v = m[1]; const assigned = new RegExp('\\b' + v + '\\s*=\\s*await\\s+[^;]*\\.catch\\(\\s*(?:function\\s*\\([^)]*\\)|\\([^)]*\\)\\s*=>)\\s*(?:\\{\\s*(?:return\\s+undefined;?\\s*)?\\}|undefined)').test(fn.body);
          if (!assigned) return; const guarded = new RegExp('\\b' + v + '\\s*&&\\s*' + v + '\\.|if\\s*\\(\\s*!' + v + '\\s*\\)').test(fn.body.slice(0, fn.body.indexOf(l) + l.length));
          if (!/\.catch\(/.test(l)) hits.push({ tell: 'S4', file: f, line, fn: fn.name, expr: m[0], origin: guarded ? 'presence-checked first' : 'assigned from a catch that returns undefined', flagged: !guarded, text: l.trim().slice(0, 120) });
        });
        /* S2 */
        if (!/closer-side\.js$/.test(f)) [...l.matchAll(/\b([A-Za-z_]\w*)\.closer_response\s*(\?|\|\|)/g)].forEach((m) => {
          const guarded = /displayCloserResponse|provenCloserResponse|isSentinel|closer_response_verified\s*===\s*true/.test(l) || /displayCloserResponse|provenCloserResponse|isSentinel/.test(fn.body.slice(0, fn.body.indexOf(l)));
          hits.push({ tell: 'S2', file: f, line, fn: fn.name, expr: m[1] + '.closer_response ' + m[2], origin: guarded ? 'guarded earlier in the function' : 'no sentinel guard in scope', flagged: !guarded, text: l.trim().slice(0, 120) });
        });
      });
      /* S3: a renderer of a lane value that reads it without the predicate */
      const lane = fn.body.match(/\b(?:d|data|res|r|o|s)\.(?:length|items|rows|reps|closers|per_rep|working|improve|instances)\b/);
      if (lane && /Html|render|draw/i.test(fn.name)) {
        const guarded = /laneProblem\(|\._error\b|\._forbidden\b|laneWaitHtml\(/.test(fn.body);
        hits.push({ tell: 'S3', file: f, line: rl(fn.line) || fn.line, fn: fn.name, expr: lane[0], origin: guarded ? 'checks _error/_forbidden or laneProblem' : 'reads the payload with no problem test', flagged: !guarded, text: lane[0] });
      }
    });
  });
  return hits;
}
function score() {
  const p = path.join(__dirname, 'planted', 'absent-field.js'); const src = fs.readFileSync(p, 'utf8');
  const hits = analyse([p]); const tagLine = (t) => src.split('\n').findIndex((l) => l.indexOf('// ' + t) !== -1) + 1;
  const near = (t) => hits.some((h) => h.flagged && Math.abs(h.line - tagLine(t)) <= (t.startsWith('P3') || t.startsWith('N4') ? 3 : 0));
  const pos = ['P1', 'P2', 'P3', 'P4', 'P5'], neg = ['N1', 'N2', 'N3', 'N4', 'N5'];
  return { caught: pos.filter(near).length + '/5', falsePositives: neg.filter(near).length + '/5', flagged: hits.filter((h) => h.flagged).map((h) => h.tell + '@' + h.line) };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score())); process.exit(0); }
  const files = [...fs.readdirSync('lib').map((f) => 'lib/' + f), ...fs.readdirSync('routes').map((f) => 'routes/' + f), 'web/dashboard.html'].filter((f) => /\.(js|html)$/.test(f) && fs.statSync(f).isFile());
  const hits = analyse(files);
  const by = (t) => hits.filter((h) => h.tell === t);
  console.log(JSON.stringify({ S4: { sites: by('S4').length, flagged: by('S4').filter((h) => h.flagged).length }, S1: { sites: by('S1').length, flagged: by('S1').filter((h) => h.flagged).length, unresolved: by('S1').filter((h) => h.origin === 'unresolved').length }, S2: { sites: by('S2').length, flagged: by('S2').filter((h) => h.flagged).length }, S3: { renderers: by('S3').length, flagged: by('S3').filter((h) => h.flagged).length } }));
  hits.forEach((h) => console.log((h.flagged ? 'CANDIDATE ' : 'ok        ') + h.tell + ' ' + h.file + ':' + h.line + ' [' + h.fn + '] ' + h.expr + ' — ' + h.origin + (h.flagged ? '  ' + h.text : '')));
  if (process.argv[2] === '--json') fs.writeFileSync(process.argv[3], JSON.stringify(hits, null, 1));
}
module.exports = { analyse, score };
