#!/usr/bin/env node
'use strict';
/* H735 — build the coaching record ONCE from the entries already on file: every highlight with a coaching text whose
   stored fields map to a pattern key becomes one (rep, pattern, call) row. Data only — no model call. Dry by
   default; --apply writes (idempotent on the unique key). Prints the count before it writes. */
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { patternKey } = require('../lib/coaching-history');
const { CHUNK } = require('../lib/chunk');
const APPLY = process.argv.includes('--apply');
(async () => {
  let rows = [];
  for (let page = 0; page < 10; page++) {
    const r = await admin.from('call_highlights').select('id, fathom_call_id, user_id, type, objection_category, resolution, handling, created_at').not('coaching', 'is', null).order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999);
    if (r.error) throw new Error(r.error.message); rows = rows.concat(r.data || []); if ((r.data || []).length < 1000) break;
  }
  const callIds = [...new Set(rows.map((r) => r.fathom_call_id))];
  const dateOf = {}, ownerOf = {};
  for (let i = 0; i < callIds.length; i += CHUNK) { const c = await admin.from('fathom_calls').select('id, user_id, call_date').in('id', callIds.slice(i, i + CHUNK)); if (c.error) throw new Error(c.error.message); (c.data || []).forEach((x) => { dateOf[x.id] = x.call_date; ownerOf[x.id] = x.user_id; }); }
  const users = [...new Set(rows.map((r) => r.user_id || ownerOf[r.fathom_call_id]).filter(Boolean))];
  const p = await admin.from('user_profiles').select('user_id, managed_by').in('user_id', users); if (p.error) throw new Error(p.error.message);
  const teamOf = {}; (p.data || []).forEach((x) => { teamOf[x.user_id] = x.managed_by || x.user_id; });
  const seen = {}; const out = [];
  rows.forEach((h) => {
    const key = patternKey(h); const uid = h.user_id || ownerOf[h.fathom_call_id]; if (!key || !uid) return;
    const k = uid + '|' + key + '|' + h.fathom_call_id; if (seen[k]) return; seen[k] = true;
    out.push({ user_id: uid, team_key: teamOf[uid] || uid, pattern_key: key, fathom_call_id: h.fathom_call_id, highlight_id: h.id, call_date: dateOf[h.fathom_call_id] || null, surface: 'call_coaching', version: 'backfill-2026-09-05' });
  });
  const byKey = {}; out.forEach((r) => { byKey[r.pattern_key] = (byKey[r.pattern_key] || 0) + 1; });
  console.log('coached entries ' + rows.length + ' → rows to write ' + out.length + ' (reps ' + users.length + ', calls ' + callIds.length + ') by pattern ' + JSON.stringify(byKey));
  if (!APPLY) { console.log('DRY — nothing written. Re-run with --apply.'); return; }
  let written = 0;
  for (let i = 0; i < out.length; i += CHUNK) { const r = await admin.from('coaching_history').upsert(out.slice(i, i + CHUNK), { onConflict: 'user_id,pattern_key,fathom_call_id', ignoreDuplicates: true }); if (r.error) throw new Error('upsert: ' + r.error.message); written += out.slice(i, i + CHUNK).length; }
  const total = await admin.from('coaching_history').select('id', { count: 'exact', head: true });
  console.log('written (attempted) ' + written + ' · table rows now ' + total.count);
})().catch((e) => { console.error(e); process.exit(1); });
