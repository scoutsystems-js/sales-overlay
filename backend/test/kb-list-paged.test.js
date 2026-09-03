'use strict';
/* ⚠⚠ FIX #6 — THE KNOWLEDGE BASE LIST RETURNS EVERY ROW, NOT THE FIRST 1,000.
   PostgREST caps an unpaged select at 1,000 rows and stops SILENTLY; the owner's
   list held 2,277 rows on 2026-09-02 and the page rendered 1,000 of them as if
   they were all of them — a data problem rendering as good news (H062, H663).
   The fake client below serves 2,272 rows in true 1,000-row pages, honouring
   .range(); the route is executed as the owner and must return groups whose
   chunk counts sum to 2,272. Both plants fail it (H679): the page loop removed
   (1,000 come back), and the loop kept but always asking for page 0. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, { requireAuth: function (req, _res, next) { next(); }, requireSubscription: function (_req, _res, next) { next(); } });

const N = 2272, PAGE = 1000;
const ROWS = []; for (let i = 0; i < N; i++) ROWS.push({ source_label: 'src-' + (i % 37), scope: 'global', metadata: { source_type: 'url', category: 'user_upload' }, created_at: '2026-08-0' + (1 + (i % 9)) + 'T00:00:00Z', uploaded_by: 'owner', team_owner_id: null });
let RANGES = [];
function fakeAdmin() {
  return {
    from(table) {
      const chain = { _range: null, _eq: {},
        select() { return chain; }, eq(c, v) { chain._eq[c] = v; return chain; }, in() { return chain; }, not() { return chain; }, is() { return chain; }, or() { return chain; }, order() { return chain; },
        range(a, b) { chain._range = [a, b]; RANGES.push([a, b]); return chain; },
        maybeSingle() { if (table === 'user_profiles') return Promise.resolve({ data: { user_id: 'owner', role: 'owner', managed_by: null, active: true }, error: null }); return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          if (table !== 'knowledge_base') return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          /* the wire: unpaged → the first 1,000 and nothing else; paged → that slice */
          const a = chain._range ? chain._range[0] : 0, b = chain._range ? Math.min(chain._range[1], a + PAGE - 1) : PAGE - 1;
          return Promise.resolve({ data: ROWS.slice(a, b + 1), error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}
const kb = require('../routes/kb');
kb._setAdminClientForTests(function () { return fakeAdmin(); });
function app() { const a = express(); a.use(function (req, _res, next) { req.user = { id: 'owner', role: 'owner' }; req.userProfileRole = 'owner'; next(); }); a.use('/kb', kb); return a; }
function get(path) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app()).listen(0, function () {
      http.get({ port: server.address().port, path }, function (res) { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', function () { server.close(); let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); }).on('error', function (e) { server.close(); reject(e); });
    });
  });
}
test('⚠⚠ 2,272 rows → the owner\'s list carries all 2,272, in 1,000-row pages', async () => {
  RANGES = [];
  const r = await get('/kb/list');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const total = (r.body.uploads || []).reduce((n, u) => n + u.chunk_count, 0);
  assert.strictEqual(total, N, 'every row must arrive — 1,000 is the silent cap, not the list');
  assert.ok(RANGES.length >= 3, 'at least three pages must be asked for; ranges asked: ' + JSON.stringify(RANGES));
  assert.ok(RANGES.every((rg, i) => rg[0] === i * PAGE), 'each page must start where the last ended: ' + JSON.stringify(RANGES));
  assert.strictEqual(r.body.truncated, false, 'and the payload says it is complete');
});
