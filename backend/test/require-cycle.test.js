/**
 * H738 — NO REQUIRE CYCLE LEAVES A CONSTANT UNDEFINED (H061, executed). The route modules are loaded in index.js's
 * production order in a fresh cache, and both ends of the former team-needs-work ↔ team-synthesis cycle are asserted
 * FULL: the lane holds the floor as a number, the needs-work module holds the window loader as a function. Reintroduce
 * the cycle (team-synthesis requiring the floor from team-needs-work) and this fails.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
const ORDER = ['auth', 'billing', 'proxy', 'download', 'log', 'admin', 'support', 'me', 'kb', 'fathom', 'team', 'eod', 'zoom'];
test('⚠⚠ in production load order, both ends of the former cycle are full', () => {
  Object.keys(require.cache).forEach((k) => { if (/[\\/](lib|routes)[\\/]/.test(k)) delete require.cache[k]; });
  ORDER.forEach((r) => { try { require(path.join(__dirname, '..', 'routes', r)); } catch (e) { /* a route module that needs live config may throw; the lib modules it pulled are what is under test */ } });
  const ts = require('../lib/team-synthesis'); const tnw = require('../lib/team-needs-work'); const floor = require('../lib/comparison-floor');
  assert.strictEqual(ts._MIN_BUCKET, floor.MIN_BUCKET, 'the recommendations lane holds the floor (it held undefined through the cycle)');
  assert.strictEqual(typeof ts._MIN_BUCKET, 'number');
  assert.strictEqual(tnw.MIN_BUCKET, floor.MIN_BUCKET, 'team-needs-work re-exports the same value');
  assert.strictEqual(typeof tnw.loadTeamWindow, 'undefined', 'team-needs-work does not export the loader');
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  assert.ok(!/require\('\.\/team-needs-work'\)/.test(src), 'team-synthesis must not require team-needs-work — that was the cycle');
});
