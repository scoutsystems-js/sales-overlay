/**
 * THE COACHING PASS CHECKS THE KNOWLEDGE BASE BEFORE IT SPEAKS (H731) — EXECUTED. The model seam is stubbed
 * BEFORE the worker loads, so the real coachCallMoments runs against a fake wire and the prompt it would send
 * is captured. The consequence asserted: the prompt CONTAINS the team's qualifications (a plant that removes
 * the retrieval, or keeps it and drops its answer, fails here); with no material the model is NEVER called
 * and nothing is written; a rep of team A never sees team B's material.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const muPath = require.resolve('../lib/model-usage');
const realMu = require(muPath);
const captured = [];
require.cache[muPath].exports = Object.assign({}, realMu, {
  createWithUsage: async function (params) { captured.push(params.messages[0].content); return { content: [{ text: JSON.stringify([{ moment: 1, coaching: 'Isolate the money objection before answering it.', applied_manager_notes: [] }]) }] }; },
  usageFor: function () { return async function (params) { captured.push(params.messages[0].content); return { content: [{ text: '{}' }] }; }; },
  setUsageRecorder: function () {},
});
const W = require('../lib/analysis-worker');

const P = {
  headA: { user_id: 'headA', managed_by: null, niche: 'Sober living', offer: 'Team A offer: done-for-you market research and the blueprint', qualifications: 'TEAM A QUALIFICATIONS: 10k saved, not living paycheck to paycheck', script_raw: null },
  repA:  { user_id: 'repA',  managed_by: 'headA', niche: null, offer: null, qualifications: null, script_raw: null },
  headB: { user_id: 'headB', managed_by: null, niche: 'Roofing', offer: 'Team B offer: roofing leads programme, long enough to count', qualifications: 'TEAM B QUALIFICATIONS: owns a truck', script_raw: null },
  solo:  { user_id: 'solo',  managed_by: null, niche: null, offer: null, qualifications: null, script_raw: null },
};
const MOMENT = { id: 'h1', fathom_call_id: 'c1', type: 'objection', resolution: 'unhandled', section: 'close', timestamp_seconds: 1200, quote: 'I need to think about it', observation: 'o', closer_response: 'Sure, take your time', closer_response_verified: true };
function fakeAdmin(writes) {
  return { from(table) {
    const ch = { f: {}, _in: null, _op: 'select', _p: null, select() { return ch; }, update(p) { ch._op = 'update'; ch._p = p; return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, is() { return ch; }, not() { return ch; }, order() { return ch; }, limit() { return ch; },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles' ? (P[ch.f.user_id] ? Object.assign({}, P[ch.f.user_id]) : null) : null, error: null }); },
      then(res, rej) {
        if (ch._op === 'update') { writes.push({ table, patch: ch._p, f: ch.f }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let rows = [];
        if (table === 'call_highlights') rows = [Object.assign({}, MOMENT, { fathom_call_id: ch.f.fathom_call_id || 'c1' })];
        else if (table === 'user_profiles') rows = Object.values(P).filter((r) => Object.keys(ch.f).every((k) => r[k] === ch.f[k]));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  } };
}

test('⚠⚠ with team material the coaching prompt CARRIES the team\'s qualifications, and the coaching is written', async () => {
  captured.length = 0; const writes = [];
  const out = await W._coachCallMoments(fakeAdmin(writes), 'c1', 'lost', null, null, 'repA');
  assert.strictEqual(captured.length, 1, 'one model call');
  assert.ok(/TEAM A QUALIFICATIONS: 10k saved/.test(captured[0]), 'the knowledge base is IN the prompt, before the advice');
  assert.ok(/TEAM MATERIAL/.test(captured[0]));
  assert.ok(!/TEAM B/.test(captured[0]), 'team B\'s material never reaches team A\'s lane');
  assert.ok(writes.length >= 1 && writes.some((w) => w.table === 'call_highlights' && /Isolate the money objection/.test(String(w.patch.coaching))), 'the coaching was written: ' + JSON.stringify(writes).slice(0, 200));
  assert.ok(out && out.written >= 1, JSON.stringify(out));
});

test('⚠⚠ with NOTHING on file the model is never called and nothing is written — the lane says nothing', async () => {
  captured.length = 0; const writes = [];
  const out = await W._coachCallMoments(fakeAdmin(writes), 'c1', 'lost', null, null, 'solo');
  assert.strictEqual(captured.length, 0, 'no model call'); assert.strictEqual(writes.length, 0, 'nothing written');
  assert.strictEqual(out.skipped, 'no_material');
});
