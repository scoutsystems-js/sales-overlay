'use strict';
/* ⚠⚠ THE CLOSING-RATE COUNTDOWN. lib/prospect-entity.js fetched a team's prospect-attached
   calls with one unpaged `.in('user_id', team)` — PostgREST returns 1,000 and stops
   SILENTLY. The Sober Living team stood at 947 in its 90-day window on 2026-09-02,
   growing 20.7 a day: from about 5 September the team closing rate would have been
   computed on a truncated set with no error — a wrong number rendered as a right one,
   on the metric Justin rules from. The prospects read beside it (886, +36 a day) was
   a day behind. Both now page with .range inside the request (fix #6's shape).
   This pin executes GET /team/overview as a manager against a range-aware fake that
   serves 1,050 prospect-attached calls in TRUE 1,000-row pages, and asserts the rep's
   prospect total is 1,050 with consecutive pages and `truncated: false`. It FAILED on
   the unpaged code (1,000 arrived) — proven, not assumed. Both plants fail it. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); }, requireSubscription: function (_req, _res, next) { next(); } });

const N = 1050, PAGE = 1000, WIRE_CAP = 1000;
const CALLS = []; for (let i = 0; i < N; i++) CALLS.push({ id: 'c' + i, user_id: 'A', fathom_call_id: 'real-' + i, prospect_id: 'p' + i, call_date: '2026-08-10T10:00:00Z', duration_seconds: 1800, not_a_sales_call: null, duplicate_of: null });
const ANALYSES = CALLS.map((c, i) => ({ fathom_call_id: c.id, status: 'done', outcome: i % 10 === 0 ? 'closed' : 'lost', analyzed_at: '2026-08-10T11:00:00Z', overall_score: 60, cash_collected: 0 }));
const PROSPECTS = CALLS.map((c) => ({ id: c.prospect_id, user_id: 'A', merged_into: null }));
const PROFILES = [{ user_id: 'A', managed_by: 'mgr', role: 'user', active: true, first_name: 'Ava', team_name: null }, { user_id: 'mgr', managed_by: null, role: 'manager', active: true, first_name: 'Mia', team_name: 'Team' }];
const RANGES = { fathom_calls: [], prospects: [] };
function fakeAdmin() {
  return {
    auth: { admin: { listUsers: async function () { return { data: { users: [{ id: 'A', email: 'ava@x.io' }, { id: 'mgr', email: 'mia@x.io' }] }, error: null }; } } },
    from(table) {
      const chain = { _range: null, _in: null, _eq: {},
        select() { return chain; }, eq(c, v) { chain._eq[c] = v; return chain; }, in(c, v) { chain._in = [c, v]; return chain; }, not() { return chain; }, is() { return chain; }, gte() { return chain; }, lte() { return chain; }, lt() { return chain; }, gt() { return chain; }, or() { return chain; }, order() { return chain; }, limit() { return chain; },
        range(a, b) { chain._range = [a, b]; if (RANGES[table]) RANGES[table].push([a, b]); return chain; },
        maybeSingle() { if (table === 'user_profiles') return Promise.resolve({ data: PROFILES.find((p) => p.user_id === chain._eq.user_id) || null, error: null }); return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          let rows = [];
          if (table === 'user_profiles') rows = PROFILES.slice();
          else if (table === 'fathom_calls') rows = CALLS.slice();
          else if (table === 'call_analyses') rows = chain._in && chain._in[0] === 'fathom_call_id' ? ANALYSES.filter((a) => chain._in[1].indexOf(a.fathom_call_id) !== -1) : [];
          else if (table === 'prospects') rows = PROSPECTS.slice();
          if (chain._eq.status) rows = rows.filter((r) => r.status === undefined || r.status === chain._eq.status);
          /* the wire: a ranged read returns that slice; an unranged read returns the first 1,000 and stops, silently */
          if (chain._range) rows = rows.slice(chain._range[0], Math.min(chain._range[1] + 1, chain._range[0] + PAGE));
          else rows = rows.slice(0, WIRE_CAP);
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}
const sbPath = require.resolve('@supabase/supabase-js');
const realSb = require(sbPath);
require.cache[sbPath].exports = Object.assign({}, realSb, { createClient: function () { return fakeAdmin(); } });
const teamRoutes = require('../routes/team');
function app() { const a = express(); a.use(function (req, _res, next) { req.user = { id: 'mgr', role: 'manager' }; req.userProfileRole = 'manager'; next(); }); a.use('/team', teamRoutes); return a; }
function get(path) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app()).listen(0, function () {
      http.get({ port: server.address().port, path }, function (res) { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', function () { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); }).on('error', function (e) { server.close(); reject(e); });
    });
  });
}
test('⚠⚠ 1,050 prospect-attached calls → the rep\'s closing rate counts all 1,050 prospects, read in consecutive 1,000-row pages, and the payload says it is complete', async () => {
  RANGES.fathom_calls.length = 0; RANGES.prospects.length = 0;
  const r = await get('/team/overview?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const rep = (r.body.per_rep || []).find((x) => x.user_id === 'A');
  assert.ok(rep, 'the rep row must exist: ' + JSON.stringify(r.body).slice(0, 200));
  assert.strictEqual(rep.prospect_close_total, N, '1,000 is the wire\'s silent cap, not the team\'s prospects');
  assert.strictEqual(rep.prospect_close_wins, N / 10);
  assert.ok(r.body.prospect_reads && r.body.prospect_reads.truncated === false, 'the payload must say the prospect reads were complete: ' + JSON.stringify(r.body.prospect_reads));
  const calls = RANGES.fathom_calls.filter((rg) => rg[1] - rg[0] + 1 === PAGE || rg[0] > 0);
  assert.ok(calls.length >= 2, 'the prospect calls read must page: ranges ' + JSON.stringify(RANGES.fathom_calls));
  /* ⚠ RE-PINNED 2026-09-03 (H704): the overview now reads the prospect rates for TWO
     windows at once (current + prior, for the rep-card arrows), so two readers' pages
     interleave. The PROPERTY is that every reader pages consecutively to the end —
     each page start appears once per reader and the starts run 0, 1000, … past N.
     The old form pinned "exactly one reader", an implementation. */
  const starts = RANGES.prospects.map((rg) => rg[0]);
  const readers = starts.filter((x) => x === 0).length;
  const distinct = [...new Set(starts)].sort((a, b) => a - b);
  assert.ok(readers >= 1 && distinct.length >= 2, 'the prospects read must page: ' + JSON.stringify(RANGES.prospects));
  distinct.forEach((st, i) => {
    assert.strictEqual(st, i * PAGE, 'pages must be consecutive: ' + JSON.stringify(distinct));
    assert.strictEqual(starts.filter((x) => x === st).length, readers, 'every reader must reach page ' + i + ': ' + JSON.stringify(RANGES.prospects));
  });
  assert.ok(distinct[distinct.length - 1] + PAGE >= N, 'the last page must reach past N');
});
