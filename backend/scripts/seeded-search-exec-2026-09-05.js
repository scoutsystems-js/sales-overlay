#!/usr/bin/env node
'use strict';
/* H732 — execute the search page's real query (the match_knowledge RPC, the embedding path the live page takes) as the
   owner, the head and a rep, with a seeded row's OWN embedding as the query (similarity 1 to itself — the strongest
   possible probe), and count how many seeded rows come back. Reads only. Usage: node … <before|after> */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const tag = process.argv[2] || 'run';
const ids = new Set(fs.readFileSync(path.join(os.homedir(), 'Desktop', 'scan-reports', 'starter-set', 'seeded-ids.csv'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f-]{36}$/.test(l)));
const CALLERS = [['owner', '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1', '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1'], ['head', '40616e16-a92b-45c4-99b8-b3d12e508bf6', '40616e16-a92b-45c4-99b8-b3d12e508bf6'], ['rep', 'a99f548b-865f-40d7-9d31-d3aaeb984c56', '40616e16-a92b-45c4-99b8-b3d12e508bf6']];
(async () => {
  // the probe embedding is saved on the BEFORE run so the AFTER run asks the identical question
  const probePath = path.join(os.homedir(), 'Desktop', 'scan-reports', 'starter-set', 'search-probe.json');
  let probe;
  if (fs.existsSync(probePath)) probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
  else {
    const r = await admin.from('knowledge_base').select('id, label, embedding').is('uploaded_by', null).is('scope', null).not('embedding', 'is', null).limit(1);
    if (r.error || !r.data.length) throw new Error('no seeded probe row: ' + (r.error && r.error.message));
    probe = { id: r.data[0].id, label: r.data[0].label, embedding: JSON.parse(r.data[0].embedding) };
    fs.writeFileSync(probePath, JSON.stringify(probe));
  }
  const out = { tag, probe: { id: probe.id, label: probe.label }, callers: {} };
  for (const [who, uid, adminId] of CALLERS) {
    const rpc = await admin.rpc('match_knowledge', { query_embedding: probe.embedding, match_threshold: 0.5, match_count: 8, p_user_id: uid, p_admin_id: adminId });
    if (rpc.error) throw new Error(rpc.error.message);
    const rows = rpc.data || [];
    out.callers[who] = { returned: rows.length, seeded_returned: rows.filter((r) => ids.has(r.id)).length, top: rows.slice(0, 3).map((r) => (ids.has(r.id) ? 'SEEDED ' : '') + (r.label || '').slice(0, 50) + ' ' + r.similarity.toFixed(2)) };
  }
  fs.writeFileSync(path.join(os.homedir(), 'Desktop', 'scan-reports', 'starter-set', 'search-exec-' + tag + '.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
