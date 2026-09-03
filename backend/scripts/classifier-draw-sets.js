#!/usr/bin/env node
/**
 * THE BLIND HARNESS — DRAW THE SETS (H708). No model call, no write to any call.
 * Positives (not_sales): the OTHER human marks with a stored transcript (never the fourteen
 * closer marks — those were follow-ups reaching for a flag) + the grader's internal
 * verdicts (read by hand in the recon). Negatives (sales): graded closed/lost/follow_up
 * calls with a transcript, stratified (short follow-ups under 10 min on purpose).
 * Hard cases on purpose: the 6-minute reconnect a closer wrongly marked (now a follow-up),
 * the coaching debrief, the mandatory training that sounds like a sale.
 * Output: ids only in tuning.json / held_out.json (+ titles for the report); LABELS in
 * labels.json, a separate file the runner never opens.
 */
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { drawSets } = require('../lib/classifier-harness');
const SEED = Number(process.argv[2] || 20260903);
const NEG_PER_STRATUM = { short_followup: 40, lost: 40, closed: 40, followup_long: 60 };
async function all(q) { const r = await q; if (r.error) throw new Error(r.error.message); return r.data || []; }
(async () => {
  const users = await admin.auth.admin.listUsers({ perPage: 1000 }); const email = {}; ((users.data && users.data.users) || []).forEach((u) => { email[u.id] = u.email; });
  const marked = await all(admin.from('fathom_calls').select('id, user_id, title, duration_seconds, source, not_sales_marked_by, call_analyses!inner(transcript_stored)')
    .eq('not_a_sales_call', true).not('not_sales_marked_by', 'is', null).not('fathom_call_id', 'like', 'seed-%').not('fathom_call_id', 'like', 'demo-%'));
  const verdicts = await all(admin.from('call_analyses').select('fathom_call_id, overall_summary, transcript_stored, fathom_calls!inner(id, user_id, title, duration_seconds, source, not_a_sales_call)')
    .or('overall_summary.ilike.%not a prospect-facing sales call%,overall_summary.ilike.This recording is an internal%,overall_summary.ilike.This call is an internal%,overall_summary.ilike.This session is an internal%'));
  const items = []; const meta = {};
  const add = (c, label, stratum, hard, owner) => { if (meta[c.id]) return; meta[c.id] = { title: c.title, minutes: Math.round((c.duration_seconds || 0) / 60), owner: (email[owner] || owner || '').split('@')[0], stratum, hard: !!hard }; items.push({ id: c.id, label, stratum, hard }); };
  marked.filter((c) => c.call_analyses && c.call_analyses.transcript_stored).forEach((c) => add(c, 'not_sales', 'human_mark:' + (email[c.not_sales_marked_by] || '?').split('@')[0], /Closer Sales Training|debrief/i.test(c.title || ''), c.user_id));
  verdicts.filter((a) => a.transcript_stored && a.fathom_calls && a.fathom_calls.not_a_sales_call !== true).forEach((a) => { const c = a.fathom_calls; add(c, 'not_sales', 'grader_verdict', /Closer Sales Training|Mandatory|debrief|role.?play/i.test(c.title || ''), c.user_id); });
  const neg = await all(admin.from('call_analyses').select('fathom_call_id, outcome, fathom_calls!inner(id, user_id, title, duration_seconds, source, not_a_sales_call, duplicate_of, call_kind, fathom_call_id)')
    .in('outcome', ['closed', 'lost', 'follow_up']).eq('status', 'done').not('transcript_stored', 'is', null).limit(3000));
  const negRows = neg.map((a) => Object.assign({ outcome: a.outcome }, a.fathom_calls)).filter((c) => c.not_a_sales_call !== true && !c.duplicate_of && !/^seed-|^demo-/.test(c.fathom_call_id || ''));
  const { _rng } = require('../lib/classifier-harness'); const r = _rng(SEED);
  const take = (list, n) => list.slice().sort(() => r() - 0.5).slice(0, n);
  take(negRows.filter((c) => c.outcome === 'follow_up' && c.duration_seconds < 600), NEG_PER_STRATUM.short_followup).forEach((c) => add(c, 'sales', 'short_followup', c.call_kind === 'follow_up', c.user_id));
  take(negRows.filter((c) => c.outcome === 'lost'), NEG_PER_STRATUM.lost).forEach((c) => add(c, 'sales', 'lost', false, c.user_id));
  take(negRows.filter((c) => c.outcome === 'closed'), NEG_PER_STRATUM.closed).forEach((c) => add(c, 'sales', 'closed', false, c.user_id));
  take(negRows.filter((c) => c.outcome === 'follow_up' && c.duration_seconds >= 600), NEG_PER_STRATUM.followup_long).forEach((c) => add(c, 'sales', 'followup_long', false, c.user_id));
  /* the ten reversed follow-ups are SALES by ruling — the closer-marked hard cases, on purpose */
  const reversed = await all(admin.from('fathom_calls').select('id, user_id, title, duration_seconds, source, call_analyses!inner(transcript_stored)').eq('call_kind', 'follow_up').eq('call_kind_source', 'human').not('not_sales_marked_by', 'is', null).eq('not_a_sales_call', false));
  reversed.filter((c) => c.call_analyses && c.call_analyses.transcript_stored).forEach((c) => add(c, 'sales', 'reversed_followup', true, c.user_id));
  const sets = drawSets(items, { seed: SEED, tuningShare: 1 / 3 });
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'classifier'); fs.mkdirSync(dir, { recursive: true });
  const strip = (ids) => ids.map((id) => ({ id, title: meta[id].title, minutes: meta[id].minutes, owner: meta[id].owner }));   // no label, no stratum
  fs.writeFileSync(path.join(dir, 'tuning.json'), JSON.stringify(strip(sets.tuning), null, 1));
  fs.writeFileSync(path.join(dir, 'held_out.json'), JSON.stringify(strip(sets.held_out), null, 1));
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ seed: SEED, labels: sets.labels, meta }, null, 1));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(sets.manifest, null, 1));
  const owners = {}; items.forEach((it) => { if (it.label === 'not_sales') owners[meta[it.id].owner] = 1; });
  const markers = {}; items.forEach((it) => { if (/^human_mark:/.test(it.stratum)) markers[it.stratum.slice(11)] = 1; });
  console.log('items: ' + items.length + ' (not_sales ' + items.filter((i) => i.label === 'not_sales').length + ', sales ' + items.filter((i) => i.label === 'sales').length + ', hard ' + items.filter((i) => i.hard).length + ')');
  console.log('not_sales owners: ' + Object.keys(owners).length + ' · human markers represented: ' + Object.keys(markers).join(', '));
  console.log('tuning n=' + sets.manifest.tuning.n + ' base rate sales ' + sets.manifest.tuning.base_rate_sales + '% · held_out n=' + sets.manifest.held_out.n + ' base rate sales ' + sets.manifest.held_out.base_rate_sales + '%');
  console.log('strata: ' + JSON.stringify(sets.manifest.strata));
  console.log('written: ' + dir + ' (tuning.json, held_out.json, labels.json — the runner never opens labels.json)');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
