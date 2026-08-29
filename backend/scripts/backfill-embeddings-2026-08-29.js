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
/* ⚠⚠ THE 3 RPM / 10K TPM CEILING IS GONE — CONFIRMED FROM THE PROVIDER, not
   assumed from the card being added: five unpaced requests of 96 texts and
   9,600 tokens each all returned 200 in ~2 seconds. Under the old tier the
   FIRST of those would have exhausted the minute's token allowance.
   ⚠ SO THE PACING IS OFF BY DEFAULT. Leaving it in would be a self-imposed
   limit with no reason behind it, and an unexplained constant is exactly what
   the next person inherits and works around. The knob SURVIVES (--pace) because
   the tier is an account property that can change back; what does not survive
   is it being on by default with a stale justification.
   ⚠ The token budget STAYS, at a real per-request bound rather than a
   per-minute one: a page of 96 long chunks is a genuinely large request, and
   paging by tokens is what stops one oversized request failing wholesale. */
const TOKEN_BUDGET = 60000;
const PACE_MS = process.argv.includes('--pace') ? 21000 : 0;
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
  console.log('packed into ' + pages.length + ' request(s)'
    + (PACE_MS ? ', one per ' + (PACE_MS / 1000) + 's' : ' — unpaced (standard tier)'));

  let embedded = 0, failed = 0, written = 0;
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    /* ⚠ THE RETRY IS BACK ON, and the reason it was OFF is worth keeping: under
       a 3 RPM ceiling three attempts fired inside 1.5s and ate the whole
       minute's budget, so the retry converted one failed page into two
       (measured 143 written / 134 failed). With the ceiling lifted, a 429 is a
       genuine blip again and retrying it is the right response. When --pace is
       set, drop back to a single attempt for the same reason as before. */
    const vecs = await getVoyageEmbeddings(page.map(r => r.content), 'backfill',
      PACE_MS ? { attempts: 1 } : undefined);
    for (let j = 0; j < page.length; j++) {
      if (!vecs[j]) { failed++; continue; }
      embedded++;
      const { error } = await admin.from('knowledge_base')
        .update({ embedding: vecs[j] }).eq('id', page[j].id);
      if (error) console.warn('write failed for ' + page[j].id + ': ' + error.message);
      else written++;
    }
    console.log('  page ' + (p + 1) + '/' + pages.length + ' (' + page.length + ' rows) — written ' + written + ', failed ' + failed);
    if (PACE_MS && p < pages.length - 1) await nap(PACE_MS);
  }
  console.log('\nPASS DONE. written=' + written + ' failed=' + failed);
  if (failed > 0) console.log('Re-run to sweep the ' + failed + ' that were rate-limited this pass.');
})();
