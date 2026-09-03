#!/usr/bin/env node
/**
 * THE SPLITTING PASS (H702) — dry-run by default; `--apply` writes.
 * Plans with lib/prospect-split.planSplits over every real, counted call; simulates
 * every rep's close rate BEFORE and AFTER through the ONE computation
 * (lib/prospect-entity.closeRateForCalls) for all-time and the 30-day board; and
 * REFUSES to apply if any rep's rate would move DOWN in either window — a split that
 * lowers a rate created a phantom prospect (Justin's stop rule). Writes the plan to
 * ~/Desktop/scan-reports/splits-2026-09-03.csv so Justin can read every move.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const APPLY = process.argv.includes('--apply');
/* ⚠ THE STOP RULE IS NOT LOOSENED — it is overridden only by a NAMED RULING passed
   on the command line, echoed in the output and stored on every split row as
   reason.stop_override, so the decision is on the record, not in the code. */
const ovIdx = process.argv.indexOf('--override-stop');
const OVERRIDE = (ovIdx !== -1 && process.argv[ovIdx + 1] && !process.argv[ovIdx + 1].startsWith('--')) ? process.argv[ovIdx + 1] : null;
const MEASURE = process.argv.includes('--measure');   // print live rates for every rep with a split row; plan nothing
const { planSplits, applySplits } = require('../lib/prospect-split');
const { closeRateForCalls } = require('../lib/prospect-entity');
const { realCallsOnly } = require('../lib/real-calls');
const { ratedCallsOnly } = require('../lib/dq-exclusion');
const { CHUNK } = require('../lib/chunk');
const PAGE = 1000;

async function pageAll(build) {
  let rows = [];
  for (let p = 0; p < 40; p++) {
    const r = await build().range(p * PAGE, p * PAGE + PAGE - 1);
    if (r.error) throw new Error(r.error.message);
    rows = rows.concat(r.data || []);
    if (!r.data || r.data.length < PAGE) return rows;
  }
  throw new Error('page cap hit');
}

