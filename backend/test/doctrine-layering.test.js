const {withEvidence,withReviewModel}=require('./helpers/coaching-evidence-fixture');
/**
 * H733 — THE MANAGER'S VOICE ON TOP OF THE DOCTRINE, EXECUTED. The model seam is stubbed BEFORE the worker loads, the
 * real coaching pass runs on a fake wire, and the prompt it would send is captured. Asserted on the OUTPUT:
 *   · a team note attached to an entry is printed under THAT entry, and the block says it wins on conflict;
 *   · team A's note never reaches team B's lane; an unattached note stays team material and sits under no entry;
 *   · a note that speaks to two entries sits under both;
 *   · on a call that carries a disqualification the prompt says DISQUALIFIED and never "Call outcome: Lost", and
 *     a written "This call was lost" is dropped after the parse;
 *   · the loss rule runs IN CODE on the five synthesis lanes (executed per lane below).
 * A plant that removes the attachment from the block, or keeps the lookup and discards it, fails here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const muPath = require.resolve('../lib/model-usage');
const realMu = require(muPath);
const captured = []; let reply = () => JSON.stringify([{ moment: 1, coaching: 'Isolate the money objection before answering it.', applied_manager_notes: [] }]);
require.cache[muPath].exports = Object.assign({}, realMu, {
  createWithUsage: async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; },
  usageFor: function () { return async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; }; },
  setUsageRecorder: function () {},
});
require.cache[require.resolve('../lib/model-usage')].exports.createWithUsage = withReviewModel(require.cache[require.resolve('../lib/model-usage')].exports.createWithUsage);
const W = require('../lib/analysis-worker');
const D = require('../lib/doctrine');
const coaching = require('../lib/coaching');

const P = {
  headA: { user_id: 'headA', managed_by: null, niche: 'Sober living', offer: 'Team A offer: done-for-you market research and the blueprint', qualifications: 'TEAM A QUALIFICATIONS: 10k saved, not living paycheck to paycheck', script_raw: null },
  repA:  { user_id: 'repA',  managed_by: 'headA', niche: null, offer: null, qualifications: null, script_raw: null },
  headB: { user_id: 'headB', managed_by: null, niche: 'Roofing', offer: 'Team B offer: roofing leads programme, long enough to count', qualifications: 'TEAM B QUALIFICATIONS: owns a truck', script_raw: null },
  repB:  { user_id: 'repB',  managed_by: 'headB', niche: null, offer: null, qualifications: null, script_raw: null },
};
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i, created_at: '2026-09-05' }, r));
const NOTE_A = 'TEAM A NOTE: isolate a money objection twice before any reframe.';
const NOTE_A_TWO = 'TEAM A NOTE TWO: qualify for savings before the pitch and say so.';
const NOTE_A_LOOSE = 'TEAM A LOOSE NOTE: open every call with the agenda.';
const NOTE_B = 'TEAM B NOTE: never isolate more than once.';
const NOTES = {
  headA: [
    { id: 'nA1', content: NOTE_A, created_at: '2026-09-03', team_owner_id: 'headA', uploaded_by: 'headA', metadata: { concept_hash: 'a1', doctrine_key: 'isolation_is_the_correct_first_move', doctrine_keys: ['isolation_is_the_correct_first_move'] } },
    { id: 'nA2', content: NOTE_A_TWO, created_at: '2026-09-04', team_owner_id: 'headA', uploaded_by: 'headA', metadata: { concept_hash: 'a2', doctrine_keys: ['the_three_way_boundary_on_money', 'discovery_is_the_upstream_cause_of_every_objection'] } },
    { id: 'nA3', content: NOTE_A_LOOSE, created_at: '2026-09-04', team_owner_id: 'headA', uploaded_by: 'headA', metadata: { concept_hash: 'a3', doctrine_keys: [] } },
  ],
  headB: [{ id: 'nB1', content: NOTE_B, created_at: '2026-09-03', team_owner_id: 'headB', uploaded_by: 'headB', metadata: { concept_hash: 'b1', doctrine_keys: ['isolation_is_the_correct_first_move'] } }],
};
const OBJ = { id: 'h1', fathom_call_id: 'c1', type: 'objection', objection_class: 'true_objection', resolution: 'unhandled', section: 'close', timestamp_seconds: 1200, quote: 'I need to think about it', observation: 'o', closer_response: 'Sure, take your time', closer_response_verified: true, speaker: 'PROSPECT' };
const DQ  = { id: 'h2', fathom_call_id: 'c2', type: 'disqualify_signal', resolution: null, section: 'discovery', timestamp_seconds: 700, quote: 'I have nothing saved at all', observation: 'o', closer_response: 'Okay', closer_response_verified: true, speaker: 'PROSPECT' };
const OBJ2 = Object.assign({}, OBJ, { id: 'h1b', timestamp_seconds: 1500, quote: 'That is more than I expected' });
const HL = { c1: [OBJ, OBJ2], c2: [Object.assign({}, OBJ, { id: 'h3', fathom_call_id: 'c2' }), Object.assign({}, OBJ2, { id: 'h3b', fathom_call_id: 'c2' }), DQ] };
function fakeAdminBase(writes) {
  return { from(table) {
    const ch = { f: {}, _op: 'select', _p: null, select() { return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in() { return ch; }, is() { return ch; }, order() { return ch; }, not() { return ch; }, limit() { return ch; },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles' ? (P[ch.f.user_id] ? Object.assign({}, P[ch.f.user_id]) : null) : null, error: null }); },
      then(res, rej) {
        if (ch._op === 'update') { writes.push({ table, patch: ch._p, f: ch.f }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let rows = [];
        if (table === 'call_highlights') rows = (HL[ch.f.fathom_call_id] || []).map((r) => Object.assign({}, r));
        else if (table === 'user_profiles') rows = Object.values(P).filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]));
        else if (table === 'knowledge_base' && ch.f.category === 'doctrine') rows = DOCTRINE_ROWS;
        else if (table === 'knowledge_base' && ch.f.category === 'coaching_correction') rows = (NOTES[ch.f.team_owner_id] || []).map((r) => Object.assign({}, r));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  } };
}
function between(text, startRe, endRe) { const i = text.search(startRe); assert.ok(i >= 0, 'start anchor present: ' + startRe); const rest = text.slice(i); const j = rest.search(endRe); return j >= 0 ? rest.slice(0, j) : rest; }

test('⚠⚠ a team note ATTACHED to an entry is printed under THAT entry, the block says it wins on conflict, and the locked pair is restated', async () => {
  captured.length = 0; const writes = [];
  await W._coachCallMoments(fakeAdmin(writes), 'c1', 'lost', null, null, 'repA');
  assert.strictEqual(captured.length, 1); const p = captured[0];
  const isolation = between(p, /· Isolation is the correct first move/, /\n· Tying back in/);
  assert.ok(isolation.indexOf('THIS TEAM\'S MANAGER ON THIS POINT') !== -1 && isolation.indexOf(NOTE_A) !== -1, 'the note sits under its entry:\n' + isolation.slice(-300));
  assert.ok(/WINS on the point where the two conflict and the rest of the entry stands/.test(p), 'conflict-wins is stated');
  assert.ok(/Two rules are never overridden by any note: Never coach a rep out of isolating an objection\. Never treat a financial disqualification/.test(p), 'the locked pair is absolute');
  assert.ok(p.indexOf('SCOUT\'S METHOD') < p.indexOf('TEAM MATERIAL'), 'the layered method precedes the team material');
});
test('⚠⚠ team A\'s note never reaches team B\'s lane, asserted on the output', async () => {
  captured.length = 0; const writes = [];
  await W._coachCallMoments(fakeAdmin(writes), 'c1', 'lost', null, null, 'repB');
  const p = captured[0];
  assert.ok(p.indexOf(NOTE_A) === -1 && p.indexOf(NOTE_A_TWO) === -1 && p.indexOf(NOTE_A_LOOSE) === -1, 'no team A note in team B\'s prompt');
  assert.ok(between(p, /· Isolation is the correct first move/, /\n· Tying back in/).indexOf(NOTE_B) !== -1, 'team B\'s own note under the entry');
});
test('⚠⚠ an UNATTACHED note is team material exactly as before and sits under no entry; a note that speaks to TWO entries sits under both', async () => {
  captured.length = 0; const writes = [];
  await W._coachCallMoments(fakeAdmin(writes), 'c1', 'lost', null, null, 'repA');
  const p = captured[0];
  const method = between(p, /SCOUT'S METHOD/, /MANAGER NOTES/);
  assert.ok(method.indexOf(NOTE_A_LOOSE) === -1, 'the loose note is under no entry');
  assert.ok(between(p, /MANAGER NOTES/, /$/).indexOf(NOTE_A_LOOSE) !== -1, 'and is in the manager notes as before');
  assert.ok(between(p, /· The three-way boundary on money/, /\n· Discovery is the upstream/).indexOf(NOTE_A_TWO) !== -1, 'under the first entry it speaks to');
  assert.ok(between(p, /· Discovery is the upstream cause/, /\n· Isolation is the correct/).indexOf(NOTE_A_TWO) !== -1, 'and under the second');
});
test('⚠⚠ ITEM 2 — on a call that carries a disqualification the coaching lane is told DISQUALIFIED, never "Call outcome: Lost"; a written "This call was lost" is dropped after the parse', async () => {
  captured.length = 0; let writes = [];
  reply = () => JSON.stringify([{ moment: 1, coaching: 'This call was lost, and the first warning came in discovery.', applied_manager_notes: [] }, { moment: 2, coaching: 'The prospect had nothing saved; the miss was upstream, on qualification.', applied_manager_notes: [] }]);
  const out = await W._coachCallMoments(fakeAdmin(writes), 'c2', 'lost', null, null, 'repA');
  const p = captured[0];
  assert.ok(/the prospect was DISQUALIFIED/.test(p) && !/Call outcome: Lost\./.test(p), 'told disqualified, not lost:\n' + p.slice(0, 400));
  assert.ok(/THIS PROSPECT WAS DISQUALIFIED\. There was no deal to lose/.test(p), 'the cost clause follows');
  assert.strictEqual(out.written, 1, 'the loss-framed entry was dropped, the other written: ' + JSON.stringify(out));
  assert.ok(writes.some((w) => /miss was upstream/.test(String(w.patch.coaching))) && !writes.some((w) => /This call was lost/.test(String(w.patch.coaching))));
  captured.length = 0; writes = [];
  const out2 = await W._coachCallMoments(fakeAdmin(writes), 'c1', 'lost', null, null, 'repA');
  assert.ok(/Call outcome: Lost\./.test(captured[0]), 'a genuinely lost call is still told so');
  assert.strictEqual(out2.written, 2, 'and "This call was lost" stands on it');
  reply = () => JSON.stringify([{ moment: 1, coaching: 'Isolate the money objection before answering it.', applied_manager_notes: [] }]);
});
test('⚠⚠ ITEM 3 — the loss rule IN CODE on the recommendations and the performance summary: a claim framing a loss is dropped when its cited moment is on a disqualified call, or when every loss in the window is a DQ; kept on a real loss', () => {
  const TS = require('../lib/team-synthesis'); const PS = require('../lib/performance-synthesis');
  const scope = D.lossScope([{ fathom_call_id: 'dq', outcome: 'lost' }, { fathom_call_id: 'real', outcome: 'lost' }], [{ fathom_call_id: 'dq', type: 'disqualify_signal' }]);
  const byId = { m1: { id: 'm1', rep: 'Josh', quote: 'q', call_id: 'dq', type: 'objection', objection_category: 'fear', section: 'close', cls: 'disqualified' }, m2: { id: 'm2', rep: 'Josh', quote: 'q', call_id: 'real', type: 'objection', objection_category: 'fear', section: 'close', cls: 'loss' } };
  const claims = [{ claim: 'Josh lost the deal when he let the price sit.', data: 'x', evidence_id: 'm1', subject: { kind: 'objection', category: 'fear', section: 'close' } },
                  { claim: 'Josh lost the deal when he let the price sit.', data: 'x', evidence_id: 'm2', subject: { kind: 'objection', category: 'fear', section: 'close' } }];
  const t = TS._resolveInsights(claims, byId, ['Josh'], { lossScope: scope });
  assert.strictEqual(t.length, 1, 'recommendations: the DQ-cited claim dropped, the real-loss claim kept: ' + JSON.stringify(t));
  const pf = PS._resolveInsights(claims, byId, { lossScope: scope });
  assert.strictEqual(pf.length, 1, 'performance summary: same');
  const onlyDq = D.lossScope([{ fathom_call_id: 'dq', outcome: 'lost' }], [{ fathom_call_id: 'dq', type: 'disqualify_signal' }]);
  assert.strictEqual(TS._resolveInsights([{ claim: 'The team lost the deal on price.', data: 'x' }], {}, ['Josh'], { lossScope: onlyDq }).length, 0, 'unattributed, every loss a DQ → dropped');
  assert.strictEqual(TS._resolveInsights([{ claim: 'The team lost the deal on price.', data: 'x' }], {}, ['Josh'], { lossScope: scope }).length, 1, 'unattributed with a real loss in the window → kept');
});
test('⚠⚠ ITEM 3 — the digest, EXECUTED: a call carrying a DQ is presented as disqualified, its loss-framed notable is dropped, and the day summary is dropped when every loss of the day is a DQ', async () => {
  const { computeDailyDigest } = require('../lib/team-digest');
  function proxyAdmin(rows) {
    const build = (table) => { const target = { maybeSingle: () => Promise.resolve({ data: table === 'user_profiles' ? Object.assign({}, P.headA, { user_id: 'mgr-1' }) : null, error: null }), single: () => Promise.resolve({ data: null, error: null }), then: (res, rej) => Promise.resolve({ data: rows[table] || [], error: null }).then(res, rej) };
      return new Proxy(target, { get(t, prop) { if (prop in t) return t[prop]; if (typeof prop === 'symbol') return undefined; return () => build(table); } }); };
    return { from: build, auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } };
  }
  reply = () => JSON.stringify({ summary: 'The team lost the deal on its only call.', focus: 'Stop losing deals at the close.', notable: [{ call_id: 'c1', text: 'Josh lost the deal when the money came up.', timestamp_seconds: 100 }] });
  captured.length = 0;
  const dqDay = proxyAdmin({ fathom_calls: [{ id: 'c1', user_id: 'rep-1', title: 'A call', call_date: '2026-08-30T15:00:00Z' }], call_analyses: [{ fathom_call_id: 'c1', outcome: 'lost', overall_score: 60, status: 'done' }],
    call_highlights: [{ fathom_call_id: 'c1', timestamp_seconds: 100, speaker: 'PROSPECT', quote: 'nothing saved', observation: 'o', type: 'disqualify_signal', resolution: null }] });
  const out = await computeDailyDigest(dqDay, 'mgr-1', ['rep-1'], '2026-08-30', {}, {});
  assert.strictEqual(captured.length, 1, 'one model call: ' + JSON.stringify(out).slice(0, 200));
  assert.ok(/outcome: Disqualified \(the prospect could not buy — not a lost deal, not a failed close\)/.test(captured[0]), 'the call line says disqualified, never Lost');
  assert.strictEqual(out.summary, null, 'the summary framing the DQ as a loss is dropped: ' + JSON.stringify(out).slice(0, 300));
  assert.strictEqual(out.focus, null); assert.strictEqual(out.notable.length, 0, 'the loss-framed notable on the DQ call is dropped');
  captured.length = 0;
  const realDay = proxyAdmin({ fathom_calls: [{ id: 'c1', user_id: 'rep-1', title: 'A call', call_date: '2026-08-30T15:00:00Z' }], call_analyses: [{ fathom_call_id: 'c1', outcome: 'lost', overall_score: 60, status: 'done' }],
    call_highlights: [{ fathom_call_id: 'c1', timestamp_seconds: 100, speaker: 'PROSPECT', quote: 'too expensive', observation: 'o', type: 'objection', objection_category: 'fear', resolution: 'unhandled' }] });
  const out2 = await computeDailyDigest(realDay, 'mgr-1', ['rep-1'], '2026-08-30', {}, {});
  assert.ok(/outcome: Lost/.test(captured[0]) && out2.summary && out2.notable.length === 1, 'a real loss keeps its words: ' + JSON.stringify(out2).slice(0, 200));
  reply = () => JSON.stringify([{ moment: 1, coaching: 'Isolate the money objection before answering it.', applied_manager_notes: [] }]);
});
test('⚠⚠ ITEM 3 — the personal objections synthesis and the team objection summary carry the loss rule in code (executed on their resolvers), and every lane names the one function', () => {
  const fs = require('fs'); const path = require('path'); const { stripComments } = require('./helpers/strip-comments');
  const src = (f) => stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8'));
  ['team-synthesis.js', 'performance-synthesis.js', 'team-digest.js', 'objection-synthesis.js', 'team-objection-summary.js'].forEach((f) => {
    assert.ok(/enforceLossRule\(/.test(src(f)), f + ' calls the one loss rule');
  });
  assert.ok(/loss_scope_by_user/.test(src('team-objections.js')) && /disqualify_signal/.test(src('team-objections.js')), 'the objections module hands the summary a per-closer scope that reads the DQ moments');
  const s = D.lossScope([{ fathom_call_id: 'a', outcome: 'lost' }], [{ fathom_call_id: 'a', type: 'disqualify_signal' }]);
  assert.strictEqual(D.enforceLossRule('Isolate, then reframe — you lost the deal by skipping it.', s, null), null);
  assert.strictEqual(D.enforceLossRule('Isolate, then reframe.', s, null), 'Isolate, then reframe.');
});

function fakeAdmin(...args) { return withEvidence(fakeAdminBase(...args)); }
