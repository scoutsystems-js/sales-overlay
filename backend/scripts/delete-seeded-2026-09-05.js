#!/usr/bin/env node
'use strict';
/* H732 — delete the 170 seeded starter-set rows by their PINNED ids (saved 2026-09-05 from the stored-origin query:
   scope NULL, uploaded_by NULL, team_owner_id NULL, no source call), on Justin's ruling. Dry by default; --apply writes.
   Every row is snapshotted in full (embedding included) before the delete so it is reversible. Refuses unless exactly
   170 ids are pinned and exactly 170 rows are present and every one still has the stored origin. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const { CHUNK } = require('../lib/chunk');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const APPLY = process.argv.includes('--apply');
const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'starter-set');
const ids = fs.readFileSync(path.join(dir, 'seeded-ids.csv'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f-]{36}$/.test(l));
(async () => {
  if (ids.length !== 170) { console.error('STOP: pinned ids = ' + ids.length + ', not 170'); process.exit(2); }
  let rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const r = await admin.from('knowledge_base').select('*').in('id', ids.slice(i, i + CHUNK)); if (r.error) throw new Error(r.error.message); rows = rows.concat(r.data || []); }
  const origin = rows.filter((r) => r.scope === null && r.uploaded_by === null && r.team_owner_id === null && !r.source_call_id);
  const total = await admin.from('knowledge_base').select('id', { count: 'exact', head: true });
  console.log('pinned ' + ids.length + ' · present ' + rows.length + ' · with stored origin ' + origin.length + ' · table rows ' + total.count);
  if (rows.length !== 170 || origin.length !== 170) { console.error('STOP: present/origin count is not 170'); process.exit(2); }
  fs.writeFileSync(path.join(dir, 'seeded-rows-snapshot-2026-09-05.json'), JSON.stringify(rows));
  console.log('snapshot written: ' + rows.length + ' rows, ' + fs.statSync(path.join(dir, 'seeded-rows-snapshot-2026-09-05.json')).size + ' bytes');
  if (!APPLY) { console.log('DRY — nothing deleted'); return; }
  let deleted = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const r = await admin.from('knowledge_base').delete().in('id', ids.slice(i, i + CHUNK)).select('id'); if (r.error) throw new Error('delete chunk ' + i + ': ' + r.error.message + ' (deleted so far ' + deleted.length + ')'); deleted = deleted.concat((r.data || []).map((x) => x.id)); }
  const left = await admin.from('knowledge_base').select('id', { count: 'exact', head: true }).is('scope', null).is('uploaded_by', null);
  const after = await admin.from('knowledge_base').select('id', { count: 'exact', head: true });
  console.log('deleted ' + deleted.length + ' · seeded rows remaining ' + left.count + ' · table rows ' + after.count + ' (was ' + total.count + ', difference ' + (total.count - after.count) + ')');
  fs.writeFileSync(path.join(dir, 'deleted-ids-2026-09-05.csv'), 'id\n' + deleted.join('\n') + '\n');
  if (deleted.length !== 170) { console.error('MISMATCH: deleted ' + deleted.length); process.exit(3); }
  console.log('DELETED 170 EXACTLY');
})().catch((e) => { console.error(e); process.exit(1); });
