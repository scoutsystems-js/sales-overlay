#!/usr/bin/env node
'use strict';
/* H721 — three real calls shown as a manager would see them: every moment kept today and which the bar
   would have kept, with the reason. Honest draw (seeded), not favourable: one closed, one not closed,
   one of the calls that falls to three or fewer. Reads only. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { momentReason } = require('../lib/moment-bar');
const { realCallsOnly } = require('../lib/real-calls');
const { CHUNK } = require('../lib/chunk');
const hms = (s) => new Date(s * 1000).toISOString().substr(11, 8);
let seed = 20260904; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
(async () => {
  // candidates: real, counted, analysed at v29+ (handling and closer_response exist), matched labels
  const a = await admin.from('call_analyses').select('fathom_call_id, outcome, prompt_version').gte('prompt_version', 'v29').not('outcome', 'is', null);
  if (a.error) throw new Error(a.error.message);
  const ids = a.data.map((r) => r.fathom_call_id); const calls = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const r = await admin.from('fathom_calls').select('id, fathom_call_id, user_id, not_a_sales_call, duplicate_of, title, call_date').in('id', ids.slice(i, i + CHUNK)); if (r.error) throw new Error(r.error.message); calls.push(...r.data); }
  const real = realCallsOnly(calls).filter((c) => !c.not_a_sales_call && !c.duplicate_of);
  const outcomeOf = {}; a.data.forEach((r) => { outcomeOf[r.fathom_call_id] = r.outcome; });
  const byCall = {}; for (let i = 0; i < real.length; i += CHUNK) { const r = await admin.from('call_highlights').select('*').in('fathom_call_id', real.slice(i, i + CHUNK).map((c) => c.id)); if (r.error) throw new Error(r.error.message); r.data.forEach((h) => { (byCall[h.fathom_call_id] = byCall[h.fathom_call_id] || []).push(h); }); }
  const scored = real.filter((c) => byCall[c.id] && byCall[c.id].length >= 5 && byCall[c.id].every((h) => h.speaker_verified !== null)).map((c) => { const hs = byCall[c.id].sort((x, y) => x.timestamp_seconds - y.timestamp_seconds); return { c, hs, kept: hs.filter((h) => momentReason(h)).length, outcome: outcomeOf[c.id], r: rnd() }; }).sort((x, y) => x.r - y.r);
  const closed = scored.find((s) => s.outcome === 'closed' && s.kept > 3);
  const open = scored.find((s) => (s.outcome === 'lost' || s.outcome === 'follow_up') && s.kept > 3 && s !== closed);
  const low = scored.find((s) => s.hs.length >= 7 && s.kept <= 3 && s !== closed && s !== open);
  const render = (s, label) => {
    const lines = ['## ' + label + ' — ' + (s.c.title || 'untitled') + ' (' + String(s.c.call_date).slice(0, 10) + '), outcome ' + s.outcome + ' — ' + s.hs.length + ' moments today, ' + s.kept + ' under the bar', ''];
    s.hs.forEach((h) => { const r = momentReason(h); const tag = h.type.replace(/_/g, ' ') + (h.handling ? ', ' + h.handling : '') + (h.resolution ? ', ' + h.resolution : '');
      lines.push((r ? '**KEPT — ' + r.reason + '**' : '~~removed~~') + ' · [' + hms(h.timestamp_seconds) + '] ' + h.speaker + ' (' + tag + '): "' + h.quote + '"');
      lines.push('  What happened: ' + h.observation + (h.closer_response && !/^__/.test(h.closer_response) ? ' Closer: "' + h.closer_response + '"' : (h.closer_response === '__no_reply__' ? ' The closer did not reply.' : ''))); lines.push(''); });
    return lines.join('\n');
  };
  const out = [render(closed, 'A call that closed'), render(open, 'A call that did not close'), render(low, 'A call that falls to three or fewer')].join('\n\n');
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'moment-bar'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'three-calls.md'), out); console.log('candidates ' + scored.length + '; picked ' + [closed, open, low].map((s) => s && s.c.id.slice(0, 8) + '/' + s.outcome + '/' + s.hs.length + '→' + s.kept).join(', '));
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
