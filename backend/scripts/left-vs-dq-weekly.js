#!/usr/bin/env node
'use strict';
/* H725 — the only before-and-after available for the ninth type: weekly counts of disqualification
   moments and "prospect left" moments by analysis week, from the v43 bump onward. Reads only. */
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
(async () => {
  const since = new Date(Date.now() - 12 * 7 * 864e5).toISOString();
  const r = await admin.from('call_highlights').select('type, created_at').in('type', ['disqualify_signal', 'prospect_left']).gte('created_at', since);
  if (r.error) throw new Error(r.error.message);
  const wk = {};
  r.data.forEach((h) => { const d = new Date(h.created_at); const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); const k = monday.toISOString().slice(0, 10); wk[k] = wk[k] || { disqualify_signal: 0, prospect_left: 0 }; wk[k][h.type]++; });
  console.log('week (Mon)   disqualify_signal   prospect_left');
  Object.keys(wk).sort().forEach((k) => console.log(k + '   ' + String(wk[k].disqualify_signal).padStart(17) + '   ' + String(wk[k].prospect_left).padStart(13)));
})().catch((e) => { console.error(e); process.exit(1); });
