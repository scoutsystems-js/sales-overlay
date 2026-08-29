/**
 * Backfill embeddings for knowledge_base rows that have none.
 *
 * ⚠⚠ THIS SCRIPT REFUSES TO START WITHOUT THE CAPABILITY, and that is the whole
 * point of it existing as a script rather than a one-liner. The gap it repairs
 * was CAUSED by a batch run in a shell with no VOYAGE_API_KEY: the degrade is
 * correct (rows still write, keyword-searchable) so nothing looked wrong, and
 * 84 moments were written unembedded before anyone noticed. A backfill that
 * inherited the same missing capability would report success and change nothing.
 *
 * ⚠ It also pins to VERIFIED IDS: it selects the rows, prints the count, and on
 * --run updates exactly those. It never re-derives the set at write time.
 *
 * ⚠⚠ PACED FOR A 3 RPM / 10K TPM ACCOUNT. Measured 2026-08-29: an unbilled
 * Voyage account is capped at THREE REQUESTS PER MINUTE, and the provider says
 * so in the 429 body. A fixed 96-row page blows the token cap on its own, and
 * firing pages back to back 429s everything after the first. So this pages by a
 * TOKEN BUDGET and sleeps between requests. It is slow ON PURPOSE — the retry
 * in lib/voyage cannot defeat a per-minute ceiling and should not try.
 *
 * Usage:  node scripts/backfill-embeddings-2026-08-29.js [--run] [--limit N]
 *         (default is a DRY RUN that writes nothing)
 */
'use strict';
require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');
const { getVoyageEmbeddings, embeddingCapability, VOYAGE_MAX_INPUTS } = require('../lib/voyage');

const RUN = process.argv.includes('--run');
/* ⚠⚠ BOTH CEILINGS BIND, AND THE TOKEN ONE IS THE TIGHTER. The account is
   capped at 3 RPM *and* 10K TPM. Sizing pages to ~8K tokens and sending one
   every 21s satisfies the REQUEST limit and blows the TOKEN limit 2.3x — which
   is what a first paced run actually did (55 written / 90 rate-limited).
   3K per page at one page per 21s is ~8.6K TPM and 2.9 RPM: under both.
   ⚠ The consequence is that ~370K tokens of backlog takes ~40 minutes no matter
   how it is paged. That floor is the account tier, not the code. */
const TOKEN_BUDGET = 3000;
const PACE_MS = 21000;            // 3 RPM => one request per 20s, plus a margin
const estTokens = t => Math.ceil((t || '').length / 4);
const nap = ms => new Promise(r => setTimeout(r, ms));
const li = process.argv.indexOf('--limit');
const LIMIT = li !== -1 ? Number(process.argv[li + 1]) : Infinity;

(async () => {
  // ── the capability abort, before anything else ──────────────────────────
  const cap = embeddingCapability();
  if (!cap.ok) {
    console.error('REFUSING TO START: ' + cap.reason);
    console.error('Every row would be rewritten with a null embedding — exactly the fault this repairs.');
    process.exit(1);
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Page through every unembedded row. `id` + `content` only — nothing else is needed.
  let rows = [], from = 0;
  for (;;) {
    const { data, error } = await admin.from('knowledge_base')
      .select('id, content, category')
      .is('embedding', null)
      .range(from, from + 999);
    if (error) { console.error('select failed:', error.message); process.exit(1); }
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  rows = rows.filter(r => r.content && r.content.trim().length > 0);
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);

  const byCat = {};
  rows.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
  console.log('unembedded rows with content: ' + rows.length);
  Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])
    .forEach(c => console.log('  ' + String(c).padEnd(22) + byCat[c]));
  console.log('pages of ' + VOYAGE_MAX_INPUTS + ': ' + Math.ceil(rows.length / VOYAGE_MAX_INPUTS));
  if (!RUN) { console.log('\nDRY RUN — nothing written. Re-run with --run.'); return; }

  /* Pack rows into pages that fit the per-minute TOKEN allowance. */
  const pages = [];
  let cur = [], curTok = 0;
  for (const r of rows) {
    const t = estTokens(r.content);
    if (cur.length && (curTok + t > TOKEN_BUDGET || cur.length >= VOYAGE_MAX_INPUTS)) {
      pages.push(cur); cur = []; curTok = 0;
    }
    cur.push(r); curTok += t;
  }
  if (cur.length) pages.push(cur);
  console.log('paced into ' + pages.length + ' request(s), one per ' + (PACE_MS / 1000) + 's');

  let embedded = 0, failed = 0, written = 0;
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    /* ⚠ ONE ATTEMPT, deliberately. Under a 3 RPM ceiling the inline retry
       burns the whole minute's budget on a single page and makes the NEXT page
       fail too — measured: 143 written / 134 failed before this was fixed. A
       page that fails here is simply left for the next PASS. */
    const vecs = await getVoyageEmbeddings(page.map(r => r.content), 'backfill', { attempts: 1 });
    for (let j = 0; j < page.length; j++) {
      if (!vecs[j]) { failed++; continue; }
      embedded++;
      const { error } = await admin.from('knowledge_base')
        .update({ embedding: vecs[j] }).eq('id', page[j].id);
      if (error) console.warn('write failed for ' + page[j].id + ': ' + error.message);
      else written++;
    }
    console.log('  page ' + (p + 1) + '/' + pages.length + ' (' + page.length + ' rows) — written ' + written + ', failed ' + failed);
    if (p < pages.length - 1) await nap(PACE_MS);
  }
  console.log('\nPASS DONE. written=' + written + ' failed=' + failed);
  if (failed > 0) console.log('Re-run to sweep the ' + failed + ' that were rate-limited this pass.');
})();
