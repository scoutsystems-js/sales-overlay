'use strict';
/* THE EVIDENCE READ CARRIES ITS CAUSE (H770). `lib/coachable-team.js` threw a bare
   'Coaching evidence unavailable' when the evidence read failed, dropping the wire's
   own message — so when Team → Coaching failed three of six cold loads on 2026-09-10
   the log could not say whether the read timed out or hit a size limit, and the two
   have different fixes. The error now carries the wire's message, code and details.
   Executed: the real loader over a fake wire whose evidence read fails. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCoachableTeam } = require('../lib/coachable-team');

function fakeAdmin() {
  return { from: function (table) {
    const q = { ids: null, sel: null,
      select: function (s) { q.sel = s; return q; }, in: function (_c, v) { q.ids = v; return q; }, eq: function () { return q; },
      gte: function () { return q; }, lte: function () { return q; }, not: function () { return q; }, is: function () { return q; },
      order: function () { return q; }, range: function () { return q; },
      then: function (resolve, reject) {
        let out = { data: [], error: null };
        if (table === 'fathom_calls') out = { data: [{ id: 'c1', user_id: 'rep', call_date: '2026-09-01T10:00:00Z', source: 'fathom', recording_url: null }], error: null };
        if (table === 'call_analyses' && /transcript_stored/.test(q.sel || '')) out = { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014', details: null, hint: null } };
        if (table === 'call_analyses') out = out.data === null ? out : { data: [{ fathom_call_id: 'c1', status: 'done', outcome: 'follow_up', rep_period_coaching: { version: 'x', findings: [] } }], error: null };
        return Promise.resolve(out).then(resolve, reject);
      } };
    return q;
  } };
}

test('a failing evidence read throws with the wire\'s message and code, never a bare sentence', async function () {
  await assert.rejects(
    loadCoachableTeam(fakeAdmin(), ['rep'], '2026-08-12', '2026-09-10', Promise.resolve(null)),
    function (err) {
      assert.match(err.message, /Coaching evidence unavailable/);
      assert.match(err.message, /statement timeout/, 'the underlying message is carried');
      assert.match(err.message, /57014/, 'and the code');
      return true;
    });
});
