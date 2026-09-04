#!/usr/bin/env node
'use strict';
/* H720 — compute the missed-signal pairs on stored rows (reads only; no model call; writes nothing to the DB).
   Prints the gap distribution (with NO floor, so the floor can be chosen from data), the section pairs,
   dumps every pair to ~/Desktop/scan-reports/missed-signal/pairs.json, and prints a seeded random TEN for
   the hand read. `--floor N` applies a floor in seconds. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const P = require('../lib/missed-signal-pair');
const { CHUNK } = require('../lib/chunk');
const { realCallsOnly } = require('../lib/real-calls');
const args = process.argv.slice(2); const floor = args.indexOf('--floor') !== -1 ? Number(args[args.indexOf('--floor') + 1]) : 0;
const hms = (s) => new Date(s * 1000).toISOString().substr(11, 8);
(async () => {
  const d = await admin.from('call_highlights').select('fathom_call_id').eq('type', 'disqualify_signal');
  if (d.error) throw new Error(d.error.message);
  const callIds = Array.from(new Set(d.data.map((r) => r.fathom_call_id)));
  const calls = []; for (let i = 0; i < callIds.length; i += CHUNK) { const r = await admin.from('fathom_calls').select('id, fathom_call_id, user_id, not_a_sales_call, duplicate_of').in('id', callIds.slice(i, i + CHUNK)); if (r.error) throw new Error(r.error.message); calls.push(...r.data); }
  const real = realCallsOnly(calls).filter((c) => !c.not_a_sales_call && !c.duplicate_of);   // H369 + the paired exclusions
  const byCall = {}; for (let i = 0; i < real.length; i += CHUNK) { const r = await admin.from('call_highlights').select('*').in('fathom_call_id', real.slice(i, i + CHUNK).map((c) => c.id)); if (r.error) throw new Error(r.error.message); r.data.forEach((h) => { (byCall[h.fathom_call_id] = byCall[h.fathom_call_id] || []).push(h); }); }
  const out = []; Object.keys(byCall).forEach((cid) => { P.findMissedSignalPairs(byCall[cid], { minGapSeconds: floor }).forEach((p) => out.push(Object.assign({ call_id: cid, user_id: (real.find((c) => c.id === cid) || {}).user_id }, p))); });
  const gaps = out.map((p) => p.gap_seconds).sort((a, b) => a - b);
  const q = (f) => gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))];
  console.log('DQ calls ' + callIds.length + ', real and counted ' + real.length + '; pairs ' + out.length + ' on ' + new Set(out.map((p) => p.call_id)).size + ' calls (floor ' + floor + 's)');
  console.log('gap seconds: min ' + gaps[0] + ' p10 ' + q(0.1) + ' p25 ' + q(0.25) + ' median ' + q(0.5) + ' p75 ' + q(0.75) + ' max ' + gaps[gaps.length - 1] + '; under 2 min ' + gaps.filter((g) => g < 120).length + ', under 5 min ' + gaps.filter((g) => g < 300).length + ', under 10 min ' + gaps.filter((g) => g < 600).length);
  const cnt = (f) => { const m = {}; out.forEach((p) => { const k = f(p); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  console.log('handling: ' + JSON.stringify(cnt((p) => p.signal.type + '/' + p.signal.handling)));
  console.log('sections signal→dq: ' + JSON.stringify(cnt((p) => (p.signal.section || '?') + '→' + (p.dq.section || '?'))));
  console.log('pairs per call: ' + JSON.stringify(cnt((p) => p.call_id)).length > 0 ? JSON.stringify(Object.entries(out.reduce((m, p) => { m[p.call_id] = (m[p.call_id] || 0) + 1; return m; }, {})).reduce((m, [, n]) => { m[n] = (m[n] || 0) + 1; return m; }, {})) : '');
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'missed-signal'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pairs.json'), JSON.stringify(out, null, 1));
  let seed = 20260904; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ten = out.map((p) => ({ p, r: rnd() })).sort((a, b) => a.r - b.r).slice(0, 10).map((o) => o.p);
  const txt = ten.map((p, i) => [(i + 1) + '. call ' + p.call_id.slice(0, 8) + ' — gap ' + P.gapLabel(p.gap_seconds) + ' (' + p.signal.section + ' → ' + p.dq.section + ')',
    '   [' + hms(p.signal.timestamp_seconds) + '] SIGNAL (' + p.signal.type + ', ' + p.signal.handling + '): "' + p.signal.quote + '"',
    '      what happened: ' + p.signal.observation,
    '      closer replied' + (p.signal.closer_response_verified ? '' : ' (unverified)') + ': "' + (p.signal.closer_response || '') + '"',
    '   [' + hms(p.dq.timestamp_seconds) + '] DQ: "' + p.dq.quote + '"',
    '      what happened: ' + p.dq.observation].join('\n')).join('\n\n');
  fs.writeFileSync(path.join(dir, 'hand-read-ten.txt'), txt); console.log('\n' + txt);
})().catch((e) => { console.error(e); process.exit(1); });
