'use strict';
/* ⚠⚠ FIX #3 — THE COACHING SECTION DRILL-DOWN MUST ANSWER WHEN A REP HAS MORE
   THAN ~395 CALLS IN THE WINDOW. The ceiling is NOT the 1,000-row cap: an
   unchunked `.in('fathom_call_id', ids)` carries every id in the URL and the
   request DIES above ~395 ids — measured 2026-09-02, 390 succeed, 400 `fetch
   failed` after ~8 s with no PostgREST error (H663). The owner was at 390 at
   90 days with ~5 calls a day. The failure is a dead request, not a shorter
   list, so this pin asserts a RESPONSE. The fake client below refuses any
   `.in()` longer than 395 ids exactly the way the wire does; the route is
   executed with a forged actor and 401 calls in the window. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); } });

const URL_CEILING = 395;                                   // measured, not the 1,000-row cap
const N_CALLS = 401;
const CALLS = []; for (let i = 0; i < N_CALLS; i++) CALLS.push({ id: 'c' + i, title: 'Call ' + i, call_date: '2026-08-10T10:00:00Z', recording_url: null, prospect_id: null, source: 'fathom' });
const ANALYSES = CALLS.map((c) => ({ fathom_call_id: c.id, prospect_name: null, intro_score: 60, discovery_score: 60, pitch_score: 60, objection_score: 60, close_score: 60, close_score_earned: 60 }));
let LARGEST_IN = 0, IN_CALLS = 0;
function fakeAdmin() {
  return {
    from(table) {
      const chain = { _in: null, _eq: {},
        select() { return chain; }, eq(c, v) { chain._eq[c] = v; return chain; }, gte() { return chain; }, lte() { return chain; }, lt() { return chain; }, not() { return chain; }, is() { return chain; }, order() { return chain; }, range() { return chain; },
        in(c, v) { chain._in = v; IN_CALLS++; if (v.length > LARGEST_IN) LARGEST_IN = v.length; return chain; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          if (chain._in && chain._in.length > URL_CEILING) return Promise.reject(new TypeError('fetch failed')).then(resolve, reject);   // the wire's answer above the ceiling
          if (table === 'fathom_calls') return Promise.resolve({ data: CALLS, error: null }).then(resolve, reject);
          if (table === 'call_analyses') return Promise.resolve({ data: ANALYSES.filter((a) => chain._in.indexOf(a.fathom_call_id) !== -1), error: null }).then(resolve, reject);
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}
const me = require('../routes/me');
me._setAdminClientForTests(function () { return fakeAdmin(); });
function app() { const a = express(); a.use(function (req, _res, next) { req.user = { id: 'owner', role: 'owner' }; req.userProfileRole = 'owner'; next(); }); a.use('/me', me); return a; }
function get(path) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app()).listen(0, function () {
      http.get({ port: server.address().port, path }, function (res) { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', function () { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); }).on('error', function (e) { server.close(); reject(e); });
    });
  });
}
test('⚠⚠ 401 calls in the window → the section drill-down still ANSWERS (200), and no single .in() carried more than the ceiling', async () => {
  LARGEST_IN = 0; IN_CALLS = 0;
  const r = await get('/me/sections/discovery?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z');
  assert.strictEqual(r.status, 200, 'a dead request is a 500 here: ' + JSON.stringify(r.body));
  assert.ok(LARGEST_IN <= 100, 'every id list must be chunked at the shared size (100); the largest sent was ' + LARGEST_IN);
  assert.ok(IN_CALLS >= 2 * Math.ceil(N_CALLS / 100), 'both the analyses and the highlights reads must chunk — only ' + IN_CALLS + ' .in() calls were made');
  assert.ok(r.body && typeof r.body.rank !== 'undefined', 'and the payload is the real breakdown, not an empty shell');
});
test('⚠ the prior-period read chunks too — it carries the previous window\'s ids', async () => {
  LARGEST_IN = 0;
  const r = await get('/me/sections/close?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z');
  assert.strictEqual(r.status, 200);
  assert.ok(LARGEST_IN <= 100, 'largest .in() sent: ' + LARGEST_IN);
});