(async () => {
  const prospects = await pageAll(() => admin.from('prospects').select('id, user_id, display_name, merged_into'));
  const callsRaw = await pageAll(() => admin.from('fathom_calls')
    .select('id, user_id, fathom_call_id, prospect_id, title, call_date')
    .not('not_a_sales_call', 'is', true).is('duplicate_of', null).not('prospect_id', 'is', null));
  const calls = realCallsOnly(callsRaw);
  const outcomeBy = {};
  const ids = calls.map(c => c.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await admin.from('call_analyses').select('fathom_call_id, outcome').in('fathom_call_id', ids.slice(i, i + CHUNK)).eq('status', 'done');
    if (r.error) throw new Error('outcomes: ' + r.error.message);
    (r.data || []).forEach(a => { outcomeBy[a.fathom_call_id] = a.outcome; });
  }
  const mergedInto = {};
  prospects.forEach(p => { if (p.merged_into) mergedInto[p.id] = p.merged_into; });
  const users = await admin.auth.admin.listUsers({ perPage: 1000 });
  const email = {}; (users.data && users.data.users || []).forEach(u => { email[u.id] = u.email; });

  if (MEASURE) {
    const sp = await pageAll(() => admin.from('prospect_splits').select('user_id, call_id, undone_at'));
    const reps = {}; sp.forEach(r => { if (!r.undone_at) reps[r.user_id] = (reps[r.user_id] || 0) + 1; });
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    [['all-time', null], ['30-day', since]].forEach(([w, from]) => {
      const joined = calls.filter(c => Object.prototype.hasOwnProperty.call(outcomeBy, c.id) && (!from || c.call_date >= from))
        .map(c => ({ id: c.id, user_id: c.user_id, call_date: c.call_date, outcome: outcomeBy[c.id], prospect_id: c.prospect_id }));
      const rated = ratedCallsOnly(joined); const byRep = {}; rated.forEach(c => (byRep[c.user_id] = byRep[c.user_id] || []).push(c));
      console.log(w + ' LIVE close rate, reps with split rows:');
      Object.keys(reps).forEach(uid => { const r = closeRateForCalls(byRep[uid] || [], mergedInto); console.log('  ' + (email[uid] || uid) + ': ' + r.closed + '/' + r.total + ' (' + r.pct + '%)  [' + reps[uid] + ' live split rows]'); });
    });
    return;
  }
  const plan = planSplits({ prospects, calls });
  const moveBy = {}; plan.moves.forEach(m => { moveBy[m.call_id] = m; });
  const existingKey = {}; prospects.forEach(p => { existingKey[p.user_id + '|' + (p.display_name || '').toLowerCase()] = p.id; });

  const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  function rates(remap, fromIso) {
    const joined = calls.filter(c => Object.prototype.hasOwnProperty.call(outcomeBy, c.id) && (!fromIso || c.call_date >= fromIso))
      .map(c => ({ id: c.id, user_id: c.user_id, call_date: c.call_date, outcome: outcomeBy[c.id],
                   prospect_id: (remap && moveBy[c.id]) ? ('split:' + c.user_id + '|' + moveBy[c.id].to_name_key) : c.prospect_id }));
    const rated = ratedCallsOnly(joined);
    const byRep = {}; rated.forEach(c => (byRep[c.user_id] = byRep[c.user_id] || []).push(c));
    const out = {}; Object.keys(byRep).forEach(uid => { out[uid] = closeRateForCalls(byRep[uid], mergedInto); });
    return out;
  }
  const windows = { 'all-time': null, '30-day': since30 };
  const affected = {}; plan.moves.forEach(m => { affected[m.user_id] = true; });
  let stop = false;
  console.log('PLAN: prospects split=' + plan.prospects_split + ' moves=' + plan.moves.length + ' skipped=' + JSON.stringify(plan.skipped));
  const perRep = {};
  plan.moves.forEach(m => { const r = (perRep[m.user_id] = perRep[m.user_id] || { prospects: {}, targets: {}, moves: 0, closed: 0 }); r.prospects[m.from_prospect_id] = 1; r.targets[m.to_name_key] = 1; r.moves++; if (outcomeBy[m.call_id] === 'closed') r.closed++; });
  Object.keys(perRep).forEach(uid => { const r = perRep[uid]; console.log('  ' + (email[uid] || uid) + ': prospects split=' + Object.keys(r.prospects).length + ' → ' + Object.keys(r.targets).length + ' people; calls moved=' + r.moves + ' (closed calls among them=' + r.closed + ')'); });
  Object.keys(windows).forEach(w => {
    const before = rates(false, windows[w]), after = rates(true, windows[w]);
    console.log('\n' + w + ' close rate, reps the plan touches:');
    Object.keys(affected).forEach(uid => {
      const b = before[uid] || { closed: 0, total: 0, pct: null }, a = after[uid] || { closed: 0, total: 0, pct: null };
      const down = (b.pct != null && a.pct != null && a.pct < b.pct);
      if (down) stop = true;
      console.log('  ' + (email[uid] || uid) + ': ' + b.closed + '/' + b.total + ' (' + b.pct + '%) → ' + a.closed + '/' + a.total + ' (' + a.pct + '%)' + (down ? '   ⚠ DOWN — STOP' : ''));
    });
  });
  const csv = ['rep,from_prospect,to_prospect,call_title,outcome,call_date'].concat(plan.moves.map(m => [email[m.user_id], m.from_display_name, m.to_display_name, JSON.stringify(m.reason.title), outcomeBy[m.call_id] || '', (calls.find(c => c.id === m.call_id) || {}).call_date || ''].join(','))).join('\n');
  const outDir = path.join(os.homedir(), 'Desktop', 'scan-reports'); fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'splits-2026-09-03.csv'), csv + '\n');
  console.log('\nplan written: ~/Desktop/scan-reports/splits-2026-09-03.csv');
  if (stop && !OVERRIDE) { console.log('\n⚠ STOP RULE: a rate would move DOWN. Not applying' + (APPLY ? ' (even with --apply; a ruling must be named: --override-stop "<who, when, why>")' : '') + '.'); process.exit(2); }
  if (stop && OVERRIDE) { console.log('\n⚠ STOP RULE OVERRIDDEN BY RULING: ' + OVERRIDE); plan.moves.forEach(m => { m.reason.stop_override = OVERRIDE; }); }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return; }
  const res = await applySplits(admin, plan.moves);
  console.log('\nAPPLIED: ' + JSON.stringify(res));
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
