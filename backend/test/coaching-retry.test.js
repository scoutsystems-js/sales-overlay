/**
 * H737 — THE RETRY SWEEP, executed: a row left 'pending' after its analysis is done gets the coaching pass again
 * (awaited, marked with the result); NULL rows — the four uncoached calls, Josh N's sixteen — are never selected; the
 * sweep rides the post-drain warm-up and steps aside while a claim is live. It ships idle: the fake carries the only
 * pending row that exists anywhere.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const muPath = require.resolve('../lib/model-usage');
const realMu = require(muPath);
const captured = [];
require.cache[muPath].exports = Object.assign({}, realMu, {
  createWithUsage: async function (params) { captured.push(params.messages[0].content); return { content: [{ text: JSON.stringify([{ moment: 1, coaching: 'Isolate first.', applied_manager_notes: [] }]) }] }; },
  usageFor: function () { return async function (params) { captured.push(params.messages[0].content); return { content: [{ text: '{}' }] }; }; },
  setUsageRecorder: function () {},
});
const W = require('../lib/analysis-worker');
const { warmWhenDrained } = require('../lib/warm-after-drain');
const D = require('../lib/doctrine');
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
const PROFILE = { user_id: 'mgr', role: 'manager', managed_by: null, offer: 'Team offer: the blueprint, long enough to count as material', qualifications: 'TEAM QUALIFICATIONS: 10k saved', niche: 'x', script_raw: null };
function fake(analyses, writes) {
  return { from(table) {
    const ch = { f: {}, _op: 'select', _p: null, select() { return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, lt() { return ch; }, gte() { return ch; }, in() { return ch; }, is() { return ch; }, not() { return ch; }, order() { return ch; }, limit() { return ch; },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles' ? (ch.f.user_id === 'rep' ? { user_id: 'rep', managed_by: 'mgr' } : Object.assign({}, PROFILE)) : (table === 'fathom_calls' ? { call_date: '2026-09-05T10:00:00Z' } : null), error: null }); },
      then(res, rej) {
        if (ch._op === 'update') { writes.push({ table, patch: ch._p, f: ch.f }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let rows = [];
        if (table === 'call_analyses') rows = analyses.filter((a) => Object.keys(ch.f).every((k) => a[k] === ch.f[k]));
        else if (table === 'call_highlights') rows = [{ id: 'h1', fathom_call_id: 'c1', type: 'objection', objection_category: 'fear', objection_class: 'true_objection', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', timestamp_seconds: 900, quote: 'I need to think', observation: 'o', closer_response: 'ok', closer_response_verified: true }];
        else if (table === 'user_profiles') rows = [PROFILE, { user_id: 'rep', managed_by: 'mgr' }];
        else if (table === 'knowledge_base' && ch.f.category === 'doctrine') rows = DOCTRINE_ROWS;
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  } };
}
test('⚠⚠ a pending row gets the pass again and is marked with the result; NULL rows are never selected', async () => {
  captured.length = 0; const writes = [];
  const admin = fake([{ fathom_call_id: 'c1', user_id: 'rep', status: 'done', coaching_status: 'pending', outcome: 'lost', why_outcome: null, objection_notes: null, analyzed_at: '2026-09-05T09:00:00Z' },
                      { fathom_call_id: 'c0', user_id: 'rep', status: 'done', coaching_status: null, outcome: 'lost', analyzed_at: '2026-09-01T09:00:00Z' }], writes);
  const out = await W.retryPendingCoaching(admin, { now: Date.parse('2026-09-05T12:00:00Z') });
  assert.deepStrictEqual({ found: out.found, retried: out.retried }, { found: 1, retried: 1 }, JSON.stringify(out));
  assert.strictEqual(captured.length, 1, 'one coaching call, for the pending row only');
  const mark = writes.find((w) => w.table === 'call_analyses' && w.f.fathom_call_id === 'c1');
  assert.ok(mark && /^written:1$/.test(mark.patch.coaching_status), 'marked with the result: ' + JSON.stringify(mark));
  assert.ok(!writes.some((w) => w.table === 'call_analyses' && w.f.fathom_call_id === 'c0'), 'the NULL row is untouched');
});
test('⚠ the sweep rides the post-drain warm-up and steps aside while a claim is live', async () => {
  let ran = 0; const retry = async () => { ran++; return { found: 0, retried: 0 }; };
  const idle = { from(table) { const ch = { select() { return ch; }, eq() { return ch; }, gte() { return ch; }, limit() { return ch; }, then(res) { return Promise.resolve({ data: table === 'call_analyses' ? [] : [], error: null }).then(res); } }; return ch; } };
  const out = await warmWhenDrained(idle, { retryCoaching: retry, warm: async () => ({ ok: true }), now: Date.now(), staleMs: 1000 });
  assert.strictEqual(ran, 1, 'the sweep ran when no claim was live'); assert.deepStrictEqual(out.coaching_retry, { found: 0, retried: 0 });
  const busy = { from(table) { const ch = { select() { return ch; }, eq() { return ch; }, gte() { return ch; }, limit() { return ch; }, then(res) { return Promise.resolve({ data: table === 'call_analyses' ? [{ id: 'x' }] : [], error: null }).then(res); } }; return ch; } };
  const out2 = await warmWhenDrained(busy, { retryCoaching: retry, warm: async () => ({ ok: true }), now: Date.now(), staleMs: 1000 });
  assert.strictEqual(out2.skipped, 'draining'); assert.strictEqual(ran, 1, 'not while a claim is live');
});
