#!/usr/bin/env node
/* THE BLIND HARNESS — SCORE A RUN (H708). Reads the run's rows and, only now, labels.json.
   usage: node scripts/classifier-score.js --run <run_id> */
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { score, renderReport } = require('../lib/classifier-harness');
const run = process.argv[process.argv.indexOf('--run') + 1];
(async () => {
  const r = await admin.from('classifier_verdicts').select('call_id, set_name, verdict, reason_class, reason, raw_error').eq('run_id', run);
  if (r.error) throw new Error(r.error.message);
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'classifier');
  const L = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const rows = (r.data || []).map((x) => ({ id: x.call_id, verdict: x.verdict, reason_class: x.reason_class, reason: x.reason }));
  const rep = score(rows, L.labels, L.meta);
  const text = renderReport(rep, run);
  console.log(text);
  fs.writeFileSync(path.join(dir, 'score-' + run + '.txt'), text + '\n');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
