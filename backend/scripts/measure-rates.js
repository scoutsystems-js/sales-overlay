#!/usr/bin/env node
/* Live close rates for named reps through the ONE computation with the anchored window (H706).
   usage: node scripts/measure-rates.js dre@x nick@x */
'use strict';
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { fetchProspectCloseRates } = require('../lib/prospect-entity');
(async () => {
  const want = process.argv.slice(2);
  const users = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ids = ((users.data && users.data.users) || []).filter((u) => want.includes(u.email)).map((u) => ({ id: u.id, email: u.email }));
  const now = Date.now();
  for (const [label, days] of [['30-day', 30], ['90-day', 90], ['all-time', null]]) {
    const from = days ? new Date(now - days * 86400e3).toISOString() : null;
    const r = await fetchProspectCloseRates(admin, ids.map((u) => u.id), from, null);
    console.log(label + ': ' + ids.map((u) => { const x = r[u.id] || { closed: 0, total: 0, pct: null }; return u.email.split('@')[0] + ' ' + x.closed + '/' + x.total + ' (' + x.pct + '%)'; }).join(' · '));
  }
  const ta = await admin.from('fathom_calls').select('user_id').in('user_id', ids.map((u) => u.id)).not('not_a_sales_call', 'is', true).is('duplicate_of', null);
  const counts = {}; (ta.data || []).forEach((c) => { counts[c.user_id] = (counts[c.user_id] || 0) + 1; });
  console.log('calls taken (all-time): ' + ids.map((u) => u.email.split('@')[0] + ' ' + (counts[u.id] || 0)).join(' · '));
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
