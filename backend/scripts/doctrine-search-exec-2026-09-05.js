#!/usr/bin/env node
'use strict';
/* H734 — a reachability claim is EXECUTED against the real query with the strongest probe: the search page's
   match_knowledge RPC as the owner, the head and a rep, with a DOCTRINE row's own embedding (similarity 1 to
   itself), counting doctrine rows returned — and the JS fallback predicate over the same rows — and then the
   advice lanes' retrieval for the same three, counting doctrine units. Reads only. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { loadKbMaterial } = require('../lib/kb-material');
const { kbReadRowVisible } = require('../lib/kb-scope');
const CALLERS = [['owner', '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1', '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1'], ['head', '40616e16-a92b-45c4-99b8-b3d12e508bf6', '40616e16-a92b-45c4-99b8-b3d12e508bf6'], ['rep', 'a99f548b-865f-40d7-9d31-d3aaeb984c56', '40616e16-a92b-45c4-99b8-b3d12e508bf6']];
(async () => {
  const d = await admin.from('knowledge_base').select('id, label, category, scope, uploaded_by, team_owner_id, embedding').eq('category', 'doctrine');
  if (d.error) throw new Error(d.error.message);
  const rows = d.data || []; const ids = new Set(rows.map((r) => r.id));
  const out = { doctrine_rows: rows.length, probes: [], callers: {} };
  // every doctrine row is a probe, so the claim covers all eleven, not one
  for (const [who, uid, adminId] of CALLERS) {
    let returned = 0, doctrineReturned = 0;
    for (const r of rows) {
      const rpc = await admin.rpc('match_knowledge', { query_embedding: JSON.parse(r.embedding), match_threshold: 0.5, match_count: 8, p_user_id: uid, p_admin_id: adminId });
      if (rpc.error) throw new Error(rpc.error.message);
      returned += (rpc.data || []).length; doctrineReturned += (rpc.data || []).filter((x) => ids.has(x.id)).length;
    }
    const jsVisible = rows.filter((r) => kbReadRowVisible(r, { p_user_id: uid, p_admin_id: adminId })).length;
    const m = await loadKbMaterial(admin, { userId: uid, lane: 'doctrine-search-exec', maxChars: 2500 });
    out.callers[who] = { probes: rows.length, rows_returned_total: returned, doctrine_rows_returned: doctrineReturned, js_predicate_visible: jsVisible, lane_doctrine_units: m.doctrine.units.length, lane_keys: m.doctrine.units.map((u) => u.key).length };
  }
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'doctrine'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'search-exec-' + (process.argv[2] || 'run') + '.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
