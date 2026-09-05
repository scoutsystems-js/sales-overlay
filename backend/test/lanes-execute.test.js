/**
 * H737 — EVERY ADVICE LANE IS EXECUTED END TO END, and the recommendations ROUTE answers 200 with a body.
 * The seam is stubbed before the modules load; a Proxy fake answers every table with material and a call. The
 * assertion is on the CONSEQUENCE: a body with the lane's shape, never a ReferenceError — the class that put
 * "HTTP 500" on the Coaching Dashboard for seven hours (loadKbMaterial called without a require) and that
 * `node -c`, a green suite and the function's existence could not see.
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
const D = require('../lib/doctrine');
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
const PROFILE = { user_id: 'mgr', role: 'manager', managed_by: null, niche: 'x', offer: 'Team offer: the blueprint, long enough to count as material', qualifications: 'TEAM QUALIFICATIONS: 10k saved', script_raw: null, team_name: 'SLR', first_name: 'Mia', last_name: 'M' };
const ROWS = {
  user_profiles: [PROFILE, { user_id: 'rep', role: 'user', managed_by: 'mgr', first_name: 'Ava', last_name: 'R' }],
  fathom_calls: [{ id: 'c1', fathom_call_id: 'c1', user_id: 'rep', title: 'T', call_date: '2026-08-20T10:00:00Z', recording_url: null, not_a_sales_call: false, duplicate_of: null, duration_seconds: 2400, source: 'fathom' }],
  call_analyses: [{ fathom_call_id: 'c1', user_id: 'rep', status: 'done', outcome: 'lost', overall_score: 60, intro_score: 60, discovery_score: 60, pitch_score: 60, objection_score: 60, close_score: 60, one_thing: 'x', why_outcome: 'y', analyzed_at: '2026-08-20T11:00:00Z', prospect_name: 'P' }],
  call_highlights: [{ id: 'h1', fathom_call_id: 'c1', type: 'objection', objection_category: 'fear', objection_class: 'true_objection', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', speaker_verified: true, timestamp_seconds: 900, quote: 'I need to think about it', observation: 'o', closer_response: 'ok', closer_response_verified: true, handling: null, cause: null }],
  knowledge_base: DOCTRINE_ROWS,
};
function proxyAdmin() {
  const build = (table) => { const target = {
    maybeSingle: () => Promise.resolve({ data: table === 'user_profiles' ? Object.assign({}, PROFILE) : null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: (table === 'knowledge_base') ? DOCTRINE_ROWS : (ROWS[table] || []), error: null, count: (ROWS[table] || []).length }).then(res, rej) };
    return new Proxy(target, { get(t, prop) { if (prop in t) return t[prop]; if (typeof prop === 'symbol') return undefined; return () => build(table); } }); };
  return { from: build, rpc: async () => ({ data: [], error: null }), auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'rep', email: 'ava@x' }, { id: 'mgr', email: 'm@x' }] } }) } } };
}
function notABug(e, lane) { assert.ok(!(e instanceof ReferenceError) && !(e instanceof TypeError) && !/is not defined|is not a function/.test(String(e && e.message)), lane + ' threw a programmer error: ' + (e && e.stack || e)); }

test('⚠⚠ the recommendations ROUTE answers 200 with a body (the live 500 of 2026-09-05)', async () => {
  reply = () => JSON.stringify({ working: [{ claim: 'The team isolates first.', data: 'd', evidence_id: 'm1', subject: { kind: 'objection', category: 'fear', section: 'close' } }], improve: [] });
  const team = require('../routes/team'); team._setAdminClientForTests(() => proxyAdmin());
  const l = team.stack.find((x) => x.route && x.route.path === '/recommendations');
  const handler = l.route.stack[l.route.stack.length - 1].handle;
  const r = await new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; Promise.resolve().then(() => handler({ user: { id: 'mgr', email: 'm@x' }, query: { from: '2026-08-07T00:00:00Z', to: '2026-09-05T23:59:59Z' } }, res)).catch((e) => resolve({ code: 'threw', body: String(e && e.stack) })); });
  assert.strictEqual(r.code, 200, 'the route must answer 200: ' + JSON.stringify(r.body).slice(0, 400));
  assert.ok(r.body && (r.body.available === true || r.body.no_material === true) && ('working' in r.body || r.body.no_material), 'a body with the lane\'s shape: ' + JSON.stringify(r.body).slice(0, 200));
});
test('⚠⚠ every advice lane EXECUTES on a fake wire without a programmer error', async () => {
  const admin = proxyAdmin();
  const lanes = [
    ['team-synthesis', () => { reply = () => JSON.stringify({ working: [], improve: [] }); return require('../lib/team-synthesis').computeTeamRecommendations(admin, 'mgr', ['mgr', 'rep'], '2026-08-07T00:00:00Z', '2026-09-05T00:00:00Z', {}, {}); }],
    ['performance-synthesis', () => { reply = () => JSON.stringify({ working: [], improve: [] }); return require('../lib/performance-synthesis').computePerformanceSynthesis(admin, 'rep', '2026-08-07T00:00:00Z', '2026-09-05T00:00:00Z'); }],
    ['team-objection-summary', () => { reply = () => JSON.stringify({ closers: [] }); return require('../lib/team-objection-summary').computeTeamObjectionSummary(admin, ['mgr', 'rep'], '2026-08-07T00:00:00Z', '2026-09-05T00:00:00Z', { keyId: 'mgr', emailMap: {}, nameMap: {} }); }],
    ['team-digest', () => { reply = () => JSON.stringify({ summary: 's', focus: 'f', notable: [] }); return require('../lib/team-digest').computeDailyDigest(admin, 'mgr', ['rep'], '2026-08-20', {}, {}); }],
    ['objection-synthesis', () => { reply = () => JSON.stringify({ categories: [] }); return require('../lib/objection-synthesis').computeObjectionSynthesis(admin, 'rep', '2026-08-07T00:00:00Z', '2026-09-05T00:00:00Z'); }],
    ['coaching pass', () => { reply = () => JSON.stringify([{ moment: 1, coaching: 'Isolate first.', applied_manager_notes: [] }]); return require('../lib/analysis-worker')._coachCallMoments(admin, 'c1', 'lost', null, null, 'rep'); }],
  ];
  for (const [name, run] of lanes) {
    let out; try { out = await run(); } catch (e) { notABug(e, name); continue; }
    assert.ok(out && typeof out === 'object', name + ' returned a body');
    if (out.reason) assert.ok(!/is not defined|is not a function/.test(out.reason), name + ' reported a programmer error as a reason: ' + out.reason);
  }
});
test('⚠ the failure copy is written for the reader: no status code, what happened and what to do', () => {
  const fs = require('fs'); const path = require('path'); const { stripComments, fnBody } = require('./helpers/strip-comments');
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const copy = new Function(fnBody(LIVE, 'laneFailureCopy') + '\n return laneFailureCopy("the recommendations");')();
  assert.ok(/could not load the recommendations just now/.test(copy) && /try again in a minute/.test(copy) && /tell your admin/.test(copy), copy);
  assert.ok(!/HTTP|\b\d{3}\b|error/i.test(copy), 'no status code, no mechanism: ' + copy);
  assert.ok(/laneProblemHtml\('the recommendations', 'error'\)/.test(fnBody(LIVE, 'teamRecsHtml')), 'the recommendations panel draws the shared sentence');
  assert.ok(!/Could not load recommendations: /.test(LIVE), 'the raw-error render is gone');
});
test('⚠ RATCHET: no lane renders a raw error string to a customer — every failure goes through laneFailureCopy', () => {
  const fs = require('fs'); const path = require('path'); const { stripComments } = require('./helpers/strip-comments');
  const LIVE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
  const raw = (LIVE.match(/Could not load[^']*: ' \+ escapeHtml\([a-z]\._error\)/g) || []);
  assert.deepStrictEqual(raw, [], 'raw error renders: ' + raw.join(' | '));
  assert.ok((LIVE.match(/laneFailureCopy\(/g) || []).length >= 13, 'the shared sentence is what every lane draws');
});
