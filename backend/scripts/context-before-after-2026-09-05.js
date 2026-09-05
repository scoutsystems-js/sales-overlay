#!/usr/bin/env node
'use strict';
/* H728 — the grader with and without the inherited selling context, on three real calls (closed, lost,
   open). WRITES NOTHING to the analyses — new calls only, nothing re-grades. Six grader calls, lane
   'grader-measure' (usage logged). The "with" arm uses the context the head's row will carry (the owner's
   profile, which Justin ruled applies to the whole team). Noise floor on file (H045): ±14 per section,
   ~6 overall between rounds — one run per arm cannot separate a small move from noise. */
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
const { usageFor, setUsageRecorder } = require('../lib/model-usage');
const create = usageFor('grader-measure');
const CALLS = [['closed', '1c9822d2-d30c-4943-8089-93e734748abc'], ['open', 'ad03c329-36e7-4d34-8e03-ad961fbd83b8'], ['lost', '1fb6e4ec-b079-4b54-b483-4c6fd133f818']];
const OWNER = '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1';
const SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];
setUsageRecorder(admin);
(async () => {
  const withCtx = await fetchSellingContext(admin, OWNER);
  console.log('with-arm context: ' + withCtx.contextText.length + ' chars; qualifications: ' + withCtx.qualifications);
  const out = [];
  for (const [label, id] of CALLS) {
    const cq = await admin.from('fathom_calls').select('id, user_id, duration_seconds, title').eq('id', id).maybeSingle();
    const aq = await admin.from('call_analyses').select('transcript_stored, speaker_closer_name, overall_score, intro_score, discovery_score, pitch_score, objection_score, close_score_earned').eq('fathom_call_id', id).maybeSingle();
    const t = aq.data.transcript_stored; const matched = (t.turns || []).some((x) => x.speaker === 'CLOSER' || x.speaker === 'PROSPECT');
    const normalized = { turns: t.turns || [], highlights: t.highlights || [], closer_name: aq.data.speaker_closer_name || null, speaker_confidence: matched ? 'matched' : 'inferred' };
    const row = { label, id, title: cq.data.title, stored: { overall: aq.data.overall_score, intro: aq.data.intro_score, discovery: aq.data.discovery_score, pitch: aq.data.pitch_score, objection: aq.data.objection_score, close: aq.data.close_score_earned }, arms: {} };
    for (const [arm, ctx] of [['without', { contextText: '', qualifications: null }], ['with', withCtx]]) {
      const prompt = W._buildSectionGraderPrompt(normalized, cq.data.duration_seconds, ctx.contextText, withDiscoveryAreas([]), { qualifications: ctx.qualifications, voiceBlock: '' });
      const resp = await create({ model: 'claude-sonnet-4-6', max_tokens: 4500, messages: [{ role: 'user', content: prompt }] }, { userId: cq.data.user_id, callId: id });
      const parsed = W._extractFirstJsonObject((resp.content || []).map((c) => c.text || '').join('')) || {};
      const scores = {}; SECTIONS.forEach((s) => { scores[s] = parsed[s] && typeof parsed[s].score === 'number' ? parsed[s].score : null; });
      row.arms[arm] = { overall: parsed.overall_score ?? null, sections: scores, outcome: parsed.outcome || null, qualification_check: parsed.qualification_check ? JSON.stringify(parsed.qualification_check).slice(0, 300) : null, discovery_notes: parsed.discovery && parsed.discovery.notes ? String(parsed.discovery.notes).slice(0, 400) : null };
      console.log(label + ' · ' + arm + ': overall ' + row.arms[arm].overall + ' ' + JSON.stringify(scores));
    }
    out.push(row);
  }
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'context-before-after'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 1));
  console.log('written ' + path.join(dir, 'result.json'));
})().catch((e) => { console.error(e); process.exit(1); });
