/**
 * H735 — THE REP'S HISTORY REACHES THE COACHING, executed. The pattern key is code over stored fields; the not-moved
 * bar is pure and driven through its cases; the clause is code; the route is executed on a fake wire with the model
 * seam stubbed and fake record rows — rep A's clause counts A's rows in the window and never B's or team B's; the
 * coaching pass's prompt carries the record and the record is written with the entry; a scolding entry is dropped.
 * Plants: the record lookup removed → these fail; kept and its answer discarded → these fail.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const muPath = require.resolve('../lib/model-usage');
const realMu = require(muPath);
const captured = []; let reply = () => '{}';
require.cache[muPath].exports = Object.assign({}, realMu, {
  createWithUsage: async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; },
  usageFor: function () { return async function (params) { captured.push(params.messages[0].content); return { content: [{ text: reply(params.messages[0].content) }] }; }; },
  setUsageRecorder: function () {},
});
const H = require('../lib/coaching-history');
const W = require('../lib/analysis-worker');
const D = require('../lib/doctrine');

test('the pattern key is code over stored fields, and null where nothing is counted', () => {
  assert.strictEqual(H.patternKey({ type: 'objection', objection_category: 'partner', resolution: 'unhandled' }), 'objection:partner');
  assert.strictEqual(H.patternKey({ type: 'objection', objection_category: 'fear', resolution: 'partial' }), 'objection:fear');
  assert.strictEqual(H.patternKey({ type: 'objection', objection_category: 'fear', resolution: 'handled' }), null, 'a handled objection is not a pattern to coach');
  assert.strictEqual(H.patternKey({ type: 'risk_signal', handling: 'deflected' }), 'missed_signal');
  assert.strictEqual(H.patternKey({ type: 'barrier', handling: 'addressed' }), null);
  assert.strictEqual(H.patternKey({ type: 'missed_opportunity' }), 'missed_opportunity');
  assert.strictEqual(H.patternKey({ type: 'disqualify_signal' }), null);
  const items = [{ kind: 'missed_signal_pair' }, { kind: 'objection_unhandled', moment: { objection_category: 'partner' } }, { kind: 'objection_unhandled', moment: { objection_category: 'partner' } }, { kind: 'earned_signal' }];
  assert.strictEqual(H.repLinePatternKey(items, ['m1', 'm2', 'm3']), 'objection:partner', 'the most frequent key among the cited items');
  assert.strictEqual(H.repLinePatternKey(items, ['m1', 'm2']), 'missed_signal', 'a tie goes to the first cited');
  assert.strictEqual(H.repLinePatternKey(items, ['m4']), null, 'a strength has no pattern key');
});
test('⚠⚠ THE BAR: too few attempts → not cleared; no headroom → not cleared; cleared and flat → not moved; cleared and up by the move → moved', () => {
  assert.strictEqual(H.movedAssessment({ attempts: 5, handled: 0 }, { attempts: 9, handled: 1 }).state, 'not_cleared', 'MIN_BUCKET per window');
  assert.match(H.movedAssessment({ attempts: 5, handled: 0 }, { attempts: 9, handled: 1 }).why, /fewer than/);
  assert.strictEqual(H.movedAssessment({ attempts: 8, handled: 7 }, { attempts: 8, handled: 7 }).state, 'not_cleared', 'a rate at 88% has no headroom for a 20-point move');
  assert.strictEqual(H.movedAssessment({ attempts: 8, handled: 1 }, { attempts: 8, handled: 2 }).state, 'not_moved', '13% → 25% is one objection, inside the move');
  assert.strictEqual(H.movedAssessment({ attempts: 8, handled: 1 }, { attempts: 8, handled: 3 }).state, 'moved', '13% → 38% clears the move');
  assert.strictEqual(H.movedAssessment({ attempts: 6, handled: 0 }, { attempts: 6, handled: 0 }).state, 'not_moved', 'the floor itself: 0% → 0% on six each');
});
test('the clause is code: nothing under the repeat floor; the count alone when the bar is not cleared; the numbers when it is', () => {
  assert.strictEqual(H.historyClause({ calls: 2 }, null), null);
  assert.strictEqual(H.historyClause({ calls: 3 }, null), 'Scout has coached this on 3 calls this period.');
  assert.strictEqual(H.historyClause({ calls: 4 }, H.movedAssessment({ attempts: 2, handled: 0 }, { attempts: 3, handled: 0 })), 'Scout has coached this on 4 calls this period.', 'not enough data is never rendered as no improvement');
  assert.strictEqual(H.historyClause({ calls: 4 }, H.movedAssessment({ attempts: 8, handled: 1 }, { attempts: 8, handled: 2 })), 'Scout has coached this on 4 calls this period, and the handle rate has not moved: 13% of 8 before, 25% of 8 since.');
  assert.strictEqual(H.historyClause({ calls: 3 }, H.movedAssessment({ attempts: 8, handled: 1 }, { attempts: 8, handled: 4 })), 'Scout has coached this on 3 calls this period, and the handle rate has moved: 13% of 8 before, 50% of 8 since.');
  assert.ok(!H.scoldsRepeat('Isolate first, then ask what the partner needs to hear.') && H.scoldsRepeat('Yet again you let the partner objection sit.') && H.scoldsRepeat('You keep moving past the money signal.'));
  const block = H.historyBlock({ 'objection:partner': { calls: 3, last: '2026-09-01T10:00:00Z' }, missed_signal: { calls: 1 } }, [{ type: 'objection', objection_category: 'partner', resolution: 'unhandled' }, { type: 'risk_signal', handling: 'ignored' }]);
  assert.ok(/partner objections: coached on 3 earlier calls \(most recent 2026-09-01\)/.test(block) && !/missed signal/.test(block) && /NEVER AS AN ACCUSATION/.test(block), 'only patterns at the prior floor, with the rule');
});

/* ── the route, executed ── */
const P = { mgr: { user_id: 'mgr', role: 'manager', managed_by: null, niche: 'x', offer: 'Team offer: the blueprint, long enough to count as material', qualifications: 'TEAM QUALIFICATIONS: 10k saved', script_raw: null, team_name: 'SLR', first_name: 'Mia', last_name: 'M' },
  a: { user_id: 'a', role: 'user', managed_by: 'mgr', first_name: 'Ava', last_name: 'Reyes' }, b: { user_id: 'b', role: 'user', managed_by: 'mgr', first_name: 'Ben', last_name: 'Cole' } };
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
const IN = '2026-08-2', OUT = '2026-07-0';
const HISTORY = [
  { user_id: 'a', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'a1', call_date: IN + '1T10:00:00Z' }, { user_id: 'a', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'a2', call_date: IN + '2T10:00:00Z' }, { user_id: 'a', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'a3', call_date: IN + '3T10:00:00Z' },
  { user_id: 'a', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'a0', call_date: OUT + '1T10:00:00Z' },   // outside the window: not counted this period
  { user_id: 'b', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'b1', call_date: IN + '1T10:00:00Z' }, { user_id: 'b', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'b2', call_date: IN + '2T10:00:00Z' }, { user_id: 'b', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'b3', call_date: IN + '3T10:00:00Z' }, { user_id: 'b', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'b4', call_date: IN + '4T10:00:00Z' }, { user_id: 'b', team_key: 'mgr', pattern_key: 'objection:partner', fathom_call_id: 'b5', call_date: IN + '5T10:00:00Z' },
  { user_id: 'z', team_key: 'otherteam', pattern_key: 'objection:partner', fathom_call_id: 'z1', call_date: IN + '1T10:00:00Z' },
];
function calls(uid) { return ['1', '2', '3'].map((n) => ({ id: uid + n, fathom_call_id: uid + n, user_id: uid, title: 'T', call_date: IN + n + 'T10:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null })); }
function fakeAdmin(writes) {
  return { from(table) {
    const ch = { f: {}, _in: null, _op: 'select', _p: null, _gte: null, _lte: null, select() { return ch; }, upsert(p) { ch._op = 'upsert'; ch._p = p; return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, is() { return ch; }, not() { return ch; }, gte(k, v) { ch._gte = v; return ch; }, lte(k, v) { ch._lte = v; return ch; }, order() { return ch; }, range() { return ch; }, limit() { return ch; },
      maybeSingle() { if (table === 'user_profiles') return Promise.resolve({ data: P[ch.f.user_id] ? Object.assign({}, P[ch.f.user_id]) : null, error: null }); if (table === 'fathom_calls') return Promise.resolve({ data: { call_date: IN + '3T10:00:00Z' }, error: null }); return Promise.resolve({ data: null, error: null }); },
      then(res, rej) {
        if (ch._op === 'upsert' || ch._op === 'update') { writes.push({ table, op: ch._op, row: ch._p, f: ch.f }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let rows = [];
        const inSet = (r) => !ch._in || (ch._in[1] || []).indexOf(r[ch._in[0]]) !== -1;
        if (table === 'user_profiles') rows = Object.values(P).filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]));
        else if (table === 'fathom_calls') rows = calls('a').concat(calls('b')).filter(inSet);
        else if (table === 'call_analyses') rows = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({ fathom_call_id: id, outcome: 'lost', prospect_name: 'P' })).filter(inSet);
        else if (table === 'call_highlights') rows = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({ id: 'h' + id, fathom_call_id: id, type: 'objection', objection_category: 'partner', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', timestamp_seconds: 900, quote: 'I need to ask my wife', observation: 'o', closer_response: 'ok', closer_response_verified: true })).filter(inSet).filter((r) => !ch.f.fathom_call_id || r.fathom_call_id === ch.f.fathom_call_id);
        else if (table === 'knowledge_base' && ch.f.category === 'doctrine') rows = DOCTRINE_ROWS;
        else if (table === 'coaching_history') rows = HISTORY.filter(inSet).filter((r) => (!ch._gte || r.call_date >= ch._gte) && (!ch._lte || r.call_date <= ch._lte));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  }, auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } };
}
async function runRoute(query) {
  const team = require('../routes/team');
  const l = team.stack.find((x) => x.route && x.route.path === '/coachable-moments');
  const handler = l.route.stack[l.route.stack.length - 1].handle;
  return new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; Promise.resolve().then(() => handler({ user: { id: 'mgr', email: 'm@x' }, query: query || {} }, res)).catch((e) => resolve({ code: 'threw', body: String(e && e.stack) })); });
}
test('⚠⚠ THE ROUTE, EXECUTED: a pattern line carries the record\'s count for THAT rep inside the window — never another rep\'s rows, never another team\'s, never outside the window; a strength carries nothing', async () => {
  const team = require('../routes/team'); const writes = []; team._setAdminClientForTests(() => fakeAdmin(writes));
  captured.length = 0;
  reply = (p) => JSON.stringify(/CLOSER: Ben/.test(p) ? { kind: 'strength', judgement: '2 calls where they isolated the partner objection and closed', evidence_ids: ['m1', 'm2'], calls_claimed: 2 }
                                             : { kind: 'pattern', judgement: '3 calls where a partner objection landed and they let it sit', evidence_ids: ['m1', 'm2', 'm3'], calls_claimed: 3 });
  const r = await runRoute({ from: '2026-08-01T00:00:00Z', to: '2026-08-31T00:00:00Z' });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  const a = r.body.reps.find((x) => x.user_id === 'a'), b = r.body.reps.find((x) => x.user_id === 'b');
  assert.strictEqual(a.line.kind, 'pattern'); assert.ok(a.line.history, 'the record reached the line: ' + JSON.stringify(a.line));
  assert.strictEqual(a.line.history.key, 'objection:partner');
  assert.strictEqual(a.line.history.calls, 3, 'A: three rows in the window — the fourth is outside it, B\'s five are B\'s, team Z\'s is not on this board');
  assert.strictEqual(a.line.history_clause, 'Scout has coached this on 3 calls this period.', 'the bar is not cleared on this wire (too few attempts), so the count and nothing else');
  assert.strictEqual(a.line.history.assessment.state, 'not_cleared');
  assert.strictEqual(b.line.kind, 'strength'); assert.strictEqual(b.line.history, undefined); assert.strictEqual(b.line.history_clause, undefined, 'a strength never carries a history clause');
});
test('⚠⚠ THE COACHING PASS, EXECUTED: the prompt carries the record for this rep only; the record is written with the entry; a scolding entry is dropped', async () => {
  captured.length = 0; const writes = [];
  reply = () => JSON.stringify([{ moment: 1, coaching: 'A partner objection landed and you let it sit. Ask what the partner would need to hear, then ask for the commitment on that.', applied_manager_notes: [] }]);
  const out = await W._coachCallMoments(fakeAdmin(writes), 'a3', 'lost', null, null, 'a');
  assert.strictEqual(captured.length, 1, JSON.stringify(out));
  assert.ok(/HISTORY — what Scout has already coached this closer on, on earlier calls/.test(captured[0]) && /partner objections: coached on 4 earlier calls/.test(captured[0]), 'the record (all four of A\'s rows, no window on the call) reaches the prompt:\n' + captured[0].slice(0, 300));
  assert.ok(!/coached on 5 earlier/.test(captured[0]), 'B\'s five never reach A\'s prompt');
  const rec = writes.find((w) => w.table === 'coaching_history');
  assert.ok(rec && rec.row.user_id === 'a' && rec.row.pattern_key === 'objection:partner' && rec.row.fathom_call_id === 'a3' && rec.row.team_key === 'mgr', 'the record is written with the entry: ' + JSON.stringify(rec));
  captured.length = 0; writes.length = 0;
  reply = () => JSON.stringify([{ moment: 1, coaching: 'Yet again you let the partner objection sit. Same mistake.', applied_manager_notes: [] }]);
  const out2 = await W._coachCallMoments(fakeAdmin(writes), 'a3', 'lost', null, null, 'a');
  assert.strictEqual(out2.written, 0, 'a scolding entry is dropped'); assert.ok(!writes.some((w) => w.table === 'call_highlights'));
});
test('the page appends the clause after the line, never builds one itself', () => {
  const fs = require('fs'); const path = require('path'); const { stripComments } = require('./helpers/strip-comments');
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  assert.ok(/clauseHtml = '<span class="rep-line-history">' \+ escapeHtml\(L\.history_clause\) \+ '<\/span>'/.test(LIVE), 'H737: the clause is its own line below the sentence');
  assert.ok(!/coached this on/.test(LIVE), 'the clause text lives in one place: the lib');
});
