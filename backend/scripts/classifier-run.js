#!/usr/bin/env node
/**
 * THE BLIND HARNESS — RUN THE CLASSIFIER ON A SET (H708). ⚠ A SPEND: one grader call per
 * call in the set (the SAME v38 prompt the worker builds — never a copy), on the STORED
 * transcript (no Fathom/Zoom fetch, no token refresh). Writes classifier_verdicts rows
 * ONLY — never call_analyses, never fathom_calls. Refuses to run without --approved.
 * usage: node scripts/classifier-run.js --set tuning|held_out --approved "<who, when>"
 */
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const W = require('../lib/analysis-worker');
const { fetchSellingContext } = require('../lib/selling-context');
const { withDiscoveryAreas } = require('../lib/discovery-areas');
const { createWithUsage, setUsageRecorder } = require('../lib/model-usage');
const args = process.argv.slice(2); const set = args[args.indexOf('--set') + 1]; const ap = args.indexOf('--approved');
const APPROVED = ap !== -1 ? args[ap + 1] : null; const LIMIT = args.indexOf('--limit') !== -1 ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const CONCURRENCY = 4;   // under the ceiling of six (H250)
if (!set || ['tuning', 'held_out'].indexOf(set) === -1) { console.error('--set tuning|held_out'); process.exit(1); }
if (!APPROVED) { console.error('REFUSED: this is a spend. Pass --approved "<who, when>" after Justin approves.'); process.exit(2); }
const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'classifier');
const items = JSON.parse(fs.readFileSync(path.join(dir, set + '.json'), 'utf8')).slice(0, LIMIT);
const RUN_ID = set + '-' + W.ANALYSIS_PROMPT_VERSION + '-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
setUsageRecorder(admin);
(async () => {
  console.log('run ' + RUN_ID + ': ' + items.length + ' calls, approved by: ' + APPROVED);
  let i = 0, done = 0, failed = 0;
  async function worker() {
    while (i < items.length) {
      const it = items[i++];
      try {
        const cq = await admin.from('fathom_calls').select('id, user_id, duration_seconds').eq('id', it.id).maybeSingle();
        const aq = await admin.from('call_analyses').select('transcript_stored, speaker_closer_name').eq('fathom_call_id', it.id).maybeSingle();
        if (cq.error || !cq.data || aq.error || !aq.data || !aq.data.transcript_stored) throw new Error('no stored transcript');
        const t = aq.data.transcript_stored;
        const matched = (t.turns || []).some((x) => x.speaker === 'CLOSER' || x.speaker === 'PROSPECT');
        const normalized = { turns: t.turns || [], highlights: t.highlights || [], closer_name: aq.data.speaker_closer_name || null, speaker_confidence: matched ? 'matched' : 'unknown' };
        const selling = await fetchSellingContext(admin, cq.data.user_id);
        const prompt = W._buildSectionGraderPrompt(normalized, cq.data.duration_seconds, selling.contextText, withDiscoveryAreas([]), { qualifications: selling.qualifications });
        const resp = await createWithUsage({ model: 'claude-sonnet-4-6', max_tokens: 4500, messages: [{ role: 'user', content: prompt }] }, { userId: cq.data.user_id, callId: it.id, lane: 'classifier-blind' });
        const text = (resp.content || []).map((c) => c.text || '').join('');
        const parsed = W._extractFirstJsonObject(text);
        const v = W._salesCallVerdict(parsed || {});
        const ins = await admin.from('classifier_verdicts').insert({ run_id: RUN_ID, set_name: set, call_id: it.id, prompt_version: W.ANALYSIS_PROMPT_VERSION, verdict: v.verdict, reason_class: v.reason_class, reason: v.reason, raw_error: parsed ? null : 'no json' });
        if (ins.error) throw new Error(ins.error.message);
        done++;
      } catch (e) {
        failed++;
        await admin.from('classifier_verdicts').insert({ run_id: RUN_ID, set_name: set, call_id: it.id, prompt_version: W.ANALYSIS_PROMPT_VERSION, verdict: null, raw_error: String(e.message || e).slice(0, 300) });
      }
      if ((done + failed) % 10 === 0) console.log('  ' + (done + failed) + '/' + items.length + ' (failed ' + failed + ')');
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('done: ' + done + ' verdicts, ' + failed + ' failed → run_id ' + RUN_ID + '. Now: node scripts/classifier-score.js --run ' + RUN_ID);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
