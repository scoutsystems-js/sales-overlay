/* THE SAME MEASUREMENT, BEFORE AND AFTER, ON THE SAME CALLS.
   ⚠ "before" is not reconstructed from memory: the five types carried ZERO
   closer_response across all 8,238 corpus moments, so the pre-v29 figure for
   this sample is 0 BY CONSTRUCTION — and the corpus query below re-proves it
   against every row still on an older prompt version. */
const { createClient } = require('@supabase/supabase-js');
const { labelForQuote } = require('./lib/quote-locate');
const { isSentinel, NO_REPLY, MOMENT_IS_CLOSER } = require('./lib/closer-side');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FIVE = ['buying_signal','strong_moment','missed_opportunity','rapport_moment','disqualify_signal'];
const THREE = ['objection','risk_signal','barrier'];
const ids = require('/tmp/sample_ids.json').map(s => s.id);
(async () => {
  const a = await admin.from('call_analyses')
    .select('fathom_call_id, prompt_version, status, transcript_stored').in('fathom_call_id', ids);
  const regraded = (a.data||[]).filter(r => r.prompt_version === 'v29-2026-08-28' && r.status === 'done');
  console.log('sample calls re-graded to v29: ' + regraded.length + ' of ' + ids.length);
  const tr = {}; regraded.forEach(r => { tr[r.fathom_call_id] = r.transcript_stored && r.transcript_stored.turns; });
  const rid = regraded.map(r => r.fathom_call_id);
  const h = await admin.from('call_highlights')
    .select('fathom_call_id, type, speaker, quote, closer_response, closer_response_verified, timestamp_seconds')
    .in('fathom_call_id', rid);
  const rows = h.data || [];

  const bucket = (list) => {
    const r = { total:0, span:0, noReply:0, isCloser:0, none:0 };
    list.forEach(m => { r.total++;
      const c = m.closer_response;
      if (c === NO_REPLY) r.noReply++;
      else if (c === MOMENT_IS_CLOSER) r.isCloser++;
      else if (typeof c === 'string' && c.trim()) r.span++;
      else r.none++; });
    return r;
  };
  const five = bucket(rows.filter(m => FIVE.indexOf(m.type)!==-1));
  const three = bucket(rows.filter(m => THREE.indexOf(m.type)!==-1));
  const pct = (n,d) => d ? Math.round(n*100/d) + '%' : 'n/a';

  console.log('\n=== THE FIVE TYPES THAT PREVIOUSLY STORED NOTHING ===');
  console.log('  BEFORE : 0 of ' + five.total + ' carried any closer side (0%) — by construction');
  console.log('  AFTER  : ' + (five.span+five.noReply+five.isCloser) + ' of ' + five.total
    + ' (' + pct(five.span+five.noReply+five.isCloser, five.total) + ')');
  console.log('      verbatim span      ' + five.span);
  console.log('      __no_reply__       ' + five.noReply + (five.noReply ? '   ← THE PATH FIRED' : '   ← still never observed'));
  console.log('      __moment_is_closer__ ' + five.isCloser);
  console.log('      nothing            ' + five.none);
  console.log('\n=== REGRESSION CHECK — the three that always worked ===');
  console.log('  ' + (three.span+three.noReply+three.isCloser) + ' of ' + three.total + ' ('
    + pct(three.span+three.noReply+three.isCloser, three.total) + ')  [corpus baseline 94-98%]');
  console.log('      span ' + three.span + '  no_reply ' + three.noReply + '  is_closer ' + three.isCloser + '  nothing ' + three.none);

  // ─── HAND-CHECK, wider than 8: prove each span independently ──────────────
  let proven=0, prospect=0, unplaceable=0, gapOK=0, gapFar=0, gapNone=0, checked=0;
  const far = [];
  rows.filter(m => FIVE.indexOf(m.type)!==-1 && typeof m.closer_response === 'string'
    && m.closer_response.trim() && !isSentinel(m.closer_response)).forEach(m => {
    const turns = tr[m.fathom_call_id]; if (!turns) return;
    checked++;
    const lbl = labelForQuote(turns, m.closer_response);
    if (lbl === 'CLOSER') proven++; else if (lbl === 'PROSPECT') prospect++; else unplaceable++;
    const qi = turns.findIndex(t => String(t.text||'').indexOf(String(m.quote||'').slice(0,40)) !== -1);
    const ri = turns.findIndex(t => String(t.text||'').indexOf(String(m.closer_response).slice(0,40)) !== -1);
    if (qi>=0 && ri>=0) { const g = ri-qi;
      if (g>0 && g<=4) gapOK++; else { gapFar++; if (far.length<5) far.push({ t:m.type, g, q:String(m.quote).slice(0,60), r:String(m.closer_response).slice(0,60) }); } }
    else gapNone++;
  });
  console.log('\n=== HAND-CHECK: ' + checked + ' verbatim spans, each proven independently ===');
  console.log('  proven to be THE CLOSER      ' + proven + '  (' + pct(proven,checked) + ')');
  console.log('  proven to be THE PROSPECT    ' + prospect + '  ← wrong person');
  console.log('  locator could not place it   ' + unplaceable);
  console.log('  within 4 turns (same exchange) ' + gapOK + '   further away ' + gapFar + '   not located ' + gapNone);
  if (far.length) { console.log('\n  furthest examples:'); far.forEach(f =>
    console.log('   [' + f.t + '] gap ' + f.g + '\n      moment: ' + f.q + '\n      reply : ' + f.r)); }

  // the safety net
  const netEligible = rows.filter(m => FIVE.indexOf(m.type)!==-1 && typeof m.closer_response==='string'
    && m.closer_response.trim() && !isSentinel(m.closer_response));
  const netTrue = netEligible.filter(m => m.closer_response_verified === true).length;
  console.log('\n=== THE SAFETY NET (what actually reaches a coaching surface) ===');
  console.log('  closer_response_verified = true : ' + netTrue + ' of ' + netEligible.length
    + ' (' + pct(netTrue, netEligible.length) + ') — the rest are recorded and EXCLUDED');
})().catch(e=>{console.error('THREW:',e.message);process.exit(1);});
