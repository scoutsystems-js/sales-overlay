#!/usr/bin/env node
'use strict';
/* H734 — THE REP LINE, priced then produced for Justin to read. Builds every rep's prompt EXACTLY as the route
   does (the same gather, lib/coachable-team; the same builder, lib/rep-line), counts the tokens (free), and only
   with --run makes the calls — which write the SAME cache the page reads, so Josh's next load is a hit. Prints
   every rep's line, its kind, the moments it opens to and the guard's verdict. Lane 'rep-line' in model_usage. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { setUsageRecorder } = require('../lib/model-usage');
const { loadCoachableTeam } = require('../lib/coachable-team');
const RL = require('../lib/rep-line');
const { loadKbMaterial } = require('../lib/kb-material');
const { withBoardOwner } = require('../lib/team-membership');
const { nameMapFor } = require('../lib/team-name-map');
const { emailMapFor } = require('../lib/email-map');
const MODEL = 'claude-sonnet-4-6';
const JOSH = '40616e16-a92b-45c4-99b8-b3d12e508bf6';
const RUN = process.argv.includes('--run');
setUsageRecorder(admin);
async function countTokens(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json(); if (!r.ok) throw new Error('count_tokens: ' + JSON.stringify(j)); return j.input_tokens;
}
(async () => {
  const to = new Date().toISOString(), from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();   // the page's default window
  const pr = await admin.from('user_profiles').select('user_id').eq('managed_by', JOSH); if (pr.error) throw new Error(pr.error.message);
  const ids = withBoardOwner(JOSH, pr.data.map((x) => x.user_id));
  const em = await emailMapFor(admin); const nameOf = await nameMapFor(admin, ids, em);
  const g = await loadCoachableTeam(admin, ids, from, to);
  const material = await loadKbMaterial(admin, { userId: JOSH, lane: 'rep-line', maxChars: 2500 });
  const reps = g.reps.map((r) => Object.assign({ name: nameOf[r.user_id] || null }, r));
  const counts = {}; let total = 0;
  for (const r of reps) {
    if (!r.items.length) { counts[r.name] = 0; continue; }
    const p = RL.buildRepLinePrompt(r, r.items, material, { lossScope: r.loss_scope, doctrineBlock: material.doctrineBlock('rep-line') });
    counts[r.name] = await countTokens(p); total += counts[r.name];
  }
  const withItems = reps.filter((r) => r.items.length).length;
  const ceiling = total * 3 / 1e6 + withItems * 400 * 15 / 1e6;
  console.log('reps ' + reps.length + ' · with moments ' + withItems + ' · material ' + (material.hasMaterial ? 'yes' : 'NO') + ' · input tokens ' + JSON.stringify(counts) + ' · total ' + total + ' · ceiling $' + ceiling.toFixed(3));
  if (!RUN) { console.log('COUNT ONLY — nothing spent. Re-run with --run.'); return; }
  const lines = await RL.computeRepLines(admin, reps, material, from, to);
  const out = reps.map((r, i) => ({ name: r.name, user_id: r.user_id, calls: r.calls, moments: r.items.length, kinds: r.items.map((it) => it.kind), line: lines[i], distinct_calls_in_items: Object.keys(r.items.reduce((a, it) => { a[it.call_id] = 1; return a; }, {})).length }));
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'doctrine'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rep-lines.json'), JSON.stringify({ from, to, counts, out }, null, 1));
  out.forEach((o) => console.log('\n' + (o.name || o.user_id) + ' · ' + o.calls + ' calls · ' + o.moments + ' moments [' + o.kinds.join(', ') + ']\n  kind=' + o.line.kind + (o.line.cached ? ' (cached)' : '') + ' · opens to ' + o.line.evidence_ids.length + ' cited of ' + o.moments + ' · calls claimed ' + o.line.calls + (o.line.reason ? ' · reason: ' + o.line.reason : '') + '\n  ' + (o.line.line || '(no line)')));
  console.log('\nwritten ' + path.join(dir, 'rep-lines.json'));
})().catch((e) => { console.error(e); process.exit(1); });
