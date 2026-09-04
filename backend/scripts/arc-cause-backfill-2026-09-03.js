#!/usr/bin/env node
'use strict';
/**
 * The backward cause pass (H719) — approved by Justin 2026-09-03 at five minutes (~$7.50).
 *
 * TARGET: every buying-signal moment in the knowledge base (1,050 on 264 calls at
 * design time) whose call has a stored transcript with proven CLOSER/PROSPECT
 * labels. For each: the five-minute window before the signal (widened once to
 * eight when fewer than two closer questions sit inside), ONE model call on lane
 * `arc-cause` with the SAME prompt block the extractor sends, the answer verified
 * by lib/arc-cause.js (two or three located closer lines or `none — not_evidenced`),
 * then written to the KB row's metadata + content (re-embedded in batches) and to
 * the matching call_highlights row when one still exists (matched by call + quote —
 * highlight ids are reissued on re-analysis, so the stored source_highlight_id is
 * stale on every one of them).
 *
 * `--extra-open N` adds N buying-signal HIGHLIGHTS from Josh's real calls that did
 * NOT close (never harvested, so no KB row) — Justin's test needs one such moment;
 * about 0.7¢ each. Written to call_highlights.cause only.
 *
 * DRY BY DEFAULT: prints the target set, the window token estimate and the dollars.
 * `--approved "<who, when>"` runs it. `--limit N` for a smoke. Concurrency 4
 * (under the ceiling of six, H250); saturation (429/529/overloaded) three times in
 * a row ABORTS — never "any error". Every write is reversible: `cause_run_id` on
 * the KB metadata and on the highlight row names this run.
 */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
process.env.VOYAGE_API_KEY = pick('VOYAGE_API_KEY') || process.env.VOYAGE_API_KEY;
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const arc = require('../lib/arc-cause');
const { labelForQuote } = require('../lib/quote-locate');
const W = require('../lib/analysis-worker');
const { usageFor, setUsageRecorder } = require('../lib/model-usage');
const { getVoyageEmbeddings, embeddingCapability } = require('../lib/voyage');
const { quoteHash } = require('../lib/kb-entry');
const { CHUNK } = require('../lib/chunk');
const { realCallsOnly } = require('../lib/real-calls');
const createArc = usageFor('arc-cause');

const args = process.argv.slice(2);
const COUNT = args.indexOf('--count') !== -1;   // exact input tokens via the free counting endpoint — no spend
const flag = (n) => args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : null;
const APPROVED = flag('--approved'); const LIMIT = flag('--limit') ? Number(flag('--limit')) : Infinity;
const EXTRA_OPEN = flag('--extra-open') ? Number(flag('--extra-open')) : 0;
/* ⚠ THE BUDGET IS THE APPROVAL. Justin approved "~$7.50"; the exact count over every prompt
   (free endpoint, 2026-09-04) is $11.05 — the design costing under-counted the window and
   the prompt block. So the run is capped at the approved dollars, in seeded-random CALL
   order (whole calls, so a per-rep `none` rate is read on complete calls), and the rest
   waits for a new yes. Per-signal cost from the exact count: 2,643 input + ~160 output
   tokens = about 1.03¢. */
const BUDGET = flag('--budget') ? Number(flag('--budget')) : Infinity;
const COST_PER_SIGNAL = 2643 * (3 / 1e6) + 160 * (15 / 1e6);
const JOSH = '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1';
const CONCURRENCY = 4; const MODEL = 'claude-sonnet-4-6';
const RUN_ID = 'arc-cause-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT_DIR = path.join(os.homedir(), 'Desktop', 'scan-reports', 'arc-cause'); fs.mkdirSync(OUT_DIR, { recursive: true });
const IN_PRICE = 3 / 1e6, OUT_PRICE = 15 / 1e6;

function tokens(s) { return Math.ceil(String(s || '').length / 3.6); }
function isSaturation(e) { const st = e && (e.status || e.statusCode); return st === 429 || st === 529 || /overloaded|rate.?limit/i.test(String(e && e.message)); }

function buildPrompt(windowText, signal) {
  return [
    'You are a film coach reviewing tape. Below is the stretch of a sales call leading up to a BUYING SIGNAL from the prospect. Your ONE job: say what the CLOSER did to earn it, from a closed vocabulary, evidenced by his own lines — or say "none".',
    '',
    'HOW TO QUOTE — every quoted field: COPY a contiguous run of characters from ONE transcript line, exactly as written. Do not merge lines, skip words, tidy grammar or change punctuation. To shorten, cut from the ends only. A quote that is not a character-for-character span of a transcript line is discarded, and one discarded line discards the whole cause.',
    '',
    arc.causePromptBlock(),
    '',
    'THE SIGNAL (the prospect, at [' + W._formatSeconds(signal.timestamp_seconds) + ']): "' + signal.quote + '"',
    'What happened: ' + (signal.observation || ''),
    '',
    'THE MINUTES BEFORE IT:',
    windowText,
    '',
    'Reply with ONLY a JSON object of the shape {"cause": {"move": ..., "evidence": [{"timestamp_seconds": N, "quote": "..."}], "summary": "...", "none_reason": ...}} — no prose around it.',
  ].join('\n');
}

