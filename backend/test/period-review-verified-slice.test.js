'use strict';
/* THE PERIOD REVIEW CARRIES ITS OWN VERIFIED TURNS (H770).
   Team → Coaching failed three of six cold loads on 2026-09-10: `[team] coachable-moments:
   Coaching evidence unavailable: canceling statement due to statement timeout · code 57014`.
   The route read `transcript_stored` for every window call carrying a period review — 219
   calls, ~9 MB a 100-id statement, ~20 MB a load — only to re-derive three hashes and look
   up a handful of cited turns. The record is written in the SAME upsert as the transcript
   it verified against and a re-analysis rewrites both, so the re-derivation is redundant by
   construction. The record now stores a VERIFIED SLICE at write time: the hashes and exactly
   the turns its checks touch. `storedExamples` reads the slice when the transcript is
   absent, and the route reads a transcript only for the calls whose improvements need a
   window around a moment. A record without a slice (written before this) still falls back
   to the transcript until the $0 backfill gives it one. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/call-period-review');
const E = require('../lib/coaching-evidence-review');
const F = require('../lib/followup-facts');

const a = { outcome: 'follow_up', transcript_stored: [
  { speaker: 'PROSPECT', text: 'I have not checked what I can invest.', start_seconds: 1 },
  { speaker: 'CLOSER', text: 'Let us discuss the program.', start_seconds: 2 },
  { speaker: 'PROSPECT', text: 'All right, let us do that.', start_seconds: 3 },
  { speaker: 'CLOSER', text: 'Here is how the first ninety days run.', start_seconds: 4 },
  { speaker: 'PROSPECT', text: 'Understood.', start_seconds: 5 } ] };
const m = { kbHash: 'k', contextText: 'Establish available resources before presenting the offer.' };
const f = { section: 'discovery', move: 'qualifying financially', observation: 'The closer moved into the program while available resources remained unresolved.', recommendation: 'Establish financial fit before presenting the offer.', turn_ids: [1, 2, 3], knowledge_refs: [E.knowledgeSources(m)[0].id] };
function record() {
  const c = P.prepare(a);
  return { version: 'call-period-review-v10', source_hash: c.hash, kb_hash: 'k', findings: [{ ...f, moment: 1 }], decisions: [{ moment: 1, verdict: 'approved' }] };
}
const noTranscript = { outcome: 'follow_up' };

test('the slice holds the hashes and exactly the turns the checks touch, and storedExamples reads it without the transcript', () => {
  const r = record();
  const slice = P.verifiedSlice(r, a);
  assert.equal(slice.hash, P.prepare(a).hash);
  assert.equal(slice.followup_hash, F.sourceHash(a));
  assert.equal(slice.turn_count, 5);
  assert.deepEqual(Object.keys(slice.turns).map(Number).sort(), [1, 2, 3], 'only the cited turns (no stage-facts reads on this record)');
  const withSlice = { ...r, verified: slice };
  const fromTranscript = P.storedExamples(r, a, 'k', { call_id: 'x' });
  const fromSlice = P.storedExamples(withSlice, noTranscript, 'k', { call_id: 'x' });
  assert.equal(fromTranscript.length, 1);
  assert.deepEqual(fromSlice, fromTranscript, 'the same examples, the same quotes, from the slice alone');
  assert.equal(P.storedExamples(r, noTranscript, 'k', {}), null, 'a record without a slice and without a transcript cannot be verified');
  assert.equal(P.storedExamples({ ...withSlice, source_hash: 'changed' }, noTranscript, 'k', {}), null, 'a stale hash still refuses');
  assert.equal(P.storedExamples(withSlice, noTranscript, 'changed', {}), null, 'a changed knowledge hash still refuses');
});

test('a slice covers a stage-facts read evidence turn and the seven after it (the same-speaker run located() walks)', () => {
  const long = { outcome: 'follow_up', transcript_stored: Array.from({ length: 14 }, (_, i) => ({ speaker: i % 2 ? 'CLOSER' : 'PROSPECT', text: 'Turn ' + (i + 1) + ' of the conversation.', start_seconds: i + 1 })) };
  const c = P.prepare(long);
  const r = { version: 'call-period-review-v10', source_hash: c.hash, kb_hash: 'k', findings: [{ ...f, moment: 1, turn_ids: [1, 2] }], decisions: [{ moment: 1, verdict: 'approved' }] };
  r.stage_facts = { version: require('../lib/period-stage-facts').VERSION, source_hash: c.hash, status: 'checked', decisions: [], reads: [
    { decisions: [{ state: 'undecided', evidence: [{ turn: 4, quote: 'Turn 4 of the conversation.' }], reason: 'x' }] }, { decisions: [] } ] };
  const slice = P.verifiedSlice(r, long);
  assert.deepEqual(Object.keys(slice.turns).map(Number).sort((x, y) => x - y), [1, 2, 4, 5, 6, 7, 8, 9, 10, 11], 'the finding\'s turns plus 4..11');
  assert.equal(slice.turn_count, 14);
});

test('the writer attaches the slice to every record it returns (executed with the model and material stubbed)', async () => {
  const W = require('../lib/period-coaching-worker');
  const call = { id: 'c1', fathom_call_id: 'f1', user_id: 'rep', not_a_sales_call: null, duplicate_of: null };
  const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: call, error: null }) }) }) }) }) };
  const deps = { loadMaterial: async () => ({ hasMaterial: true, kbHash: 'k', legacyKbHash: 'l', contextText: m.contextText, notes: null, doctrine: [] }), countTokens: async () => 100,
    create: async (req, meta) => ({ stop_reason: 'end_turn', content: [{ text: /stage-/.test(meta.lane) ? '{"decisions":[]}' : '{"findings":[]}' }] }) };
  const record = await W.assessPeriodCoaching(admin, call, a, 'rep', deps);
  assert.ok(record && record.verified, 'the returned record carries a slice');
  assert.equal(record.verified.version, P.SLICE_VERSION);
  assert.equal(record.verified.hash, P.prepare(a).hash);
  assert.equal(record.verified.turn_count, 5);
});

test('the route reads a transcript only where an improvement needs one — never for a period-review call that carries a slice', async () => {
  const { loadCoachableTeam } = require('../lib/coachable-team');
  const r = record(); const withSlice = { ...r, verified: P.verifiedSlice(r, a) };
  const reads = [];
  const admin = { from: function (table) {
    const q = { ids: null, sel: null,
      select: function (s) { q.sel = s; return q; }, in: function (_c, v) { q.ids = v; return q; }, eq: function () { return q; }, gte: function () { return q; }, lte: function () { return q; },
      not: function () { return q; }, is: function () { return q; }, order: function () { return q; }, range: function () { return q; },
      then: function (resolve, reject) {
        let out = { data: [], error: null };
        if (table === 'fathom_calls') out = { data: [{ id: 'sliced', user_id: 'rep', call_date: '2026-09-01T10:00:00Z', source: 'fathom', recording_url: null }, { id: 'legacy', user_id: 'rep', call_date: '2026-09-02T10:00:00Z', source: 'fathom', recording_url: null }], error: null };
        if (table === 'call_analyses' && /transcript_stored/.test(q.sel || '')) { reads.push((q.ids || []).slice()); out = { data: (q.ids || []).map(id => ({ fathom_call_id: id, outcome: 'follow_up', why_outcome: null, transcript_stored: a.transcript_stored })), error: null }; }
        else if (table === 'call_analyses') out = { data: [
          { fathom_call_id: 'sliced', status: 'done', outcome: 'follow_up', rep_period_coaching: withSlice },
          { fathom_call_id: 'legacy', status: 'done', outcome: 'follow_up', rep_period_coaching: r } ], error: null };
        return Promise.resolve(out).then(resolve, reject);
      } };
    return q;
  } };
  const out = await loadCoachableTeam(admin, ['rep'], '2026-08-12', '2026-09-10', Promise.resolve('k'));
  const readIds = reads.flat();
  assert.ok(!readIds.includes('sliced'), 'the sliced record needed no transcript: ' + JSON.stringify(reads));
  assert.ok(readIds.includes('legacy'), 'a record without a slice still falls back to the transcript');
  const rep = out.reps[0];
  assert.equal(rep.period_summary.patterns.length, 1, 'both calls\' examples still reach the panel');
  assert.equal(rep.period_summary.patterns[0].calls, 2);
});
