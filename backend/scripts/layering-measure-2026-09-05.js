#!/usr/bin/env node
'use strict';
/* H733 — PROVE BY LOOKING. Same real call (Josh's, carrying a financial disqualification), same material:
   (1) the coaching text under THREE states — doctrine only · doctrine + a NON-conflicting team note · doctrine + a
       note that CONFLICTS with a non-locked entry; (2) the opening line BEFORE (told "Lost") and AFTER (told
       disqualified); (3) the two REFUSALS, executed through the real extraction call, quoting what the manager sees.
   WRITES NOTHING to any call or note. Run with --count to price it (the raw count_tokens endpoint, free); --run to spend.
   Lane 'layering-measure' in model_usage. */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { usageFor, setUsageRecorder } = require('../lib/model-usage');
const coaching = require('../lib/coaching');
const D = require('../lib/doctrine');
const corrections = require('../lib/coaching-corrections');
const { loadKbMaterial } = require('../lib/kb-material');
const MODEL = 'claude-sonnet-4-6';
const CALL = '1fb6e4ec-b079-4b54-b483-4c6fd133f818'; const JOSH = '40616e16-a92b-45c4-99b8-b3d12e508bf6';
const RUN = process.argv.includes('--run');
const create = usageFor('layering-measure');
setUsageRecorder(admin);
async function countTokens(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json(); if (!r.ok) throw new Error('count_tokens: ' + JSON.stringify(j)); return j.input_tokens;
}
async function ask(prompt, max) { const r = await create({ model: MODEL, max_tokens: max, messages: [{ role: 'user', content: prompt }] }, { userId: null, callId: CALL }); return (r.content || []).map((c) => c.text || '').join(''); }
(async () => {
  const hl = await admin.from('call_highlights').select('id, type, resolution, section, timestamp_seconds, quote, observation, closer_response, closer_response_verified, objection_class, speaker, fathom_call_id, user_id').eq('fathom_call_id', CALL);
  if (hl.error) throw new Error(hl.error.message);
  const material = await loadKbMaterial(admin, { userId: JOSH, lane: 'layering-measure', maxChars: 2500 });
  const moments = coaching.selectCoachableMoments(hl.data).map(coaching.toMoment);
  const hasDq = coaching.hasDqMoment(hl.data);
  const doctrine = material.doctrine;
  // the three states — the notes are HYPOTHETICAL rows handed to the block; nothing is stored
  const NON_CONFLICT = { id: 'x1', content: 'On this team, isolate a money objection twice — once on the concern itself and once on whether it is the only thing — before any reframe.', metadata: { doctrine_keys: ['isolation_is_the_correct_first_move'] } };
  const CONFLICT = { id: 'x2', content: 'On this team, price is its own objection type: when the prospect says it is too expensive, coach it as a price objection and name it "price", not fear.', metadata: { doctrine_keys: ['the_five_objection_types'] } };
  function prompt(notes, dq) {
    const liveNotes = (material.notes.rows || []);
    const rows = liveNotes.concat(notes);
    const text = rows.map((r, i) => (i + 1) + '. ' + r.content).join('\n');
    return coaching.buildCoachingPrompt(moments, { outcome: 'lost', later: null, objectionNotes: null, managerNotes: text || null, sellingContext: material.contextText || null, doctrineBlock: D.doctrineBlock(doctrine, 'coaching', rows), dq: dq });
  }
  const states = { doctrine_only: prompt([], true), plus_non_conflicting: prompt([NON_CONFLICT], true), plus_conflicting: prompt([CONFLICT], true), before_told_lost: prompt([], false) };
  // the two refusals — the real extraction call on a real moment of this call
  const iso = hl.data.filter((h) => h.type === 'objection')[0] || hl.data[0];
  const moment = Object.assign({}, iso, { closer_response: iso.closer_response_verified === true ? iso.closer_response : null });
  const refusals = [
    { rule: 'isolation', feedback: 'Stop telling my closers to isolate. When the money objection comes up, just answer it directly and go for the close.' },
    { rule: 'dq_loss', feedback: 'If the prospect says they cannot afford it, that is a lost deal — coach the close, not the qualification.' },
  ];
  const extractionPrompts = refusals.map((r) => corrections._extractionPrompt({ feedback: r.feedback, moment: moment, coaching: iso.coaching || null, doctrine: doctrine }));
  // ── COUNT FIRST
  const counts = {};
  for (const k of Object.keys(states)) counts[k] = await countTokens(states[k]);
  counts.refusal_1 = await countTokens(extractionPrompts[0]); counts.refusal_2 = await countTokens(extractionPrompts[1]);
  const inTok = Object.values(counts).reduce((a, b) => a + b, 0);
  const outCap = 4 * coaching.COACHING_MAX_TOKENS + 2 * 300;
  const est = (inTok * 3 / 1e6) + (outCap * 15 / 1e6);
  console.log('input tokens by prompt: ' + JSON.stringify(counts) + ' | total in ' + inTok + ' | output cap ' + outCap + ' | ceiling $' + est.toFixed(3));
  if (!RUN) { console.log('COUNT ONLY — nothing spent. Re-run with --run.'); return; }
  const out = { call: CALL, hasDq: hasDq, moments: moments.map((m) => m.time + ' ' + m.quote.slice(0, 70)), counts: counts, states: {}, refusals: [] };
  for (const k of Object.keys(states)) { out.states[k] = await ask(states[k], coaching.COACHING_MAX_TOKENS); console.log('state ' + k + ' done'); }
  for (let i = 0; i < refusals.length; i++) {
    const x = await corrections.extractConcept({ feedback: refusals[i].feedback, moment: moment, coaching: iso.coaching || null, userId: null, doctrine: doctrine });
    const refused = !!(x.locked_conflict && x.locked_conflict.sure);
    out.refusals.push({ expected_rule: refusals[i].rule, feedback: refusals[i].feedback, concept: x.concept, doctrine: x.doctrine, locked_conflict: x.locked_conflict, refused: refused,
      manager_sees: refused ? D.lockedRefusalText(x.locked_conflict.rule, x.locked_conflict.reason) : '(NOT refused — would have been stored' + (x.locked_conflict ? ', with the doubt on record' : '') + ')' });
  }
  const dir = path.join(os.homedir(), 'Desktop', 'scan-reports', 'doctrine'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'layering.json'), JSON.stringify(out, null, 1));
  console.log('written ' + path.join(dir, 'layering.json'));
})().catch((e) => { console.error(e); process.exit(1); });
