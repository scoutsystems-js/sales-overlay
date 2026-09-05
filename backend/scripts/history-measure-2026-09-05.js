#!/usr/bin/env node
'use strict';
/* H735 — prove by looking: the coaching text for a REAL call by a rep with a repeat, with and without the record in
   the prompt, same moments, same material. WRITES NOTHING to any call. --count prices it; --run spends. Lane
   'history-measure'. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { usageFor, setUsageRecorder } = require('../lib/model-usage');
const coaching = require('../lib/coaching');
const H = require('../lib/coaching-history');
const { loadKbMaterial } = require('../lib/kb-material');
const MODEL = 'claude-sonnet-4-6'; const RUN = process.argv.includes('--run');
const create = usageFor('history-measure'); setUsageRecorder(admin);
async function countTokens(prompt) { const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }) }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j.input_tokens; }
(async () => {
  // the rep and pattern with the deepest record, and their latest call carrying that pattern
  const top = await admin.from('coaching_history').select('user_id, pattern_key, fathom_call_id, call_date').order('call_date', { ascending: false });
  if (top.error) throw new Error(top.error.message);
  const counts = {}; top.data.forEach((r) => { const k = r.user_id + '|' + r.pattern_key; counts[k] = (counts[k] || 0) + 1; });
  const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]; const [uid, key] = best.split('|');
  const latest = top.data.find((r) => r.user_id === uid && r.pattern_key === key);
  const call = latest.fathom_call_id;
  const hl = await admin.from('call_highlights').select('id, type, resolution, section, timestamp_seconds, quote, observation, closer_response, closer_response_verified, objection_category, objection_class, handling').eq('fathom_call_id', call);
  const an = await admin.from('call_analyses').select('outcome').eq('fathom_call_id', call).maybeSingle();
  const material = await loadKbMaterial(admin, { userId: uid, lane: 'history-measure', maxChars: 2500 });
  const coachable = coaching.selectCoachableMoments(hl.data); const moments = coachable.map(coaching.toMoment);
  const historyAll = (await H.loadHistory(admin, [uid]))[uid] || {};
  // the record BEFORE this call: the call itself is in the record, so subtract it from the counts it belongs to
  const prior = {}; Object.keys(historyAll).forEach((k) => { const e = historyAll[k]; const mine = e.call_ids.indexOf(call) !== -1; prior[k] = { calls: e.calls - (mine ? 1 : 0), first: e.first, last: e.last }; });
  const keyed = coachable.map((h) => Object.assign({ pattern_key: H.patternKey(h) }, h));
  const base = { outcome: an.data && an.data.outcome, later: null, objectionNotes: null, managerNotes: material.notes.text || null, sellingContext: material.contextText || null, doctrineBlock: material.doctrineBlock('coaching'), dq: coaching.hasDqMoment(hl.data) };
  const pBefore = coaching.buildCoachingPrompt(moments, base);
  const block = H.historyBlock(prior, keyed);
  const pAfter = coaching.buildCoachingPrompt(moments, Object.assign({}, base, { historyBlock: block }));
  const c1 = await countTokens(pBefore), c2 = await countTokens(pAfter);
  const ceiling = (c1 + c2) * 3 / 1e6 + 2 * coaching.COACHING_MAX_TOKENS * 15 / 1e6;
  console.log('rep ' + uid + ' · pattern ' + key + ' · record ' + counts[best] + ' calls · call ' + call + ' · moments ' + moments.length + ' · block:\n' + block + '\ninput tokens ' + c1 + ' + ' + c2 + ' · ceiling $' + ceiling.toFixed(3));
  if (!RUN) { console.log('COUNT ONLY — nothing spent. Re-run with --run.'); return; }
  const ask = async (p) => { const r = await create({ model: MODEL, max_tokens: coaching.COACHING_MAX_TOKENS, messages: [{ role: 'user', content: p }] }, { userId: uid, callId: call, lane: 'history-measure' }); return (r.content || []).map((c) => c.text || '').join(''); };
  const out = { rep: uid, pattern: key, record_calls: counts[best], call, moments: moments.map((m) => m.time + ' ' + m.quote.slice(0, 70)), block, before: await ask(pBefore), after: await ask(pAfter) };
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'doctrine'); fs.writeFileSync(path.join(dir, 'history-before-after.json'), JSON.stringify(out, null, 1));
  console.log('\n=== BEFORE (no record)\n' + out.before.slice(0, 1800) + '\n\n=== AFTER (record in the prompt)\n' + out.after.slice(0, 2600));
})().catch((e) => { console.error(e); process.exit(1); });
