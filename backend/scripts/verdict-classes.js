#!/usr/bin/env node
/* WATCH THE REASON CLASSES (H712): group live verdicts by reason class for the last N days.
   Two class-level gaps were found this way (absent prospect, non-buyer); assume a third exists.
   usage: node scripts/verdict-classes.js [days=7] */
'use strict';
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const days = Number(process.argv[2] || 7);
(async () => {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const r = await admin.from('call_analyses').select('fathom_call_id, prompt_version, sales_call_verdict, sales_call_reason_class, sales_call_reason, sales_call_review, analyzed_at, fathom_calls!inner(title, user_id, not_a_sales_call)')
    .gte('analyzed_at', since).not('sales_call_verdict', 'is', null).order('analyzed_at', { ascending: false }).limit(2000);
  if (r.error) throw new Error(r.error.message);
  const rows = r.data || [];
  const by = {}; rows.forEach((x) => { const k = x.sales_call_verdict + ' / ' + (x.sales_call_reason_class || '(none)'); (by[k] = by[k] || []).push(x); });
  console.log('live verdicts, last ' + days + ' days: ' + rows.length);
  Object.keys(by).sort((a, b) => by[b].length - by[a].length).forEach((k) => { console.log('  ' + k + ': ' + by[k].length); if (/not_sales|unsure/.test(k)) by[k].slice(0, 5).forEach((x) => console.log('     - "' + (x.fathom_calls.title || '').slice(0, 50) + '" [' + (x.sales_call_review || 'pending') + '] ' + (x.sales_call_reason || '').slice(0, 120))); });
  const ns = rows.filter((x) => x.sales_call_verdict === 'not_sales');
  console.log('queue: pending ' + ns.filter((x) => !x.sales_call_review && x.fathom_calls.not_a_sales_call !== true).length + ' · confirmed ' + ns.filter((x) => x.sales_call_review === 'confirmed').length + ' · corrected ' + ns.filter((x) => x.sales_call_review === 'corrected').length + ' · per week at this rate ≈ ' + Math.round((ns.length / days) * 7));
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