async function loadTargets() {
  // 1. the library's buying signals (paged; the table grows)
  const kb = []; for (let from = 0; ; from += 1000) {
    const r = await admin.from('knowledge_base').select('id, content, metadata, uploaded_by').eq('category', 'learned_pattern').range(from, from + 999);
    if (r.error) throw new Error('kb read: ' + r.error.message);
    kb.push(...r.data.filter((k) => k.metadata && k.metadata.type === 'buying_signal' && k.metadata.source_fathom_call_id));
    if (r.data.length < 1000) break;
  }
  const callIds = Array.from(new Set(kb.map((k) => k.metadata.source_fathom_call_id)));
  const turnsByCall = {}; const hlByCall = {};
  for (let i = 0; i < callIds.length; i += CHUNK) {
    const ids = callIds.slice(i, i + CHUNK);
    const a = await admin.from('call_analyses').select('fathom_call_id, transcript_stored').in('fathom_call_id', ids);
    if (a.error) throw new Error('analyses read: ' + a.error.message);
    a.data.forEach((r) => { turnsByCall[r.fathom_call_id] = (r.transcript_stored && r.transcript_stored.turns) || null; });
    const h = await admin.from('call_highlights').select('id, fathom_call_id, quote, type, cause').in('fathom_call_id', ids).eq('type', 'buying_signal');
    if (h.error) throw new Error('highlights read: ' + h.error.message);
    h.data.forEach((r) => { (hlByCall[r.fathom_call_id] = hlByCall[r.fathom_call_id] || []).push(r); });
  }
  const targets = []; const skipped = { no_turns: 0, unmatched_labels: 0, no_timestamp: 0, already: 0 };
  kb.forEach((k) => {
    const m = k.metadata; const turns = turnsByCall[m.source_fathom_call_id];
    if (!turns || !turns.length) { skipped.no_turns++; return; }
    if (!turns.some((t) => t.speaker === 'CLOSER' || t.speaker === 'PROSPECT')) { skipped.unmatched_labels++; return; }
    if (typeof m.timestamp_seconds !== 'number') { skipped.no_timestamp++; return; }
    if (m.cause && m.cause_run_id) { skipped.already++; return; }
    const qh = quoteHash(m.quote);
    const hl = (hlByCall[m.source_fathom_call_id] || []).find((h) => quoteHash(h.quote) === qh) || null;
    targets.push({ kind: 'kb', kb_id: k.id, content: k.content, user_id: k.uploaded_by, call_id: m.source_fathom_call_id, highlight_id: hl ? hl.id : null,
      signal: { timestamp_seconds: m.timestamp_seconds, quote: m.quote, observation: m.observation }, turns });
  });
  // 2. the extra open-call highlights (Josh, real, not closed)
  const extra = [];
  if (EXTRA_OPEN > 0) {
    const r = await admin.from('fathom_calls').select('id, fathom_call_id, not_a_sales_call, duplicate_of').eq('user_id', JOSH).is('duplicate_of', null);
    if (r.error) throw new Error('josh calls: ' + r.error.message);
    // H369: realCallsOnly filters ROWS — the seed-/demo- copies of Josh's calls never enter the set.
    const ids = realCallsOnly(r.data).filter((c) => !c.not_a_sales_call).map((c) => c.id);
    const open = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const a = await admin.from('call_analyses').select('fathom_call_id, outcome, transcript_stored').in('fathom_call_id', ids.slice(i, i + CHUNK)).in('outcome', ['lost', 'follow_up']);
      if (a.error) throw new Error(a.error.message);
      a.data.forEach((x) => { if (x.transcript_stored && x.transcript_stored.turns && x.transcript_stored.turns.some((t) => t.speaker === 'CLOSER')) open.push(x); });
    }
    // seeded shuffle — honest, not the best-looking
    let seed = 20260903; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    open.sort(() => rnd() - 0.5);
    for (const x of open) {
      if (extra.length >= EXTRA_OPEN) break;
      const h = await admin.from('call_highlights').select('id, quote, observation, timestamp_seconds, cause').eq('fathom_call_id', x.fathom_call_id).eq('type', 'buying_signal').is('cause', null).limit(1);
      if (h.error || !h.data.length) continue;
      extra.push({ kind: 'highlight', highlight_id: h.data[0].id, user_id: JOSH, call_id: x.fathom_call_id, outcome: x.outcome,
        signal: { timestamp_seconds: h.data[0].timestamp_seconds, quote: h.data[0].quote, observation: h.data[0].observation }, turns: x.transcript_stored.turns });
    }
  }
  return { targets, extra, skipped, kbRows: kb.length, calls: callIds.length };
}

