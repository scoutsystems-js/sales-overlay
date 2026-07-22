// Tests for the daily manager digest (lib/team-digest.js) — the pure parts:
// ET calendar math (DST-safe via Intl, no tz dependency), the cache-key
// convention the /team/digest read stub already assumes (from_ts = the digest
// date at midnight UTC), the analysis-set + kbHash discipline, and the
// zero-call "quiet day" digest shape.
//
// Run: npm test (node --test) from backend/.
const test = require('node:test');
const assert = require('node:assert');
const digest = require('../lib/team-digest');

// ─── ET calendar day of an instant ───────────────────────────────────────────
test('etDateOf: UTC instants map to the America/New_York calendar day', () => {
  // 03:00Z on Jul 22 is 23:00 EDT on Jul 21
  assert.strictEqual(digest._etDateOf(new Date('2026-07-22T03:00:00Z')), '2026-07-21');
  // midday UTC is the same ET day
  assert.strictEqual(digest._etDateOf(new Date('2026-07-22T12:00:00Z')), '2026-07-22');
  // 04:30Z on Jan 15 is 23:30 EST on Jan 14 (winter offset −5)
  assert.strictEqual(digest._etDateOf(new Date('2026-01-15T04:30:00Z')), '2026-01-14');
});

test('etYesterday: previous ET calendar day, not UTC-24h', () => {
  assert.strictEqual(digest._etYesterday(new Date('2026-07-22T12:00:00Z')), '2026-07-21');
  // 03:00Z Jul 22 is still ET Jul 21 → yesterday is Jul 20
  assert.strictEqual(digest._etYesterday(new Date('2026-07-22T03:00:00Z')), '2026-07-20');
  // month boundary
  assert.strictEqual(digest._etYesterday(new Date('2026-08-01T12:00:00Z')), '2026-07-31');
});

// ─── ET day bounds in UTC (the call_date query window) ───────────────────────
test('etDayBoundsUtc: EDT summer day = 04:00Z bounds', () => {
  const b = digest._etDayBoundsUtc('2026-07-15');
  assert.strictEqual(b.fromIso, '2026-07-15T04:00:00.000Z');
  assert.strictEqual(b.toIso, '2026-07-16T04:00:00.000Z');
});

test('etDayBoundsUtc: EST winter day = 05:00Z bounds', () => {
  const b = digest._etDayBoundsUtc('2026-01-15');
  assert.strictEqual(b.fromIso, '2026-01-15T05:00:00.000Z');
  assert.strictEqual(b.toIso, '2026-01-16T05:00:00.000Z');
});

test('etDayBoundsUtc: DST transition days have 23h/25h spans', () => {
  // Spring forward 2026-03-08: midnight is EST (05:00Z), next midnight EDT (04:00Z) → 23h
  const spring = digest._etDayBoundsUtc('2026-03-08');
  assert.strictEqual(spring.fromIso, '2026-03-08T05:00:00.000Z');
  assert.strictEqual(spring.toIso, '2026-03-09T04:00:00.000Z');
  // Fall back 2026-11-01: midnight is EDT (04:00Z), next midnight EST (05:00Z) → 25h
  const fall = digest._etDayBoundsUtc('2026-11-01');
  assert.strictEqual(fall.fromIso, '2026-11-01T04:00:00.000Z');
  assert.strictEqual(fall.toIso, '2026-11-02T05:00:00.000Z');
});

// ─── Cache-key convention (must match the /team/digest read stub) ────────────
test('digestCacheKey: from_ts is the digest date at midnight UTC — what eq(from_ts, date) casts to', () => {
  const k = digest._digestCacheKey('2026-07-21');
  assert.strictEqual(k.fromTs, '2026-07-21T00:00:00.000Z');
  assert.strictEqual(k.toTs, '2026-07-22T00:00:00.000Z');
});

// ─── Set-hash discipline (analysis set + kbHash, order-independent) ──────────
test('digestSetHash: deterministic, order-independent, kb- and call-set-sensitive', () => {
  const a = [{ fathom_call_id: 'c1', analyzed_at: 't1' }, { fathom_call_id: 'c2', analyzed_at: 't2' }];
  const b = [{ fathom_call_id: 'c2', analyzed_at: 't2' }, { fathom_call_id: 'c1', analyzed_at: 't1' }];
  const calls = ['c1', 'c2'];
  assert.strictEqual(digest._digestSetHash(a, 'kb1', calls), digest._digestSetHash(b, 'kb1', ['c2', 'c1']));
  assert.notStrictEqual(digest._digestSetHash(a, 'kb1', calls), digest._digestSetHash(a, 'kb2', calls));
  assert.notStrictEqual(digest._digestSetHash(a, 'kb1', calls), digest._digestSetHash([a[0]], 'kb1', calls));
  // empty set (quiet day) still hashes stably
  assert.strictEqual(digest._digestSetHash([], 'none', []), digest._digestSetHash([], 'none', []));
  // KEY: calls synced but not yet analyzed must NOT collide with a true
  // zero-call quiet day — otherwise a cached quiet digest pins until analyses land.
  assert.notStrictEqual(digest._digestSetHash([], 'none', ['c1']), digest._digestSetHash([], 'none', []));
});

test('etYesterday is exported unprefixed for route use', () => {
  assert.strictEqual(typeof digest.etYesterday, 'function');
  assert.strictEqual(digest.etYesterday(new Date('2026-07-22T12:00:00Z')), '2026-07-21');
});

// ─── Quiet-day digest: valid, deterministic, no Claude call implied ──────────
test('quietDigest: zero-call day yields a complete renderable digest, never an error shape', () => {
  const q = digest._quietDigest('2026-07-21');
  assert.strictEqual(q.date, '2026-07-21');
  assert.strictEqual(q.quiet, true);
  assert.deepStrictEqual(q.stats, { calls: 0, closed: 0, follow_up: 0, lost: 0, no_show: 0, reps_active: 0 });
  assert.ok(typeof q.summary === 'string' && q.summary.length > 0, 'quiet digest has a human summary');
  assert.deepStrictEqual(q.notable, []);
  assert.ok(typeof q.focus === 'string' && q.focus.length > 0, 'quiet digest still gives the day a focus');
  assert.ok(!isNaN(Date.parse(q.generated_at)), 'generated_at is a timestamp');
});
