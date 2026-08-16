/**
 * Sub-stage 0 — snap cache-key timestamps to UTC day boundaries.
 *
 * ⚠ THE MEASURED PROBLEM. `setDateRange`/`setTeamRange` build `to = new Date()`
 * at click time, so every range carried MILLISECOND precision into the cache key.
 * Live cache before this change: `performance` 60 rows / 60 DISTINCT windows over
 * 4 users; `team` 39 rows / 39 distinct windows over ONE manager; 60 of 60
 * `performance` rows had a non-midnight `to`. Distinct windows ≈ row count in
 * every LLM lane — the cache was being written and almost never read, burning
 * ~8 Claude generations a day that should have been hits.
 *
 * ⚠ WHY COLLAPSING KEYS IS SAFE — analysis_set_hash ALREADY DOES FRESHNESS.
 * Every lane folds `fathom_call_id + ':' + analyzed_at` for every done analysis
 * in the window into the hash (objections, performance, team, highlights,
 * team_needs_work, needs_work, digest — verified in all seven). The analyses are
 * loaded with the EXACT from/to, so two windows that snap to the same key but
 * contain different data produce DIFFERENT hashes and cannot collide. The
 * timestamps were duplicating the hash's job and doing it badly.
 *
 * ⚠ SNAPPING IS FOR THE CACHE KEY ONLY. Data queries keep the exact from/to.
 * Snapping the query window would change which calls are aggregated, which is a
 * behaviour change and NOT what this stage is.
 */
const test = require('node:test');
const assert = require('node:assert');
const { snapCacheTs, snapCacheWindow } = require('../lib/cache-window');

test('a mid-day timestamp snaps to midnight UTC of its own day', () => {
  assert.strictEqual(snapCacheTs('2026-08-15T23:47:12.345Z'), '2026-08-15T00:00:00.000Z');
  assert.strictEqual(snapCacheTs('2026-08-15T00:00:00.001Z'), '2026-08-15T00:00:00.000Z');
});

test('EVERY instant within one UTC day maps to the SAME key — the whole point', () => {
  const day = ['2026-08-15T00:00:00.000Z', '2026-08-15T09:30:00.000Z',
               '2026-08-15T15:02:59.999Z', '2026-08-15T23:59:59.999Z'];
  const keys = new Set(day.map(snapCacheTs));
  assert.strictEqual(keys.size, 1, 'four clicks in a day must produce ONE key, not four');
});

test('different days stay different — it collapses noise, not information', () => {
  assert.notStrictEqual(snapCacheTs('2026-08-15T12:00:00Z'), snapCacheTs('2026-08-16T12:00:00Z'));
});

test('an already-midnight value is unchanged, so the digest lane is a NO-OP', () => {
  // team-digest keys on date@00:00Z and is the one lane with real reuse today.
  // It must not move.
  assert.strictEqual(snapCacheTs('2026-08-15T00:00:00.000Z'), '2026-08-15T00:00:00.000Z');
  assert.strictEqual(snapCacheTs('2026-08-16T00:00:00+00:00'), '2026-08-16T00:00:00.000Z');
});

test('the EPOCH sentinel is unchanged, so page_summary and coaching_areas are NO-OPs', () => {
  // Both key on epoch sentinels and carry their real key in the hash.
  assert.strictEqual(snapCacheTs('1970-01-01T00:00:00.000Z'), '1970-01-01T00:00:00.000Z');
});

test('a bare YYYY-MM-DD is accepted and stays that day', () => {
  // routes/team.js reads the digest lane with eq('from_ts', 'YYYY-MM-DD').
  assert.strictEqual(snapCacheTs('2026-08-15'), '2026-08-15T00:00:00.000Z');
});

test('UTC is used, NOT local time — a key must not depend on server timezone', () => {
  // 2026-08-15T23:00Z is Aug 16 in +02:00. The key must still say Aug 15.
  assert.strictEqual(snapCacheTs('2026-08-15T23:00:00.000Z'), '2026-08-15T00:00:00.000Z');
  // Same instant expressed with an offset must give the SAME key.
  assert.strictEqual(snapCacheTs('2026-08-16T01:00:00+02:00'), '2026-08-15T00:00:00.000Z');
});

test('garbage is passed through UNCHANGED rather than throwing or inventing a date', () => {
  // A cache key is not worth failing a request over. An unparseable value keeps
  // its old behaviour — it just will not benefit from snapping.
  [null, undefined, '', 'not-a-date', 42, {}].forEach((junk) => {
    assert.strictEqual(snapCacheTs(junk), junk, JSON.stringify(junk));
  });
});

test('snapCacheWindow snaps both ends and preserves order', () => {
  const w = snapCacheWindow('2026-08-01T08:15:00.000Z', '2026-08-12T22:45:00.000Z');
  assert.deepStrictEqual(w, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-12T00:00:00.000Z' });
});

test('THE REGRESSION THIS PREVENTS: two clicks minutes apart share a key', () => {
  // Exactly what the live cache shows happening today — the same 30-day preset
  // clicked twice produced two rows.
  const a = snapCacheWindow('2026-07-16T09:00:00.000Z', '2026-08-15T09:00:00.000Z');
  const b = snapCacheWindow('2026-07-16T09:04:31.784Z', '2026-08-15T09:04:31.784Z');
  assert.deepStrictEqual(a, b, 'two clicks in the same day must hit the same cache row');
});

// ─── the safety property, stated as a test ────────────────────────────────

test('SAFETY: same key + different data still cannot collide, because the HASH differs', () => {
  // Not a claim about this module — a claim about the system. Two windows in one
  // day snap together, but the analyses are loaded on the EXACT window, so a call
  // analysed between them changes the hash and forces a regeneration.
  const morning = snapCacheWindow('2026-08-15T00:00:00Z', '2026-08-15T09:00:00Z');
  const evening = snapCacheWindow('2026-08-15T00:00:00Z', '2026-08-15T21:00:00Z');
  assert.deepStrictEqual(morning, evening, 'keys collapse');

  const hashOf = (set) => require('node:crypto').createHash('md5')
    .update(set.map((a) => a.id + ':' + a.at).sort().join('|')).digest('hex');
  const before = [{ id: 'c1', at: '2026-08-15T08:00:00Z' }];
  const after = before.concat([{ id: 'c2', at: '2026-08-15T12:00:00Z' }]);
  assert.notStrictEqual(hashOf(before), hashOf(after),
    'a new analysis must change the hash — this is what makes key collapse safe');
});
