/**
 * 7c part 1 — caching the derived areas.
 *
 * Areas are MATERIAL-scoped, not time-scoped: they change when the rep edits
 * their offer/criteria/script and at no other time. So the cache key is the
 * material hash, and the date columns the cache table requires carry a fixed
 * sentinel rather than a meaningful range.
 *
 * The cache exists to stop a per-user Claude call running on every analysed
 * call. A cache miss must cost one derivation; a hit must cost nothing; and no
 * material must cost nothing at all, not even a lookup.
 */
const test = require('node:test');
const assert = require('node:assert');
const areas = require('../lib/coaching-areas');

const RICH = {
  offer: 'Done for you market research to identify local agencies to place tenants, plus A-Z education on licensing, property and scaling.',
  qualifications: '10k saved, not living paycheck to paycheck, 640 or above credit score',
  script_raw: 'Tell me about your current setup. What does your income goal look like?',
};

// Minimal Supabase fake: records what was asked of it so the test can assert
// on calls made, not just values returned.
function fakeAdmin(opts) {
  const o = opts || {};
  const log = { profileReads: 0, cacheReads: 0, writes: [] };
  const api = {
    log: log,
    from(table) {
      const q = { _table: table, _filters: {} };
      q.select = () => q;
      q.eq = (k, v) => { q._filters[k] = v; return q; };
      q.order = () => { q._ordered = true; return q; };
      q.limit = () => q;
      q.maybeSingle = async () => {
        if (q._table === 'objection_synthesis_cache' && q._ordered) {
          return { data: (o.prior || []).length ? { synthesis: { areas: o.prior.map((k) => ({ key: k, label: k })) } } : null, error: null };
        }
        if (q._table === 'user_profiles') {
          log.profileReads++;
          if (o.profileError) return { data: null, error: { message: 'boom' } };
          return { data: o.profile || null, error: null };
        }
        log.cacheReads++;
        if (o.cacheError) return { data: null, error: { message: 'cache boom' } };
        const hit = o.cached && o.cached.hash === q._filters.analysis_set_hash;
        return { data: hit ? { synthesis: o.cached.synthesis } : null, error: null };
      };
      q.upsert = async (row) => {
        log.writes.push(row);
        return o.writeError ? { error: { message: 'write boom' } } : { error: null };
      };
      return q;
    },
  };
  return api;
}

test('cache HIT returns the stored areas and makes NO model call', async () => {
  const hash = areas.materialHash(RICH);
  let called = false;
  const admin = fakeAdmin({ profile: RICH, cached: { hash: hash, synthesis: { areas: [{ key: 'income_goal', label: 'Income goal' }] } } });
  const out = await areas.getAreasForUser(admin, 'u1', async () => { called = true; return []; });

  assert.strictEqual(called, false, 'a cache hit must not cost a Claude call');
  assert.deepStrictEqual(out.areas.map(a => a.key), ['income_goal']);
  assert.strictEqual(out.cached, true);
  assert.strictEqual(admin.log.writes.length, 0, 'a hit must not rewrite the row');
});

test('cache MISS derives once and stores the result', async () => {
  const admin = fakeAdmin({ profile: RICH });
  const out = await areas.getAreasForUser(admin, 'u1', async () => [{ key: 'income_goal', label: 'Income goal' }]);

  assert.strictEqual(out.cached, false);
  assert.deepStrictEqual(out.areas.map(a => a.key), ['income_goal']);
  assert.strictEqual(admin.log.writes.length, 1);
  const row = admin.log.writes[0];
  assert.strictEqual(row.synthesis_type, 'coaching_areas');
  assert.strictEqual(row.analysis_set_hash, areas.materialHash(RICH));
  assert.ok(row.from_ts && row.to_ts, 'the cache table requires both date columns');
});

test('a change to the material MISSES a cache entry keyed on the old material', async () => {
  const staleHash = areas.materialHash(RICH);
  const edited = Object.assign({}, RICH, { qualifications: '20k saved, 700 credit score' });
  let called = false;
  const admin = fakeAdmin({ profile: edited, cached: { hash: staleHash, synthesis: { areas: [{ key: 'old', label: 'Old' }] } } });
  const out = await areas.getAreasForUser(admin, 'u1', async () => { called = true; return [{ key: 'financial_qualification', label: 'Financial qualification' }]; });

  assert.strictEqual(called, true, 'edited criteria must re-derive');
  assert.deepStrictEqual(out.areas.map(a => a.key), ['financial_qualification']);
});

