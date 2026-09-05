/**
 * THE PERFORMANCE SUMMARY IS EXECUTED END TO END (H731) — because a dangling identifier in it reached
 * production as a 500 while the suite was green: nothing executed the lane. The model seam is stubbed
 * before the lane loads; a generic fake wire serves calls, analyses, highlights and the cache. With no
 * material the lane returns the one empty shape and never calls the model; with material the prompt
 * carries the team's qualifications.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const muPath = require.resolve('../lib/model-usage');
const realMu = require(muPath);
const captured = [];
require.cache[muPath].exports = Object.assign({}, realMu, {
  usageFor: function () { return async function (params) { captured.push(params.messages[0].content); return { content: [{ text: JSON.stringify({ working: [{ claim: 'Strong on the pitch.', data: 'Pitch 64.', evidence_id: 'm1', subject: { kind: 'strong_moment' } }], improve: [] }) }] }; }; },
  createWithUsage: async function (params) { captured.push(params.messages[0].content); return { content: [{ text: '{}' }] }; },
  setUsageRecorder: function () {},
});
const { computePerformanceSynthesis } = require('../lib/performance-synthesis');

const P = {
  head: { user_id: 'head', managed_by: null, niche: 'Sober living', offer: 'Done-for-you market research and the blueprint, long enough', qualifications: 'HEAD QUALIFICATIONS: 10k saved, not living paycheck to paycheck', script_raw: null },
  rep:  { user_id: 'rep', managed_by: 'head', niche: null, offer: null, qualifications: null, script_raw: null },
  solo: { user_id: 'solo', managed_by: null, niche: null, offer: null, qualifications: null, script_raw: null },
};
function world(userId) {
  const calls = [{ id: 'c1', fathom_call_id: 'x1', user_id: userId, call_date: '2026-09-01T10:00:00Z', recording_url: null, source: 'fathom', not_a_sales_call: null, duplicate_of: null }];
  const analyses = [{ fathom_call_id: 'c1', analyzed_at: '2026-09-01T11:00:00Z', status: 'done', outcome: 'closed', overall_score: 70, intro_score: 60, discovery_score: 62, pitch_score: 64, objection_score: 55, close_score: 58, one_thing: 'Ask for the sale earlier.' }];
  const highlights = [{ id: 'h1', fathom_call_id: 'c1', timestamp_seconds: 100, quote: 'We will take it', closer_response: 'Great, let us get you set up', closer_response_verified: true, type: 'strong_moment', objection_category: null, section: 'close', speaker: 'CLOSER', speaker_verified: true, resolution: null, handling: null, cause: null }];
  const upserts = [];
  const admin = { from(table) {
    const ch = { f: {}, _in: null, _op: 'select', select() { return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in(k, v) { ch._in = [k, v]; return ch; }, is() { return ch; }, not() { return ch; }, order() { return ch; }, limit() { return ch; }, gte() { return ch; }, lte() { return ch; }, range() { return ch; },
      upsert(p) { upserts.push(p); ch._op = 'upsert'; return ch; },
      maybeSingle() { return ch.then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res, rej) {
        if (ch._op === 'upsert') return Promise.resolve({ data: null, error: null }).then(res, rej);
        let rows = [];
        const filt = (list) => list.filter((r) => Object.keys(ch.f).every((k) => k.indexOf('->>') !== -1 || r[k] === ch.f[k]) && (!ch._in || ch._in[0].indexOf('->>') !== -1 || ch._in[1].indexOf(r[ch._in[0]]) !== -1));
        if (table === 'user_profiles') rows = filt(Object.values(P));
        else if (table === 'fathom_calls') rows = filt(calls);
        else if (table === 'call_analyses') rows = filt(analyses);
        else if (table === 'call_highlights') rows = filt(highlights);
        else if (table === 'objection_synthesis_cache' || table === 'knowledge_base') rows = [];
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      } };
    return ch;
  } };
  return { admin, upserts };
}

test('⚠⚠ with nothing on file the lane returns the one empty shape, calls no model and writes no cache', async () => {
  captured.length = 0; const w = world('solo');
  const out = await computePerformanceSynthesis(w.admin, 'solo', '2026-08-01T00:00:00Z', '2026-09-30T00:00:00Z');
  assert.strictEqual(out.available, true); assert.strictEqual(out.no_material, true); assert.deepStrictEqual(out.working, []);
  assert.strictEqual(captured.length, 0, 'no model call'); assert.strictEqual(w.upserts.length, 0, 'no cache row');
});

test('⚠⚠ with material inherited from the head, the prompt carries the qualifications and the lane runs to a result', async () => {
  captured.length = 0; const w = world('rep');
  const out = await computePerformanceSynthesis(w.admin, 'rep', '2026-08-01T00:00:00Z', '2026-09-30T00:00:00Z');
  assert.strictEqual(captured.length, 1, 'one model call: ' + JSON.stringify(out).slice(0, 200));
  assert.ok(/HEAD QUALIFICATIONS: 10k saved/.test(captured[0]), 'the knowledge base is in the prompt');
  assert.strictEqual(out.available, true); assert.ok(!out.no_material);
  assert.strictEqual(out.working.length, 1);
});
