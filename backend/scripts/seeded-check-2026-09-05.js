#!/usr/bin/env node
'use strict';
/* H732 — by EXECUTION, not inspection: run the advice lanes' retrieval and the search page's visibility predicate for an
   owner, a head and a rep, and assert the seeded rows (by their saved ids) reach none of them. Run before and after the
   deletion; the outputs are written so the two runs can be compared. Reads only. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { loadKbMaterial } = require('../lib/kb-material');
const { kbReadRowVisible } = require('../lib/kb-scope');
const { CHUNK } = require('../lib/chunk');
const tag = process.argv[2] || 'run';
const ids = fs.readFileSync(path.join(os.homedir(), 'Desktop', 'scan-reports', 'starter-set', 'seeded-ids.csv'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f-]{36}$/.test(l));
const CALLERS = [['owner', '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1', '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1'], ['head', '40616e16-a92b-45c4-99b8-b3d12e508bf6', '40616e16-a92b-45c4-99b8-b3d12e508bf6'], ['rep', 'a99f548b-865f-40d7-9d31-d3aaeb984c56', '40616e16-a92b-45c4-99b8-b3d12e508bf6']];
(async () => {
  let seeded = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const r = await admin.from('knowledge_base').select('id, content, scope, uploaded_by, team_owner_id').in('id', ids.slice(i, i + CHUNK)); if (r.error) throw new Error(r.error.message); seeded = seeded.concat(r.data || []); }
  const seededText = seeded.map((r) => r.content.slice(0, 60));
  const out = { tag, seeded_ids: ids.length, seeded_present: seeded.length, callers: {} };
  for (const [who, uid, adminId] of CALLERS) {
    const m = await loadKbMaterial(admin, { userId: uid, lane: 'seeded-check', maxChars: 6000 });
    const leaked = seededText.filter((t) => t.length > 20 && (m.contextText.indexOf(t) !== -1 || (m.notes.text || '').indexOf(t) !== -1)).length;
    const visible = seeded.filter((r) => kbReadRowVisible(r, { p_user_id: uid, p_admin_id: adminId })).length;
    out.callers[who] = { material_chars: m.contextText.length, notes: (m.notes.rows || []).length, doctrine_units: m.doctrine.units.length, hasMaterial: m.hasMaterial, seeded_in_material: leaked, seeded_visible_to_search: visible, kbHash: m.kbHash };
  }
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'starter-set'); fs.writeFileSync(path.join(dir, 'seeded-check-' + tag + '.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