test('NO MATERIAL costs nothing — no cache read, no model call, no write', async () => {
  let called = false;
  const admin = fakeAdmin({ profile: { offer: 'Ava' } });
  const out = await areas.getAreasForUser(admin, 'u1', async () => { called = true; return []; });

  assert.deepStrictEqual(out.areas, []);
  assert.strictEqual(out.reason, 'no_material');
  assert.strictEqual(called, false);
  assert.strictEqual(admin.log.cacheReads, 0, 'do not even look up a cache entry that cannot exist');
  assert.strictEqual(admin.log.writes.length, 0);
});

test('an empty derivation is NOT cached — it would pin the silence in place', async () => {
  // A transient model failure must not be remembered as "this rep has no
  // areas" until they happen to edit their offer.
  const admin = fakeAdmin({ profile: RICH });
  const out = await areas.getAreasForUser(admin, 'u1', async () => { throw new Error('429'); });
  assert.deepStrictEqual(out.areas, []);
  assert.strictEqual(admin.log.writes.length, 0);
});

test('a cache READ failure degrades to deriving rather than throwing', async () => {
  const admin = fakeAdmin({ profile: RICH, cacheError: true });
  const out = await areas.getAreasForUser(admin, 'u1', async () => [{ key: 'income_goal', label: 'Income goal' }]);
  assert.deepStrictEqual(out.areas.map(a => a.key), ['income_goal']);
});

test('a cache WRITE failure still returns the areas', async () => {
  const admin = fakeAdmin({ profile: RICH, writeError: true });
  const out = await areas.getAreasForUser(admin, 'u1', async () => [{ key: 'income_goal', label: 'Income goal' }]);
  assert.deepStrictEqual(out.areas.map(a => a.key), ['income_goal']);
});

test('a profile read failure degrades to silence, never throws', async () => {
  const admin = fakeAdmin({ profileError: true });
  const out = await areas.getAreasForUser(admin, 'u1', async () => [{ key: 'x', label: 'X' }]);
  assert.deepStrictEqual(out.areas, []);
});

test('the sentinel dates are STABLE — otherwise every run writes a new row', () => {
  // from_ts/to_ts are NOT NULL and sit in the unique index. Areas have no date
  // range, so they carry a fixed sentinel. If it were derived from "now", the
  // unique index would never match and the cache would never hit.
  assert.strictEqual(areas.AREA_SENTINEL_TS, areas.AREA_SENTINEL_TS);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(areas.AREA_SENTINEL_TS));
});

test('re-derivation is shown the keys already in use, so they do not drift', async () => {
  // Observed live: the SAME material produced income_goal_and_gap on one run
  // and income_goal_and_motivation on the next; prior_attempts then
  // previous_attempts. Keys are join keys for the moment library, so gratuitous
  // renaming silently orphans every tagged moment and reads as "no examples".
  let seenPrompt = '';
  const edited = Object.assign({}, RICH, { qualifications: 'changed criteria here' });
  const admin = fakeAdmin({ profile: edited, prior: ['income_goal_and_gap', 'prior_attempts'] });
  await areas.getAreasForUser(admin, 'u1', async (p) => { seenPrompt = p; return [{ key: 'income_goal_and_gap', label: 'Income goal' }]; });

  assert.ok(/KEYS ALREADY IN USE/.test(seenPrompt), 'prior keys must be shown to the derivation');
  assert.ok(seenPrompt.indexOf('income_goal_and_gap') !== -1);
  assert.ok(/REUSE its exact key/.test(seenPrompt));
});

test('a first-ever derivation carries no prior-key preamble', async () => {
  let seenPrompt = '';
  const admin = fakeAdmin({ profile: RICH });
  await areas.getAreasForUser(admin, 'u1', async (p) => { seenPrompt = p; return [{ key: 'a_b', label: 'A B' }]; });
  assert.ok(!/KEYS ALREADY IN USE/.test(seenPrompt));
});
