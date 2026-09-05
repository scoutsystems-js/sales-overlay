/**
 * H738 — THE CLOSER'S OWN PAGES CANNOT BREAK SILENTLY: every route a signed-in closer's pages request on load is EXECUTED
 * here — the handler invoked on a fake wire, a 200 asserted, a body with the shape the page reads — with the Supabase
 * package stubbed at the module edge (the route modules build their own client) and the model seam stubbed. The
 * enumeration behind the list is in H738. A guard here is kept only after its plant (a require removed from the route's
 * module) made it fail.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
const muPath = require.resolve('../lib/model-usage'); const realMu = require(muPath);
let reply = () => '{}';
require.cache[muPath].exports = Object.assign({}, realMu, {
  createWithUsage: async function () { return { content: [{ text: reply() }] }; },
  usageFor: function () { return async function () { return { content: [{ text: reply() }] }; }; },
  setUsageRecorder: function () {},
});
const D = require('../lib/doctrine');
const DOCTRINE_ROWS = D.doctrineRows(D.readDoctrineFile()).map((r, i) => Object.assign({ id: 'doc' + i }, r));
const REP = { user_id: 'rep', role: 'user', managed_by: 'mgr', first_name: 'Ava', last_name: 'Reyes', offer_price: 9800, active: true };
const MGR = { user_id: 'mgr', role: 'manager', managed_by: null, first_name: 'Mia', last_name: 'M', offer: 'Team offer: the blueprint, long enough to count as material', qualifications: 'TEAM QUALIFICATIONS: 10k saved', niche: 'x', script_raw: null, team_name: 'SLR', active: true };
const ROWS = {
  user_profiles: [REP, MGR],
  fathom_calls: [{ id: 'c1', fathom_call_id: 'c1', user_id: 'rep', title: 'AF | Someone', call_date: '2026-08-20T10:00:00Z', recording_url: 'https://fathom.video/x', not_a_sales_call: false, duplicate_of: null, duration_seconds: 2400, source: 'fathom', created_at: '2026-08-20T11:00:00Z', calendar_invitees: null, call_kind: null, call_kind_marked_by: null, prospect_id: null }],
  call_analyses: [{ id: 'a1', fathom_call_id: 'c1', user_id: 'rep', status: 'done', outcome: 'lost', outcome_source: 'analysis', overall_score: 60, intro_score: 60, discovery_score: 60, pitch_score: 60, objection_score: 60, close_score: 60, close_score_earned: 60, one_thing: 'x', why_outcome: 'y', why_timestamp_seconds: 100, analyzed_at: '2026-08-20T11:00:00Z', prospect_name: 'P', prompt_version: 'v47-2026-09-05', overall_summary: 's', intro_notes: 'n', discovery_notes: 'n', pitch_notes: 'n', objection_notes: 'n', close_notes: 'n', coverage: null, qualification_check: null, transcript_stored: true, cash_collected: null, payment_structure: null, eod_summary: null, coaching_status: 'written:1', highlight_error: null, sales_call_verdict: null }],
  call_highlights: [{ id: 'h1', fathom_call_id: 'c1', user_id: 'rep', type: 'objection', objection_category: 'fear', objection_class: 'true_objection', resolution: 'unhandled', section: 'close', speaker: 'PROSPECT', speaker_verified: true, timestamp_seconds: 900, quote: 'I need to think about it', observation: 'o', closer_response: 'ok', closer_response_verified: true, handling: null, cause: null, coaching: 'Isolate first.', sequence_order: 1, bar_reason: 'unhandled' }],
  fathom_connections: [{ user_id: 'rep', access_token: 't', refresh_token: 'r', last_sync_at: '2026-09-05T00:00:00Z', fathom_user_email: 'ava@x', recorded_by_email: 'ava@x' }],
  call_connections: [], eod_edits: [], prospects: [], knowledge_base: DOCTRINE_ROWS, coaching_history: [], objection_synthesis_cache: [], prospect_renames: [], analysis_runs: [],
};
function proxyAdmin() {
  const build = (table, f) => { f = f || {}; const rows = () => (table === 'knowledge_base') ? (f.category === 'doctrine' ? DOCTRINE_ROWS : []) : (ROWS[table] || []).filter((r) => Object.keys(f).every((k) => !(k in r) || r[k] === f[k]));
    const target = {
      maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
      single: () => Promise.resolve({ data: rows()[0] || null, error: null }),
      eq: (k, v) => build(table, Object.assign({}, f, { [k]: v })),
      then: (res, rej) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(res, rej) };
    return new Proxy(target, { get(t, prop) { if (prop in t) return t[prop]; if (typeof prop === 'symbol') return undefined; return () => build(table, f); } }); };
  return { from: build, rpc: async () => ({ data: [], error: null }), auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'rep', email: 'ava@x' }, { id: 'mgr', email: 'm@x' }] } }), getUserById: async () => ({ data: { user: { id: 'rep', email: 'ava@x' } }, error: null }) }, getUser: async () => ({ data: { user: { id: 'rep', email: 'ava@x' } }, error: null }) } };
}
/* the Supabase package stubbed at the module edge: every route module that builds its own client gets the fake */
const sbPath = require.resolve('@supabase/supabase-js'); const savedSb = require.cache[sbPath];
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { createClient: () => proxyAdmin() } };
['../routes/auth', '../routes/fathom', '../routes/eod', '../routes/kb', '../routes/me', '../routes/zoom', '../lib/email-map'].forEach((m) => { try { delete require.cache[require.resolve(m)]; } catch (e) {} });
const R = { auth: require('../routes/auth'), fathom: require('../routes/fathom'), eod: require('../routes/eod'), kb: require('../routes/kb'), me: require('../routes/me'), zoom: require('../routes/zoom') };
if (R.kb._setAdminClientForTests) R.kb._setAdminClientForTests(() => proxyAdmin());
if (R.me._setAdminClientForTests) R.me._setAdminClientForTests(() => proxyAdmin());
function call(router, method, path, req) {
  const l = router.stack.find((x) => x.route && x.route.path === path && x.route.methods[method]);
  if (!l) return Promise.resolve({ code: 'no-route', body: path });
  const handler = l.route.stack[l.route.stack.length - 1].handle;
  return new Promise((resolve) => { const res = { code: 200, _h: {}, status(c) { this.code = c; return this; }, set() { return this; }, setHeader() { return this; }, json(b) { resolve({ code: this.code, body: b }); }, send(b) { resolve({ code: this.code, body: b }); }, end() { resolve({ code: this.code, body: null }); } };
    Promise.resolve().then(() => handler(Object.assign({ user: { id: 'rep', email: 'ava@x' }, query: {}, params: {}, body: {}, headers: {}, get() { return ''; } }, req || {}), res, (e) => resolve({ code: 'next', body: String(e) }))).catch((e) => resolve({ code: 'threw', body: String(e && e.stack) })); });
}
const Q = { from: '2026-08-07T00:00:00Z', to: '2026-09-05T23:59:59Z' };
/* what the closer's pages request on load — the enumeration of H738, top tier */
const PAGES = [
  ['auth', 'get', '/me', {}, (b) => 'user_id' in b && 'role' in b, 'Sign-in: who am I, my role'],
  ['fathom', 'get', '/calls', { query: {} }, (b) => Array.isArray(b.calls), 'The Calls page list'],
  ['fathom', 'get', '/calls/:id', { params: { id: 'c1' } }, (b) => b && (b.call || b.analysis || b.highlights || b.id), 'Call Review'],
  ['fathom', 'get', '/status', {}, (b) => 'connected' in b || 'calls_count' in b || 'status' in b, 'Connections: is Fathom connected, what is graded'],
  ['zoom', 'get', '/status', {}, (b) => typeof b === 'object', 'Connections: Zoom'],
  ['me', 'get', '/analytics2', { query: Q }, (b) => typeof b === 'object' && !b.error, 'Coaching Dashboard: the tiles'],
  ['me', 'get', '/needs-work', { query: Q }, (b) => typeof b === 'object' && !b.error, 'Coaching Dashboard: what needs work'],
  ['me', 'get', '/needs-work-sections', { query: Q }, (b) => typeof b === 'object' && !b.error, 'Coaching Dashboard: the section ranking'],
  ['me', 'get', '/sections/:section', { params: { section: 'objection' }, query: Q }, (b) => typeof b === 'object' && !b.error, 'Coaching Dashboard: a section drill-down'],
  ['me', 'get', '/objections-intel', { query: Q }, (b) => typeof b === 'object' && !b.error, 'Objections page: the grid'],
  ['me', 'get', '/objections-synthesis', { query: Q }, (b) => typeof b === 'object' && !b.error, 'Objections page: isolate / reframe / overcome'],
  ['me', 'get', '/performance-synthesis', { query: Q }, (b) => typeof b === 'object' && !b.error, 'Coaching Dashboard: the performance summary'],
  ['me', 'get', '/grading-backlog', {}, (b) => typeof b === 'object' && !b.error, 'Calls page: how many are not graded yet'],
  ['me', 'get', '/account', {}, (b) => typeof b === 'object' && !b.error, 'My Account'],
  ['eod', 'get', '/', { query: { date: '2026-08-20' } }, (b) => Array.isArray(b.calls), 'EOD Report'],
  ['kb', 'get', '/list', {}, (b) => typeof b === 'object' && !b.error, 'Knowledge Base: the list'],
  ['kb', 'get', '/counter', {}, (b) => typeof b === 'object' && !b.error, 'Knowledge Base: the counter'],
];
const DEBUG = !!process.env.PAGES_DEBUG;
for (const [mod, method, path, req, ok, what] of PAGES) {
  test('⚠⚠ ' + what + ' — ' + method.toUpperCase() + ' ' + path + ' answers 200 with its body', async () => {
    reply = () => JSON.stringify({ working: [], improve: [], categories: [], summary: 's', focus: 'f', notable: [], closers: [] });
    const r = await call(R[mod], method, path, req);
    if (DEBUG) console.log(method.toUpperCase(), path, r.code, JSON.stringify(r.body).slice(0, 220));
    assert.strictEqual(r.code, 200, what + ': ' + JSON.stringify(r.body).slice(0, 400));
    assert.ok(ok(r.body), what + ': the body the page reads is missing: ' + JSON.stringify(r.body).slice(0, 200));
  });
}
test.after(() => { if (savedSb) require.cache[sbPath] = savedSb; else delete require.cache[sbPath]; });