/* `--reembed-only <run_id>`: the touched KB rows' vectors, again. The first run wrote 706 rows
   with their new sentence and then found no Voyage key in the local environment (the key lives
   on Railway only) — the content changed and the vector did not, which is worse than unembedded
   because nothing marks it stale. Batched, never per row. */
async function reembedOnly(runId) {
  const rows = []; for (let from = 0; ; from += 1000) {
    const r = await admin.from('knowledge_base').select('id, content, metadata').eq('category', 'learned_pattern').range(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    rows.push(...r.data.filter((k) => k.metadata && k.metadata.cause_run_id === runId));
    if (r.data.length < 1000) break;
  }
  let embedded = 0, unembedded = 0;
  for (let b = 0; b < rows.length; b += 100) {
    const batch = rows.slice(b, b + 100);
    const embs = await getVoyageEmbeddings(batch.map((r) => r.content), 'arc-cause-reembed');
    for (let k = 0; k < batch.length; k++) {
      if (embs && embs[k]) { const u = await admin.from('knowledge_base').update({ embedding: embs[k] }).eq('id', batch[k].id); if (!u.error) { embedded++; continue; } }
      unembedded++;
    }
  }
  console.log('re-embed ' + runId + ': ' + rows.length + ' rows, embedded ' + embedded + ', unembedded ' + unembedded);
}

(async () => {
  if (flag('--reembed-only')) { await reembedOnly(flag('--reembed-only')); return; }
  const { targets, extra, skipped, kbRows, calls } = await loadTargets();
  // seeded-random CALL order, the extra open-call moments first (they are the test's requirement and cost cents)
  let seed = 20260904; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const callOrder = Array.from(new Set(targets.map((t) => t.call_id))).map((id) => ({ id, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.id);
  const rank = {}; callOrder.forEach((id, k) => { rank[id] = k; });
  const ordered = targets.slice().sort((a, b) => rank[a.call_id] - rank[b.call_id]);
  const affordable = isFinite(BUDGET) ? Math.max(0, Math.floor(BUDGET / COST_PER_SIGNAL) - extra.length) : Infinity;
  const all = extra.concat(ordered.slice(0, affordable)).slice(0, LIMIT);
  const held = targets.length - Math.min(targets.length, affordable);
  let inTok = 0; const windows = { 300: 0, 480: 0 };
  all.forEach((t) => { const w = arc.windowTurns(t.turns, t.signal.timestamp_seconds); windows[w.seconds]++; inTok += tokens(buildPrompt(W._formatTurnsForPrompt(w.turns), t.signal)); });
  const est = inTok * IN_PRICE + all.length * 160 * OUT_PRICE;
  console.log('run ' + RUN_ID + (APPROVED ? ' APPROVED by ' + APPROVED : ' DRY RUN'));
  console.log('library buying signals: ' + kbRows + ' on ' + calls + ' calls; targets that CAN succeed: ' + targets.length + '; skipped ' + JSON.stringify(skipped) + '; highlight rows still matching by quote: ' + targets.filter((t) => t.highlight_id).length);
  console.log('budget $' + BUDGET + ' → ' + all.length + ' prompts this run, ' + held + ' library signals HELD for a further approval (about $' + (held * COST_PER_SIGNAL).toFixed(2) + ')');
  console.log('extra open-call highlights: ' + extra.length + '; windows five-min ' + windows[300] + ' / eight-min ' + windows[480] + '; estimated input tokens ' + inTok + ' → about $' + est.toFixed(2) + ' at list');
  if (COUNT) {
    let exact = 0, c = 0;   // SDK 0.27.3 has no countTokens — the raw endpoint is free
    const prompts = all.map((t) => buildPrompt(W._formatTurnsForPrompt(arc.windowTurns(t.turns, t.signal.timestamp_seconds).turns), t.signal));
    let j = 0; async function counter() { while (j < prompts.length) { const p = prompts[j++]; const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: p }] }) });
      const r = await res.json(); if (typeof r.input_tokens !== 'number') throw new Error('count_tokens: ' + JSON.stringify(r).slice(0, 200)); exact += r.input_tokens; c++; } }
    await Promise.all(Array.from({ length: 8 }, counter));
    console.log('EXACT input tokens over ' + c + ' prompts: ' + exact + ' → input $' + (exact * IN_PRICE).toFixed(2) + ' + output (~160 × ' + c + ') $' + (c * 160 * OUT_PRICE).toFixed(2) + ' = about $' + (exact * IN_PRICE + c * 160 * OUT_PRICE).toFixed(2));
    return;
  }
  if (!APPROVED) { console.log('DRY RUN — nothing sent, nothing written. Pass --approved "<who, when>" to run.'); return; }
  /* ⚠ THE KEY LIVES ON RAILWAY ONLY (learned the hard way on the first run: 706 rows rewritten,
     then Voyage 401 — content changed, vector did not, and nothing marks a vector stale). A run
     that rewrites KB text REFUSES to start without the embedding capability; export it for the
     process only: VOYAGE_API_KEY=$(railway variables --service sales-overlay --json | …). */
  const cap = embeddingCapability();
  if (!cap.ok) { console.error('REFUSED: ' + cap.reason + ' — this run rewrites KB text and must re-embed it in the same run.'); process.exit(3); }
  setUsageRecorder(admin);
  let i = 0, done = 0, failed = 0, saturated = 0, aborted = false; const results = [];
  async function worker() {
    while (i < all.length && !aborted) {
      const t = all[i++];
      try {
        const w = arc.windowTurns(t.turns, t.signal.timestamp_seconds);
        const resp = await createArc({ model: MODEL, max_tokens: 700, messages: [{ role: 'user', content: buildPrompt(W._formatTurnsForPrompt(w.turns), t.signal) }] }, { userId: t.user_id, callId: t.call_id });
        saturated = 0;
        const text = (resp.content || []).map((c) => c.text || '').join('');
        const parsed = W._extractFirstJsonObject(text) || {};
        const verified = arc.verifyCause(parsed.cause || parsed, t.turns, t.signal.timestamp_seconds, labelForQuote)
          || { move: 'none', none_reason: 'no_closer_work', evidence: null, arc_start_seconds: null, summary: null, refused: null, not_offered: true };
        verified.window_seconds = w.seconds;
        if (t.kind === 'kb') {
          const meta = Object.assign({}, (await admin.from('knowledge_base').select('metadata').eq('id', t.kb_id).single()).data.metadata, { cause: verified, cause_run_id: RUN_ID });
          const base = String(t.content || '').replace(/\s*The closer’s move:.*$/s, '');
          const content = base + ' ' + arc.causeContentText(verified);
          const up = await admin.from('knowledge_base').update({ metadata: meta, content: content }).eq('id', t.kb_id);
          if (up.error) throw new Error('kb write: ' + up.error.message);
          results.push({ kind: 'kb', kb_id: t.kb_id, content: content });
        }
        if (t.highlight_id) {
          const up2 = await admin.from('call_highlights').update({ cause: Object.assign({}, verified, { cause_run_id: RUN_ID }) }).eq('id', t.highlight_id);
          if (up2.error) throw new Error('highlight write: ' + up2.error.message);
        }
        results.push({ kind: t.kind, call_id: t.call_id, user_id: t.user_id, highlight_id: t.highlight_id, kb_id: t.kb_id || null, outcome: t.outcome || 'closed', signal: t.signal, cause: verified });
        done++;
      } catch (e) {
        failed++;
        if (isSaturation(e)) { saturated++; if (saturated >= 3) { aborted = true; console.error('ABORT: saturation three times in a row — ' + e.message); } }
        else console.error('  failed ' + t.call_id + ': ' + (e.message || e));
        results.push({ kind: t.kind, call_id: t.call_id, kb_id: t.kb_id || null, error: String(e.message || e) });
      }
      if ((done + failed) % 50 === 0) console.log('  ' + (done + failed) + '/' + all.length + ' (failed ' + failed + ')');
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // re-embed the touched KB rows in batches (one request per batch, never per row)
  const touched = results.filter((r) => r.kind === 'kb' && r.content);
  let embedded = 0, unembedded = 0;
  for (let b = 0; b < touched.length; b += 100) {
    const batch = touched.slice(b, b + 100);
    let embs = [];
    try { embs = await getVoyageEmbeddings(batch.map((r) => r.content), 'arc-cause-reembed'); } catch (e) { embs = []; }
    for (let k = 0; k < batch.length; k++) {
      if (embs[k]) { const u = await admin.from('knowledge_base').update({ embedding: embs[k] }).eq('id', batch[k].kb_id); if (!u.error) { embedded++; continue; } }
      unembedded++;
    }
  }
  const out = path.join(OUT_DIR, RUN_ID + '.json');
  fs.writeFileSync(out, JSON.stringify({ run_id: RUN_ID, approved: APPROVED, done, failed, aborted, embedded, unembedded, results: results.filter((r) => r.kind !== 'kb' || !r.content) }, null, 1));
  console.log('done: ' + done + ' written, ' + failed + ' failed' + (aborted ? ' — ABORTED on saturation' : '') + '; re-embedded ' + embedded + ' (unembedded ' + unembedded + ') → ' + out);
})().catch((e) => { console.error(e); process.exit(1); });
