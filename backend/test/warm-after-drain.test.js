'use strict';
/* ⚠⚠ THE WARM-UP RAN BEFORE THE ANALYSES IT HAD JUST DISPATCHED LANDED.
   sync-all dispatches fire-and-forget, returns, then warms — so on any cycle
   that brings new calls it warms a fingerprint the analyses then change.
   Evidenced 2026-09-01: cron 16:29, 19 analyses landed during 16:xx, a fresh
   cache row written at 16:45 by a page visit — a miss.
   ⚠ THE KEY IS CORRECT. THE TIMING IS WRONG. This moves the warm-up to the END
   OF THE ANALYZE LOOP, gated on the drain being finished: the last loop to
   finish sees no live claim and warms; every earlier one sees a live claim and
   steps aside. Stale claims (older than the claim window) are not a drain. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { warmWhenDrained } = require('../lib/warm-after-drain');
const { stripComments } = require('./helpers/strip-comments');

const NOW = Date.parse('2026-09-02T04:00:00.000Z');
const LIVE = new Date(NOW - 2 * 60 * 1000).toISOString();     // 2 min old claim — live
const STALE = new Date(NOW - 40 * 60 * 1000).toISOString();   // 40 min old — stranded, not a drain

function fakeAdmin(tables) {
  return {
    auth: { admin: { listUsers() { return Promise.resolve({ data: { users: [{ id: 'm1', email: 'm1@x.io' }, { id: 'r1', email: 'r1@x.io' }] }, error: null }); } } },
    from(table) {
      const rows = tables[table] || [];
      const f = [];
      const chain = {
        select() { return chain; }, in() { return chain; }, is() { return chain; }, not() { return chain; }, limit() { return chain; },
        eq(c, v) { f.push((r) => r[c] === v); return chain; },
        gte(c, v) { f.push((r) => r[c] >= v); return chain; },
        then(res, rej) { let out = rows.slice(); f.forEach((p) => { out = out.filter(p); }); return Promise.resolve({ data: out, error: null }).then(res, rej); },
      };
      return chain;
    },
  };
}
const PROFILES = [{ user_id: 'r1', managed_by: 'm1', active: true }, { user_id: 'm1', managed_by: null, active: true }];

test('⚠⚠ A LIVE CLAIM MEANS THE DRAIN IS STILL RUNNING — step aside, warm nothing', async () => {
  const calls = [];
  const out = await warmWhenDrained(fakeAdmin({ call_analyses: [{ id: 1, status: 'processing', analyzed_at: LIVE }], user_profiles: PROFILES }),
    { now: NOW, warm: async (a, o) => { calls.push(o); return { warmed: 1 }; } });
  assert.strictEqual(out.skipped, 'draining');
  assert.strictEqual(out.live, 1);
  assert.strictEqual(calls.length, 0, 'the warm-up must not run mid-drain');
});

test('⚠⚠ NO LIVE CLAIM (stale ones do not count) — warm every manager, with the shared membership rule', async () => {
  const calls = [];
  const out = await warmWhenDrained(fakeAdmin({ call_analyses: [{ id: 1, status: 'processing', analyzed_at: STALE }, { id: 2, status: 'done', analyzed_at: LIVE }], user_profiles: PROFILES }),
    { now: NOW, warm: async (a, o) => { calls.push(o); return { managers: 1, warmed: 1, cached: 0 }; } });
  assert.strictEqual(out.skipped, undefined);
  assert.strictEqual(calls.length, 1, 'exactly one warm pass');
  assert.deepStrictEqual(calls[0].managers, { m1: ['r1', 'm1'] }, 'manager map via membersByManager — the manager is on their own board (appended last, the shared rule\'s order)');
  assert.deepStrictEqual(calls[0].emailMap, { m1: 'm1@x.io', r1: 'r1@x.io' });
  assert.deepStrictEqual(out.summary, { managers: 1, warmed: 1, cached: 0 });
});

test('⚠ NO MANAGERS → nothing to warm, said so; a warm failure is reported, never thrown', async () => {
  const out = await warmWhenDrained(fakeAdmin({ call_analyses: [], user_profiles: [{ user_id: 'x', managed_by: null }] }), { now: NOW, warm: async () => { throw new Error('nope'); } });
  assert.strictEqual(out.skipped, 'no_managers');
  const out2 = await warmWhenDrained(fakeAdmin({ call_analyses: [], user_profiles: PROFILES }), { now: NOW, warm: async () => { throw new Error('nope'); } });
  assert.strictEqual(out2.error, 'nope');
});

test('⚠⚠ THE CALL SITES: both analyze loops warm AFTER their last call; sync-all only warms when it dispatched nothing', () => {
  const fathom = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8'));
  const zoom = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'zoom.js'), 'utf8'));
  const fLoop = fathom.indexOf('await analyzeCall(newCallIds[i], userId)');
  assert.ok(fLoop > 0, 'fathom analyze loop anchor');
  const fWarm = fathom.indexOf('warmWhenDrained(admin', fLoop);
  assert.ok(fWarm > fLoop && fWarm - fLoop < 900, 'fathom: warmWhenDrained follows the loop, saw ' + (fWarm - fLoop));
  const zLoop = zoom.indexOf('await analyzeCall(dispatchIds[i], userId)');
  assert.ok(zLoop > 0, 'zoom analyze loop anchor');
  const zWarm = zoom.indexOf('warmWhenDrained(admin', zLoop);
  assert.ok(zWarm > zLoop && zWarm - zLoop < 900, 'zoom: warmWhenDrained follows the loop, saw ' + (zWarm - zLoop));
  const sa = fathom.indexOf("router.post('/sync-all'");
  assert.ok(sa > 0, 'sync-all anchor');
  const post = fathom.slice(sa, sa + 6000);
  const gate = post.indexOf('summary.dispatched_total === 0');
  const warm = post.indexOf('warmTeamRecommendations(admin');
  assert.ok(gate > 0 && warm > gate, 'the post-sync warm is gated on nothing having been dispatched');
});
