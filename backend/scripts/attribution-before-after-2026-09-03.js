#!/usr/bin/env node
/**
 * ATTRIBUTION — MEASURE BEFORE AND AFTER ON REAL BOARDS (H706). Before = the window
 * applied to each CALL's date (the code until today); after = the window applied to
 * the prospect's BOOKED-CALL anchor (windowByAnchor). Same rows, same outcomes, the
 * one computation. Justin's stop rule: the genuine later-call closes were ~14 of 278,
 * so no rep should move more than a couple of points; STOP_POINTS is the line.
 */
'use strict';
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const { closeRateForCalls, windowByAnchor } = require('../lib/prospect-entity');
const { realCallsOnly } = require('../lib/real-calls');
const { ratedCallsOnly } = require('../lib/dq-exclusion');
const { CHUNK } = require('../lib/chunk');
const STOP_POINTS = 3;
async function pageAll(build) { let rows = []; for (let p = 0; p < 40; p++) { const r = await build().range(p * 1000, p * 1000 + 999); if (r.error) throw new Error(r.error.message); rows = rows.concat(r.data || []); if (!r.data || r.data.length < 1000) return rows; } throw new Error('cap'); }
(async () => {
  const callsRaw = await pageAll(() => admin.from('fathom_calls').select('id, user_id, fathom_call_id, prospect_id, call_date, call_kind').not('not_a_sales_call', 'is', true).is('duplicate_of', null).not('prospect_id', 'is', null));
  const calls = realCallsOnly(callsRaw);
  const outcomeBy = {}; const ids = calls.map((c) => c.id);
  for (let i = 0; i < ids.length; i += CHUNK) { const r = await admin.from('call_analyses').select('fathom_call_id, outcome').in('fathom_call_id', ids.slice(i, i + CHUNK)).eq('status', 'done'); if (r.error) throw new Error(r.error.message); (r.data || []).forEach((a) => { outcomeBy[a.fathom_call_id] = a.outcome; }); }
  const pr = await pageAll(() => admin.from('prospects').select('id, merged_into')); const mergedInto = {}; pr.forEach((p) => { if (p.merged_into) mergedInto[p.id] = p.merged_into; });
  const users = await admin.auth.admin.listUsers({ perPage: 1000 }); const email = {}; ((users.data && users.data.users) || []).forEach((u) => { email[u.id] = u.email; });
  const joined = calls.filter((c) => Object.prototype.hasOwnProperty.call(outcomeBy, c.id)).map((c) => ({ id: c.id, user_id: c.user_id, prospect_id: c.prospect_id, call_date: c.call_date, call_kind: c.call_kind, outcome: outcomeBy[c.id] }));
  const rates = (rows) => { const rated = ratedCallsOnly(rows); const byRep = {}; rated.forEach((c) => (byRep[c.user_id] = byRep[c.user_id] || []).push(c)); const out = {}; Object.keys(byRep).forEach((u) => { out[u] = closeRateForCalls(byRep[u], mergedInto); }); return out; };
  const now = Date.now(); const wins = { '7-day': 7, '30-day': 30, '90-day': 90 };
  let stop = false;
  Object.keys(wins).forEach((w) => {
    const from = new Date(now - wins[w] * 86400e3).toISOString();
    const before = rates(joined.filter((c) => c.call_date >= from));
    const after = rates(windowByAnchor(joined, from, null));
    console.log('\n' + w + ' — window on each CALL (before) → window on the prospect\'s BOOKED call (after):');
    const reps = Object.keys(Object.assign({}, before, after)).sort((a, b) => (email[a] || a).localeCompare(email[b] || b));
    reps.forEach((u) => { const b = before[u] || { closed: 0, total: 0, pct: null }, a = after[u] || { closed: 0, total: 0, pct: null }; if (b.total < 6 && a.total < 6) return;
      const move = (b.pct != null && a.pct != null) ? a.pct - b.pct : null; const flag = (move != null && Math.abs(move) > STOP_POINTS) ? '   ⚠ MOVES ' + move + ' — STOP' : '';
      if (flag) stop = true;
      console.log('  ' + (email[u] || u) + ': ' + b.closed + '/' + b.total + ' (' + b.pct + '%) → ' + a.closed + '/' + a.total + ' (' + a.pct + '%)' + flag); });
  });
  const kinds = {}; calls.forEach((c) => { kinds[c.call_kind || 'null'] = (kinds[c.call_kind || 'null'] || 0) + 1; });
  console.log('\ncall_kind on live rows: ' + JSON.stringify(kinds) + ' (history is unflagged — anchoring today rests on the earliest call)');
  console.log(stop ? '\n⚠ STOP: a rep moved more than ' + STOP_POINTS + ' points.' : '\nWithin the plan: no rep moved more than ' + STOP_POINTS + ' points.');
  process.exit(stop ? 2 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
