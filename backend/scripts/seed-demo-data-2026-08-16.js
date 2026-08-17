// Demo-data seed. DIRECT ROW INSERTION — zero model calls.
// Run with --plan to print and exit. Run with --insert to write.
//
// ⚠ INSERTS ONLY, scoped to the three demo user_ids. Nothing is updated or
// deleted, so Josh's data cannot be affected even if this script is wrong.
const fs = require('fs');
const REPO = '/Users/justinschmidt/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay';
const K = fs.readFileSync(REPO + '/API Keys.md', 'utf8');
const v = (n) => K.match(new RegExp('^' + n + '=(.+)$', 'm'))[1].trim();
const { createClient } = require(REPO + '/backend/node_modules/@supabase/supabase-js');
const admin = createClient(v('SUPABASE_URL'), v('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const MARK = 'seed-2026-08-16-';
const JOSH = '8c952cc0-fae4-4fa4-bd8a-e88b57d8c0c1';
// ⚠ REAL ids, fetched from auth.users. My first draft INVENTED these from the
// 8-char prefixes visible in earlier query output — which would have inserted
// rows against user_ids that do not exist.
const REPS = [
  { id: '49711e7d-0dc0-4c6d-959d-f2a5bfe9a20a', name: 'demo-ava' },
  { id: '8bda1aac-6404-46a8-a353-de83606b298f', name: 'demo-ben' },
  { id: 'e3ae475c-e788-45d6-a2ba-c40ca7f20a2d', name: 'demo-cara' },
];

// Deterministic pseudo-random so a re-run is reproducible.
let _s = 42;
function rnd() { _s = (_s * 1103515245 + 12345) % 2147483648; return _s / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

// Each rep is SHAPED to trip a specific threshold, and to trace a different curve.
const PLAN = [
  { rep: 0, calls: 24, prospects: 14, closeRate: 0.14, handleCurve: [45, 38, 30, 22, 15, 10],
    fearObj: 9, whatMattered: 0,
    trips: ['worst-first sort: LOWEST closing rate', '>=6 fear objections (leg 1 of 3)', 'declining handle curve'] },
  { rep: 1, calls: 22, prospects: 12, closeRate: 0.42, handleCurve: [20, 28, 35, 30, 44, 52],
    fearObj: 8, whatMattered: 0,
    trips: ['second rep WITH prospects -> closing graph gets 2+ lines', '>=6 fear objections (leg 2 of 3)', 'rising curve'] },
  { rep: 2, calls: 26, prospects: 0, closeRate: 0,   handleCurve: [30, 15, 40, 18, 35, 25],
    fearObj: 7, whatMattered: 16,
    trips: ['>=6 fear objections (leg 3 of 3) -> "lowest on the team" can finally render',
            'TIER 2: 16 what_mattered rows, ~63% on one area', 'jagged curve, no prospects -> sorts LAST'] },
];
const WEEKS = 6;
const AREA_MAIN = 'income_goal_and_motivation';
const AREA_OTHER = ['previous_attempts', 'timeline_and_readiness', 'financial_qualification'];

async function joshCounts() {
  const c = await admin.from('fathom_calls').select('id', { count: 'exact', head: true }).eq('user_id', JOSH);
  const a = await admin.from('call_analyses').select('id', { count: 'exact', head: true }).eq('user_id', JOSH);
  const p = await admin.from('prospects').select('id', { count: 'exact', head: true }).eq('user_id', JOSH);
  return { calls: c.count, analyses: a.count, prospects: p.count };
}

async function main() {
  const mode = process.argv[2] || '--plan';
  console.log('=== SEED PLAN — marker "' + MARK + '" ===\n');
  let totCalls = 0, totProspects = 0, totObj = 0, totWm = 0;
  PLAN.forEach(function (p) {
    const r = REPS[p.rep];
    totCalls += p.calls; totProspects += p.prospects; totObj += p.fearObj; totWm += p.whatMattered;
    console.log('  ' + r.name.padEnd(10) + p.calls + ' calls · ' + p.prospects + ' prospects · '
      + p.fearObj + ' fear objections · ' + p.whatMattered + ' what_mattered');
    p.trips.forEach(function (t) { console.log('             ↳ ' + t); });
  });
  console.log('\n  TOTAL: ' + totCalls + ' calls, ' + totProspects + ' prospects, '
    + totObj + ' fear objections across ' + PLAN.length + ' reps, ' + totWm + ' what_mattered rows');
  console.log('  spread over ' + WEEKS + ' weeks; ZERO model calls');
  console.log('\n  REMOVAL:');
  console.log("    delete from fathom_calls where fathom_call_id like '" + MARK + "%';");
  console.log("    delete from prospects     where display_name  like 'Seed %';");

  const before = await joshCounts();
  console.log('\n=== JOSH BEFORE (must be identical after) ===');
  console.log('  calls=' + before.calls + '  analyses=' + before.analyses + '  prospects=' + before.prospects);

  // Prove every target id is a REAL user before writing a single row.
  const check = await admin.from('user_profiles').select('user_id').in('user_id', REPS.map(function (r) { return r.id; }));
  const found = (check.data || []).map(function (r) { return r.user_id; });
  console.log('\n=== TARGET IDS VERIFIED ===');
  REPS.forEach(function (r) { console.log('  ' + r.name.padEnd(10) + (found.indexOf(r.id) !== -1 ? 'exists' : '*** NOT FOUND ***')); });
  if (found.length !== REPS.length) { console.error('\nABORT: a target user_id does not exist.'); return; }

  if (mode !== '--insert') { console.log('\n[plan only — nothing written. re-run with --insert]'); return; }
  console.log('\n=== INSERTING ===');
  const now = Date.now();
  for (const p of PLAN) {
    const rep = REPS[p.rep];
    // prospects first, so calls can reference them
    const prospectIds = [];
    for (let i = 0; i < p.prospects; i++) {
      const nm = 'Seed ' + rep.name.replace('demo-', '') + ' Prospect ' + (i + 1);
      const ins = await admin.from('prospects').insert({
        user_id: rep.id, display_name: nm, name_key: nm.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      }).select('id').single();
      if (ins.error) { console.error('  prospect insert failed: ' + ins.error.message); return; }
      prospectIds.push(ins.data.id);
    }
    const closedCount = Math.round(p.prospects * p.closeRate);
    let objMade = 0, wmMade = 0, mainWm = 0;
    for (let i = 0; i < p.calls; i++) {
      const week = i % WEEKS;
      const dayOffset = week * 7 + (i % 5);
      const callDate = new Date(now - (WEEKS * 7 - dayOffset) * 86400000).toISOString();
      const pid = prospectIds.length ? prospectIds[i % prospectIds.length] : null;
      const isClosed = pid !== null && prospectIds.indexOf(pid) < closedCount && i < p.prospects;
      const callRow = {
        user_id: rep.id, fathom_call_id: MARK + rep.name + '-' + i,
        title: 'Seed call ' + (i + 1) + ' | ' + rep.name, call_date: callDate,
        duration_seconds: 1800 + Math.floor(rnd() * 1800), sync_status: 'processed',
        source: 'fathom', prospect_id: pid,
      };
      const c = await admin.from('fathom_calls').insert(callRow).select('id').single();
      if (c.error) { console.error('  call insert failed: ' + c.error.message); return; }
      const callId = c.data.id;

      // what_mattered, concentrated for the tier-2 rep
      let wm = null;
      if (wmMade < p.whatMattered) {
        wmMade++;
        const useMain = mainWm < Math.ceil(p.whatMattered * 0.63);
        if (useMain) mainWm++;
        wm = { area_key: useMain ? AREA_MAIN : pick(AREA_OTHER),
               reason_evidence: 'seeded evidence line', reason_verified: true };
      }
      const base = p.handleCurve[week];
      const a = await admin.from('call_analyses').insert({
        fathom_call_id: callId, user_id: rep.id, status: 'done',
        prompt_version: 'seed-2026-08-16', analyzed_at: callDate,
        overall_score: 45 + Math.floor(rnd() * 30),
        intro_score: 50 + Math.floor(rnd() * 25), discovery_score: 40 + Math.floor(rnd() * 25),
        pitch_score: 55 + Math.floor(rnd() * 25), objection_score: 45 + Math.floor(rnd() * 25),
        close_score: isClosed ? 100 : 45 + Math.floor(rnd() * 25),
        close_score_earned: 40 + Math.floor(rnd() * 30),
        outcome: isClosed ? 'closed' : pick(['follow_up', 'lost', 'follow_up']),
        outcome_source: 'inferred', cash_collected: isClosed ? 2500 : 0,
        what_mattered: wm, overall_summary: 'Seeded demo call.',
      });
      if (a.error) { console.error('  analysis insert failed: ' + a.error.message); return; }

      // objections — enough `fear` per rep to clear the ranking threshold
      const nObj = objMade < p.fearObj ? 1 : (rnd() < 0.4 ? 1 : 0);
      for (let k = 0; k < nObj; k++) {
        const isFear = objMade < p.fearObj;
        if (isFear) objMade++;
        const handled = rnd() * 100 < base;
        const h = await admin.from('call_highlights').insert({
          fathom_call_id: callId, user_id: rep.id, type: 'objection',
          timestamp_seconds: 600 + Math.floor(rnd() * 1200),
          speaker: 'PROSPECT', quote: 'Seeded objection quote.', observation: 'Seeded observation.',
          objection_category: isFear ? 'fear' : pick(['timing', 'logistical', 'partner']),
          resolution: handled ? 'handled' : pick(['partial', 'unhandled']),
          section: 'objection', sequence_order: k,
        });
        if (h.error) { console.error('  highlight insert failed: ' + h.error.message); return; }
      }
    }
    console.log('  ' + rep.name + ': ' + p.calls + ' calls, ' + prospectIds.length + ' prospects, '
      + objMade + ' fear objections, ' + wmMade + ' what_mattered (' + mainWm + ' on ' + AREA_MAIN + ')');
  }
  const after = await joshCounts();
  console.log('\n=== JOSH AFTER ===');
  console.log('  calls=' + after.calls + '  analyses=' + after.analyses + '  prospects=' + after.prospects);
  console.log('  UNTOUCHED: ' + (before.calls === after.calls && before.analyses === after.analyses
    && before.prospects === after.prospects ? 'YES' : '*** NO — INVESTIGATE ***'));
}
main().catch(function (e) { console.error('FAILED:', e.message); });
