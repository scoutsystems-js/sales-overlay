'use strict';
/* BLOCK 015 (SCOUT-SHARED-CONTEXT.md) — THE PROMPT'S CANDIDATE LABELS NEVER REACH A MANAGER.
   The recommendations prompt labels its evidence candidates m1…mN (`candidates.forEach(c => c.id = 'm' + (i+1))`) so
   the model can cite one by `evidence_id`. On 2026-09-12 the deployed cron wrote a row whose three strength sentences
   quoted the labels IN THE PROSE — "Josh P's explicit pre-property sequencing at [m10] shows…", "Yazan confirmed at
   [m15] whether…", "Yazan's early check at [m13] — asking…" — and Block 011's strip (turn numbers only) let them
   through, at write time and at read time (Block 013 §8). The fix rides the ONE existing copy-cleaning path,
   `cleanInsightCopy`, which already runs on the candidate before the row is stored and on every cached row as it is
   served; nothing else about the claim, its evidence, the prompt or the record changes. */
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
const STRONG = { id: 'hs', fathom_call_id: 'c1', type: 'strong_moment', objection_category: null, objection_class: null, resolution: null, section: 'pitch', speaker: 'CLOSER', speaker_verified: true, timestamp_seconds: 2626, quote: 'I do not want you even thinking about real estate until you have already secured your clients', closer_response: null, closer_response_verified: null, handling: null, cause: null };
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

