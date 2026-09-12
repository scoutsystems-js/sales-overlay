'use strict';
/* BLOCK 011 (SCOUT-SHARED-CONTEXT.md) — TEAM STRENGTHS / COACHING FOCUS: TWO DEFECTS FOUND ON THE LIVE CACHED PAYLOAD.
   (1) A gap claim ("reps accept a soft exit…") cited a BUYING SIGNAL on a closed call as its evidence: the subject check
   compares type/category/section, never polarity, so an applaudable moment stood under a gap. The moment bar already
   says which moments are coachable and which applaudable (lib/moment-bar momentReason); a claim may only cite a moment
   of its own polarity — otherwise the quote is dropped and the claim kept (the H724 shape). Enforced at write time on
   the candidate and at read time on cached rows (a small highlight read), so the live row is corrected without a
   regeneration. (2) Internal turn numbers reached customer copy ("accepted 'No, we're good' at turn 1184"): 22 of 600
   cached claims. Stripped at write and at read with the period review's own regex. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test'), assert = require('node:assert/strict');
const muPath = require.resolve('../lib/model-usage'); const realMu = require(muPath);
let reply = () => '{}'; const captured = [];
const fakeCreate = async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; };
require.cache[muPath].exports = Object.assign({}, realMu, { createWithUsage: fakeCreate, usageFor: function () { return fakeCreate; }, setUsageRecorder: function () {} });
const TS = require('../lib/team-synthesis');
const D = require('../lib/doctrine');
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
const PROFILE = { user_id: 'mgr', role: 'manager', managed_by: null, niche: 'x', offer: 'Team offer: the blueprint, long enough to count as material', qualifications: 'TEAM QUALIFICATIONS: 10k saved', script_raw: null, team_name: 'SLR', first_name: 'Mia', last_name: 'M' };
const OBJECTION = { id: 'h1', fathom_call_id: 'c1', type: 'objection', objection_category: 'fear', objection_class: 'true_objection', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', speaker_verified: true, timestamp_seconds: 900, quote: 'I need to think about it before I commit to this', closer_response: 'Totally understand, take your time', closer_response_verified: true, handling: null, cause: null };
const STRONG = { id: 'hs', fathom_call_id: 'c1', type: 'strong_moment', objection_category: null, objection_class: null, resolution: null, section: 'close', speaker: 'CLOSER', speaker_verified: true, timestamp_seconds: 2626, quote: 'Do you take Amex? I like my points. Absolutely, let us get you enrolled today', closer_response: null, closer_response_verified: null, handling: null, cause: null };
function rows(cached) {
  return {
    user_profiles: [PROFILE, { user_id: 'rep', role: 'user', managed_by: 'mgr', first_name: 'Ava', last_name: 'R' }],
    fathom_calls: [{ id: 'c1', fathom_call_id: 'c1', user_id: 'rep', title: 'T', call_date: '2026-08-20T10:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null, duration_seconds: 2400, source: 'fathom' }],
    call_analyses: [{ fathom_call_id: 'c1', user_id: 'rep', status: 'done', outcome: 'lost', overall_score: 60, intro_score: 60, discovery_score: 60, pitch_score: 60, objection_score: 60, close_score: 60, one_thing: 'x', why_outcome: null, analyzed_at: '2026-08-20T11:00:00Z', prospect_name: 'P', transcript_stored: [] }],
    call_highlights: [OBJECTION, STRONG],
    knowledge_base: DOCTRINE_ROWS,
    objection_synthesis_cache: cached ? [{ synthesis: cached }] : [],
  };
}
function proxyAdmin(ROWS) {
  const build = (table, f) => { f = f || {}; const target = {
    maybeSingle: () => Promise.resolve({ data: table === 'user_profiles' ? Object.assign({}, PROFILE) : (ROWS[table] || [])[0] || null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    eq: (k, v) => build(table, Object.assign({}, f, { [k]: v })),
    then: (res, rej) => Promise.resolve({ data: (table === 'knowledge_base') ? (f.category === 'doctrine' ? DOCTRINE_ROWS : []) : (ROWS[table] || []), error: null, count: (ROWS[table] || []).length }).then(res, rej) };
    return new Proxy(target, { get(t, prop) { if (prop in t) return t[prop]; if (typeof prop === 'symbol') return undefined; return () => build(table, f); } }); };
  return { from: build, rpc: async () => ({ data: [], error: null }), auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'rep', email: 'ava@x' }, { id: 'mgr', email: 'm@x' }] } }) } } };
}
const FROM = '2026-08-07T00:00:00Z', TO = '2026-09-05T00:00:00Z';

test('polarity: a gap claim may not cite an applaudable moment, a strength may not cite a coachable one; matching polarity passes', () => {
  assert.ok(TS._evidencePolarityMismatch('improve', STRONG), 'a verified closer strong moment cannot prove a gap');
  assert.equal(TS._evidencePolarityMismatch('improve', OBJECTION), null, 'an unhandled objection can');
  assert.ok(TS._evidencePolarityMismatch('working', OBJECTION), 'an unhandled objection cannot prove a strength');
  assert.equal(TS._evidencePolarityMismatch('working', STRONG), null);
  assert.equal(TS._evidencePolarityMismatch('working', { type: 'objection', resolution: 'handled' }), null, 'a handled objection is applaudable');
  assert.equal(TS._evidencePolarityMismatch('improve', { type: 'rapport_moment' }), null, 'a moment with no polarity is left to the other checks');
});
test('copy: internal turn numbers never reach a manager', () => {
  assert.equal(TS._cleanInsightCopy("Preston accepted 'No, we're good' at turn 1184 without any attempt to hold the frame."), "Preston accepted 'No, we're good' without any attempt to hold the frame.");
  assert.equal(TS._cleanInsightCopy('Gabriel rebooked at turn 512 when the prospect had done her own maths at turns 375–380.'), 'Gabriel rebooked when the prospect had done her own maths.');
  assert.equal(TS._cleanInsightCopy('Josh named every deliverable at the price drop.'), 'Josh named every deliverable at the price drop.');
});
test('CACHED row (the live shape): the buying-signal-under-a-gap quote is dropped and the claim kept; turn numbers are stripped — no regeneration', async () => {
  const cached = { generated_at: '2026-09-12T03:21:57Z',
    working: [],
    improve: [{ claim: 'Close is the weakest section, and the recurring failure is accepting a soft exit without one diagnostic question.', data: "Close averages 61. Preston accepted 'No, we're good' at turn 1184 without any attempt to hold the frame.", rep: 'Ava R', spoke: 'closer', quote: STRONG.quote, clip_url: 'https://x/clip?t=2626', source: 'fathom', call_id: 'c1', highlight_id: 'hs' }] };
  const out = await TS.computeTeamRecommendations(proxyAdmin(rows(cached)), 'mgr', ['mgr', 'rep'], FROM, TO, {}, {});
  assert.equal(out.cached, true, 'served from the cache: ' + JSON.stringify(out).slice(0, 200));
  const it = out.improve[0];
  assert.equal(it.claim, cached.improve[0].claim, 'the claim stands');
  assert.equal(it.quote, null, 'the applaudable moment no longer sits under the gap'); assert.equal(it.highlight_id, null); assert.equal(it.clip_url, null); assert.equal(it.rep, null);
  assert.doesNotMatch(it.data, /turn 1184/); assert.match(it.data, /accepted 'No, we're good' without/);
});
test('FRESH synthesis: the same two rules run on the candidate before the row is stored', async () => {
  reply = () => JSON.stringify({
    working: [{ claim: 'The team isolates first.', data: 'Ava did it at turn 9 on one call.', evidence_id: 'm1', subject: { kind: 'objection', category: 'fear', section: 'close' } }],
    improve: [
      { claim: 'Fear objections are left unhandled at the close.', data: 'Ava let one stand.', evidence_id: 'm1', subject: { kind: 'objection', category: 'fear', section: 'close' } },
      { claim: 'Reps accept a soft exit at the close.', data: 'Ava said goodbye at turn 40 without a diagnostic question.', evidence_id: 'm2', subject: { kind: 'section', category: null, section: 'close' } } ] });
  const out = await TS.computeTeamRecommendations(proxyAdmin(rows(null)), 'mgr', ['mgr', 'rep'], FROM, TO, {}, {});
  assert.equal(out.cached, false, 'fresh branch expected: ' + JSON.stringify(out).slice(0, 400));
  assert.equal(out.improve.length, 2, JSON.stringify(out.improve));
  const gap = out.improve[0]; assert.equal(gap.quote, OBJECTION.closer_response, 'a coachable moment (m1, the unhandled objection) proves a gap');
  const soft = out.improve[1]; assert.equal(soft.claim, 'Reps accept a soft exit at the close.', 'the claim stands');
  assert.equal(soft.quote, null, 'the applaudable moment (m2, the verified strong moment) cannot prove a gap — the live defect, at write time'); assert.equal(soft.highlight_id, null);
  assert.equal(soft.data, 'Ava said goodbye without a diagnostic question.', 'turn numbers stripped at write time');
  assert.equal(out.working.length, 0, 'the strength that cited the unhandled objection lost its quote — and without located evidence the strength card is not shown (existing rule)');
});
