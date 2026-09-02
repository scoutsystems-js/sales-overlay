'use strict';
/* ⑧ A PAGINATION LIMIT PRESENTING AS AN ABSENCE.
   Finds Supabase READ chains with no range()/limit()/single()/maybeSingle() and
   no chunked-id filter, on tables that GROW with usage. PostgREST returns 1,000
   rows and stops silently.
   Scope: lib/ and routes/, comments stripped (line-first, then block). A chain
   is the text from `.from('table')` to the next `;`. A read is a chain with
   .select( and no insert/update/upsert/delete. Bounded = range/limit/single/
   maybeSingle, OR an .in() whose list is a slice of ≤100 ids (chunked reads —
   flagged separately as "chunked", with the per-id multiplier left to review).
   CLAIM: "this read can return more than 1,000 rows if its filter matches
   more than 1,000 rows" — it does NOT claim the filter does today; that is
   the review's job with a row count. */
const fs = require('fs'); const path = require('path');
const { stripComments } = require('./strip');
const { mapper } = require('./raw-line');
const GROWING = { fathom_calls: 1, call_analyses: 1, call_highlights: 1, knowledge_base: 1, objection_synthesis_cache: 1, prospects: 1, model_usage: 1, support_tickets: 1, eod_reports: 1 };
function scan(files) {
  const out = [];
  files.forEach((f) => {
    const raw = fs.readFileSync(f, 'utf8');
    const src = stripComments(raw); const rawLine = mapper(raw, src);
    const re = /\.from\('([a-z_]+)'\)/g; let m;
    while ((m = re.exec(src))) {
      const end = src.indexOf(';', m.index); const chain = src.slice(m.index, end === -1 ? m.index + 600 : end);
      if (!/\.select\(/.test(chain) || /\.(insert|update|upsert|delete)\(/.test(chain)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      /* A COUNT query (`head: true`) returns no rows — it is not a read of rows and
         cannot be capped. The first real-code run flagged 11 of them; recorded. */
      const isCount = /head:\s*true/.test(chain);
      /* A builder assigned WITHOUT await (`var q = admin.from(...)`) may be bounded
         in a LATER statement (`q = q.range(...)`, a PAGE loop). Two real sites
         (routes/fathom.js call library and the zoom-retry page loop) were flagged
         before this look-ahead; N7 pins it. Scope: the next 15 stripped lines. */
      const head = src.slice(Math.max(0, m.index - 120), m.index); /* `var q = admin\n  .from(` spans a line */
      const builders = [...head.matchAll(/(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*(?!await)[^;]*$/g)]; const builder = builders.length ? builders[builders.length - 1] : null;
      const ahead = builder ? src.slice(end === -1 ? m.index : end, (end === -1 ? m.index : end) + 1500).split('\n').slice(0, 15).join('\n') : '';
      const laterBound = !!builder && new RegExp('\\b' + builder[1] + '\\b[^;\\n]*\\.(?:range|limit)\\(').test(ahead);
      const bounded = isCount || laterBound || /\.(range|limit)\(|\.maybeSingle\(|\.single\(/.test(chain);
      const chunked = /\.in\([^)]*\.slice\(/.test(chain) || /\.in\('[a-z_]+', (chunk|slice|ids\.slice|batch)/.test(chain);
      const filters = [...chain.matchAll(/\.(eq|in|gte|lte|gt|lt|not|is|ilike|or)\('?([a-z_>-]+)/g)].map((x) => x[1] + ':' + x[2]);
      out.push({ file: f, line: rawLine(line) || line, strippedLine: line, table: m[1], growing: !!GROWING[m[1]], bounded, chunked, filters, verdict: bounded ? 'bounded' : (chunked ? 'chunked' : (GROWING[m[1]] ? 'CANDIDATE' : 'small-table')) });
    }
  });
  return out;
}
function score() {
  const p = path.join(__dirname, 'planted', 'unbounded-reads.js');
  const hits = scan([p]);
  const expect = { CANDIDATE: ['P1', 'P2', 'P3', 'P4', 'P5'], notCandidate: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'] };
  /* ⚠ Tags are read from the STRIPPED source — hit lines are stripped-source
     lines. Reading the raw file here shifted every tag by one and scored the
     detector 4/5 with the wrong row blamed: a scorer bug, caught by the score. */
  const byTag = {}; const src = stripComments(fs.readFileSync(p, 'utf8')).split('\n');
  hits.forEach((h) => { const tag = (src[h.strippedLine - 1].match(/\/\/\s*(P\d|N\d)/) || [])[1]; if (tag) byTag[tag] = h.verdict; });
  const caught = expect.CANDIDATE.filter((t) => byTag[t] === 'CANDIDATE').length;
  const falseHits = expect.notCandidate.filter((t) => byTag[t] === 'CANDIDATE').length;
  return { caught: caught + '/5', falsePositives: falseHits + '/' + expect.notCandidate.length, detail: byTag };
}
if (require.main === module) {
  if (process.argv[2] === '--score') { console.log(JSON.stringify(score(), null, 1)); process.exit(0); }
  const files = [...fs.readdirSync('lib').map((f) => 'lib/' + f), ...fs.readdirSync('routes').map((f) => 'routes/' + f)].filter((f) => f.endsWith('.js'));
  const hits = scan(files);
  const c = hits.filter((h) => h.verdict === 'CANDIDATE'); const ch = hits.filter((h) => h.verdict === 'chunked');
  console.log(JSON.stringify({ reads: hits.length, candidates: c.length, chunked: ch.length, small: hits.filter((h) => h.verdict === 'small-table').length, bounded: hits.filter((h) => h.verdict === 'bounded').length }));
  c.forEach((h) => console.log('CANDIDATE ' + h.file + ':' + h.line + ' ' + h.table + ' filters=' + h.filters.join(',')));
  ch.forEach((h) => console.log('chunked   ' + h.file + ':' + h.line + ' ' + h.table + ' filters=' + h.filters.join(',')));
}
module.exports = { scan, score };