test('the live sentences: every [mN] label leaves, the words around it stay exactly as written', () => {
  assert.equal(TS._cleanInsightCopy("Pitch averages 76 — the highest section score. Josh P's explicit pre-property sequencing at [m10] shows the team anchoring client placement before real estate, which matches the offer's done-for-you positioning and reduces sticker shock."),
    "Pitch averages 76 — the highest section score. Josh P's explicit pre-property sequencing shows the team anchoring client placement before real estate, which matches the offer's done-for-you positioning and reduces sticker shock.");
  assert.equal(TS._cleanInsightCopy('Yazan confirmed at [m15] whether the $10,000 was accessible today versus arriving from an investor later — a distinction that separates genuine qualification from a number the prospect may not actually control.'),
    'Yazan confirmed whether the $10,000 was accessible today versus arriving from an investor later — a distinction that separates genuine qualification from a number the prospect may not actually control.');
  assert.equal(TS._cleanInsightCopy("Yazan's early check at [m13] — asking whether any business partners or decision-makers should be on the call — is the kind of upstream catch that prevents a late partner objection from killing a deal that ran correctly."),
    "Yazan's early check — asking whether any business partners or decision-makers should be on the call — is the kind of upstream catch that prevents a late partner objection from killing a deal that ran correctly.");
});
test('the label in every position it can land: leading, trailing before the full stop, bare mid-sentence, parenthesised, several in one sentence, beside a turn number', () => {
  assert.equal(TS._cleanInsightCopy('[m3] Ava isolated the fear first.'), 'Ava isolated the fear first.');
  assert.equal(TS._cleanInsightCopy('Ava isolated the fear first [m3].'), 'Ava isolated the fear first.');
  assert.equal(TS._cleanInsightCopy('Ava isolated the fear first ([m3]).'), 'Ava isolated the fear first.');
  assert.equal(TS._cleanInsightCopy('Ava [m3] isolated the fear first.'), 'Ava isolated the fear first.');
  assert.equal(TS._cleanInsightCopy('Ava isolated first at [m3] and again at [m12], then asked.'), 'Ava isolated first and again, then asked.');
  assert.equal(TS._cleanInsightCopy('Ava isolated at [m3] and rebooked at turn 512.'), 'Ava isolated and rebooked.');
});
test('ordinary bracketed customer text is NOT touched: a timestamp, a transcript note, a word in brackets, a bare m', () => {
  for (const s of [
    "Yazan let 'let me think on this' end the call at [00:32:18] without asking what specifically the prospect needed to think through.",
    'The prospect said [inaudible] and then asked about the deposit.',
    'The $10,000 [minimum] deposit was confirmed as accessible today.',
    'Press the [m] key to mute; the m10 model number stayed in the text.',
    'Manager note 1 is the standard here.',
  ]) assert.equal(TS._cleanInsightCopy(s), s, s);
  assert.equal(TS._cleanInsightCopy(null), null); assert.equal(TS._cleanInsightCopy(undefined), undefined);
});
test('CACHED row (the live shape, generated by the deployed cron): the labels are gone from claim and data as the row is served, the rest of the sentence and the evidence untouched — no regeneration', async () => {
  const cached = { generated_at: '2026-09-12T15:03:25Z',
    working: [{ claim: "The team's pitch mechanics are the strongest section on the board [m10].", data: "Pitch averages 76. Josh P's explicit pre-property sequencing at [m10] shows the team anchoring client placement before real estate.", rep: 'Ava R', spoke: 'closer', quote: STRONG.quote, clip_url: 'https://x/clip?t=2626', source: 'fathom', call_id: 'c1', highlight_id: 'hs' }],
    improve: [{ claim: 'Fear objections are left unhandled at the close.', data: 'Ava let one stand at [m1] without a diagnostic question.', rep: 'Ava R', spoke: 'closer', quote: OBJECTION.closer_response, clip_url: 'https://x/clip?t=900', source: 'fathom', call_id: 'c1', highlight_id: 'h1' }] };
  const out = await TS.computeTeamRecommendations(proxyAdmin(rows(cached)), 'mgr', ['mgr', 'rep'], FROM, TO, {}, {});
  assert.equal(out.cached, true, 'served from the cache: ' + JSON.stringify(out).slice(0, 200));
  const gap = out.improve[0];
  assert.equal(gap.data, 'Ava let one stand without a diagnostic question.');
  assert.equal(gap.claim, cached.improve[0].claim); assert.equal(gap.quote, OBJECTION.closer_response, 'a coachable moment still proves the gap'); assert.equal(gap.highlight_id, 'h1');
  /* the strength card renders only from a located exchange (transcript_stored is empty here), so read the served row before that attach step through the same cached path: */
  const served = JSON.stringify(out);
  assert.doesNotMatch(served, /\[m\d+\]/, 'no candidate label anywhere in what the route returns: ' + served.slice(0, 300));
});
test('FRESH synthesis: the labels are stripped from the candidate before the row is stored; the evidence binding is unchanged', async () => {
  reply = () => JSON.stringify({
    working: [],
    improve: [
      { claim: 'Fear objections are left unhandled at the close [m1].', data: 'Ava let one stand at [m1] and moved on.', evidence_id: 'm1', subject: { kind: 'objection', category: 'fear', section: 'close' } },
      { claim: 'Reps accept a soft exit at the close.', data: 'Ava said goodbye without a diagnostic question ([m2]).', evidence_id: null, subject: { kind: 'section', category: null, section: 'close' } } ] });
  const out = await TS.computeTeamRecommendations(proxyAdmin(rows(null)), 'mgr', ['mgr', 'rep'], FROM, TO, {}, {});
  assert.equal(out.cached, false, 'fresh branch expected: ' + JSON.stringify(out).slice(0, 400));
  assert.equal(out.improve.length, 2, JSON.stringify(out.improve));
  assert.equal(out.improve[0].claim, 'Fear objections are left unhandled at the close.');
  assert.equal(out.improve[0].data, 'Ava let one stand and moved on.');
  assert.equal(out.improve[0].quote, OBJECTION.closer_response, 'the cited moment still binds'); assert.equal(out.improve[0].highlight_id, 'h1');
  assert.equal(out.improve[1].data, 'Ava said goodbye without a diagnostic question.');
  assert.doesNotMatch(JSON.stringify(out), /\[m\d+\]/);
});
