#!/usr/bin/env node
'use strict';
/* H732 — the coaching text for a real call, BEFORE and AFTER doctrine, same inputs; two lanes: the per-moment coaching
   pass and the personal objections synthesis. WRITES NOTHING. Model calls on lane 'doctrine-measure'. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { usageFor, setUsageRecorder } = require('../lib/model-usage');
const coaching = require('../lib/coaching');
const { loadKbMaterial } = require('../lib/kb-material');
const synth = require('../lib/objection-synthesis');
const { OBJECTION_CATEGORIES } = require('../lib/objection-categories');
const { isHandled, outcomeMap } = require('../lib/objection-handled');
const { provenCloserResponse } = require('../lib/closer-side');
const { CHUNK } = require('../lib/chunk');
const create = usageFor('doctrine-measure');
const CALL = '1fb6e4ec-b079-4b54-b483-4c6fd133f818'; const JOSH = '40616e16-a92b-45c4-99b8-b3d12e508bf6'; const GODWIN = 'a99f548b-865f-40d7-9d31-d3aaeb984c56';
const W = require('../lib/analysis-worker');
setUsageRecorder(admin);
async function ask(prompt, max) { const r = await create({ model: 'claude-sonnet-4-6', max_tokens: max, messages: [{ role: 'user', content: prompt }] }, { userId: null, callId: CALL }); return (r.content || []).map((c) => c.text || '').join(''); }
(async () => {
  const out = {};
  // ── lane 1: the per-moment coaching on Josh's lost call
  const hl = await admin.from('call_highlights').select('id, type, resolution, section, timestamp_seconds, quote, observation, closer_response, closer_response_verified, objection_class').eq('fathom_call_id', CALL);
  const material = await loadKbMaterial(admin, { userId: JOSH, lane: 'doctrine-measure', maxChars: 2500 });
  const momentsBefore = coaching.selectCoachableMoments(hl.data).map(coaching.toMoment);   // note: the DQ exclusion is now in code, so "before" here = before DOCTRINE in the prompt, on the same selected moments
  const base = { outcome: 'lost', later: null, objectionNotes: null, managerNotes: material.notes.text || null, sellingContext: material.contextText || null };
  const pBefore = coaching.buildCoachingPrompt(momentsBefore, base);
  const pAfter = coaching.buildCoachingPrompt(momentsBefore, Object.assign({}, base, { doctrineBlock: material.doctrineBlock('coaching') }));
  out.coaching = { moments: momentsBefore.map((m) => m.time + ' ' + m.quote.slice(0, 80)), before: await ask(pBefore, coaching.COACHING_MAX_TOKENS), after: await ask(pAfter, coaching.COACHING_MAX_TOKENS), doctrineInPromptAfter: /SCOUT'S METHOD/.test(pAfter), doctrineInPromptBefore: /SCOUT'S METHOD/.test(pBefore) };
  // ── lane 2: the personal objections synthesis for Godwin (the real gathering, replicated read-only)
  const from = '2026-08-06T00:00:00Z', to = '2026-09-05T23:59:59Z';
  const calls = await admin.from('fathom_calls').select('id, recording_url, source').eq('user_id', GODWIN).gte('call_date', from).lte('call_date', to).is('duplicate_of', null).not('not_a_sales_call', 'is', true);
  const ids = calls.data.filter((c) => true).map((c) => c.id); const meta = {}; calls.data.forEach((c) => { meta[c.id] = c; });
  let done = [], rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const a = await admin.from('call_analyses').select('fathom_call_id, analyzed_at, outcome').in('fathom_call_id', ids.slice(i, i + CHUNK)).eq('status', 'done'); done = done.concat(a.data); const h = await admin.from('call_highlights').select('fathom_call_id, timestamp_seconds, quote, objection_surface, objection_category, resolution, closer_response, closer_response_verified').in('fathom_call_id', ids.slice(i, i + CHUNK)).eq('type', 'objection'); rows = rows.concat(h.data); }
  const outcomeByCall = outcomeMap(done);
  const byCat = {}; OBJECTION_CATEGORIES.forEach((c) => { byCat[c] = { count: 0, handled: 0, examples: [] }; });
  rows.forEach((r) => { const b = byCat[r.objection_category]; if (!b) return; b.count++; if (isHandled(r, outcomeByCall[r.fathom_call_id])) b.handled++; if (r.resolution === 'handled' && provenCloserResponse(r) && b.examples.length < 3) b.examples.push({ quote: String(r.quote || '').slice(0, 300), closer_response: String(provenCloserResponse(r)).slice(0, 400), surface: String(r.objection_surface || '').slice(0, 80), clip_url: null, source: null }); });
  const present = OBJECTION_CATEGORIES.filter((c) => byCat[c].count > 0);
  const gm = await loadKbMaterial(admin, { userId: GODWIN, lane: 'doctrine-measure', maxChars: 2500 });
  const sBefore = synth._buildSynthPrompt(present, byCat, Object.assign({}, gm, { doctrineBlock: null }));
  const sAfter = synth._buildSynthPrompt(present, byCat, gm);
  out.synthesis = { present, counts: present.map((c) => c + ' ' + byCat[c].handled + '/' + byCat[c].count), before: await ask(sBefore, 1800), after: await ask(sAfter, 1800), doctrineInPromptAfter: /SCOUT'S METHOD/.test(sAfter), doctrineInPromptBefore: /SCOUT'S METHOD/.test(sBefore) };
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'doctrine'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'before-after.json'), JSON.stringify(out, null, 1));
  console.log('written ' + path.join(dir, 'before-after.json'));
})().catch((e) => { console.error(e); process.exit(1); });
