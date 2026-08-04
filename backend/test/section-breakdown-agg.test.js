// lib/section-breakdown.js — the aggregate view of ONE section across a period.
// Stage 4a/4b: clicking a Coach-summary bar shows the MOMENTS behind the score.
const test = require('node:test');
const assert = require('node:assert');
const {
  sectionScoreOf, buildHistogram, rankSections, buildSectionBreakdown, HISTOGRAM_BUCKETS,
} = require('../lib/section-breakdown');

// ── The close-score trap (ruling 1) ──────────────────────────────────────
test('CLOSE uses close_score_earned, never the displayed 100', () => {
  // Migration 027 forces close_score=100 on closed calls (21 of 55 live). A
  // histogram built on the displayed value grows a fake spike covering 38% of
  // calls, and its "trend" is a close-rate trend in disguise.
  const row = { close_score: 100, close_score_earned: 62 };
  assert.strictEqual(sectionScoreOf(row, 'close'), 62);
});

test('CLOSE falls back to close_score when earned is absent (pre-027 rows)', () => {
  assert.strictEqual(sectionScoreOf({ close_score: 71, close_score_earned: null }, 'close'), 71);
});

test('non-close sections read their own score column untouched', () => {
  assert.strictEqual(sectionScoreOf({ discovery_score: 55 }, 'discovery'), 55);
  assert.strictEqual(sectionScoreOf({ intro_score: 0 }, 'intro'), 0);   // 0 is a real score
  assert.strictEqual(sectionScoreOf({ pitch_score: null }, 'pitch'), null);
});

// ── Histogram ────────────────────────────────────────────────────────────
test('histogram buckets scores and ignores nulls', () => {
  const h = buildHistogram([10, 25, 45, 55, 65, 75, 95, null, undefined]);
  const total = h.reduce((s, b) => s + b.count, 0);
  assert.strictEqual(total, 7, 'nulls must not be counted');
  assert.strictEqual(h.length, HISTOGRAM_BUCKETS.length);
});

test('histogram separates a weak AVERAGE from a weak FLOOR', () => {
  // The reason the distribution earns its place: discovery averages 55 but
  // ranges 15-75, so the problem is inconsistency, not a uniform ceiling.
  // Fixtures chosen so the property is actually expressed: the tight set sits
  // wholly INSIDE one bucket (an earlier version straddled a boundary and both
  // occupied two, which tested nothing).
  const spread = buildHistogram([15, 45, 60, 75, 95]);   // five buckets
  const tight = buildHistogram([56, 57, 58, 59, 60]);    // one bucket
  const nonEmptySpread = spread.filter((b) => b.count > 0).length;
  const nonEmptyTight = tight.filter((b) => b.count > 0).length;
  assert.ok(nonEmptySpread > nonEmptyTight, 'a spread distribution must occupy more buckets');
});

test('histogram is total on junk', () => {
  for (const v of [null, undefined, [], 'nope']) assert.ok(Array.isArray(buildHistogram(v)));
});

// ── Rank among the five ──────────────────────────────────────────────────
test('rank orders sections by average, 1 = strongest', () => {
  const r = rankSections({ intro: 63, discovery: 55, pitch: 66, objection: 62, close: 60 });
  assert.strictEqual(r.pitch, 1);
  assert.strictEqual(r.discovery, 5);
});

test('sections with no score are unranked rather than ranked last', () => {
  // Ranking a null as "worst" would tell a closer their intro is their weakest
  // section when they simply have no intro data.
  const r = rankSections({ intro: null, discovery: 55, pitch: 66 });
  assert.strictEqual(r.intro, null);
  assert.strictEqual(r.pitch, 1);
});

// ── The assembled breakdown ──────────────────────────────────────────────
const A = (id, scores, date) => Object.assign({ fathom_call_id: id, call_date: date }, scores);
const H = (call, section, type, quote, extra) =>
  Object.assign({ fathom_call_id: call, section, type, quote, observation: 'obs', timestamp_seconds: 60 }, extra || {});

test('splits moments into good and bad using the shared highlightGroup rule', () => {
  const out = buildSectionBreakdown('discovery', {
    analyses: [A('c1', { discovery_score: 55 }, '2026-07-01')],
    highlights: [
      H('c1', 'discovery', 'strong_moment', 'good one'),
      H('c1', 'discovery', 'missed_opportunity', 'bad one'),
      H('c1', 'pitch', 'strong_moment', 'other section'),
    ],
    callMeta: { c1: { prospect_name: 'Katina Goss', recording_url: 'https://f/x', call_date: '2026-07-01' } },
  });
  assert.strictEqual(out.good.length, 1);
  assert.strictEqual(out.bad.length, 1);
  assert.strictEqual(out.good[0].quote, 'good one');
});

test('every moment carries what the screen needs: prospect, date, and a ?t= link', () => {
  const out = buildSectionBreakdown('discovery', {
    analyses: [A('c1', { discovery_score: 55 }, '2026-07-01')],
    highlights: [H('c1', 'discovery', 'strong_moment', 'q')],
    callMeta: { c1: { prospect_name: 'Katina Goss', recording_url: 'https://fathom.video/calls/x', call_date: '2026-07-01' } },
  });
  const m = out.good[0];
  assert.strictEqual(m.prospect_name, 'Katina Goss');
  assert.strictEqual(m.call_date, '2026-07-01');
  assert.ok(/\?t=60$/.test(m.clip_url), 'clip link must carry the timestamp');
});

test('a call with no recording_url yields a null clip rather than a broken link', () => {
  const out = buildSectionBreakdown('discovery', {
    analyses: [A('c1', { discovery_score: 55 }, '2026-07-01')],
    highlights: [H('c1', 'discovery', 'strong_moment', 'q')],
    callMeta: { c1: { prospect_name: null, recording_url: null } },
  });
  assert.strictEqual(out.good[0].clip_url, null);
});

test('COVERAGE is reported honestly — moments, and calls contributing vs total', () => {
  // Objection reads thin on live data (33 moments from 16 of 55 calls). That is
  // information, not a defect, so the numbers must be surfaced not hidden.
  const out = buildSectionBreakdown('objection', {
    analyses: [A('c1', { objection_score: 62 }, '2026-07-01'), A('c2', { objection_score: 60 }, '2026-07-02'), A('c3', { objection_score: 58 }, '2026-07-03')],
    highlights: [H('c1', 'objection', 'objection', 'q1', { resolution: 'handled' })],
    callMeta: {},
  });
  assert.strictEqual(out.coverage.moments, 1);
  assert.strictEqual(out.coverage.calls_with_moments, 1);
  assert.strictEqual(out.coverage.calls_total, 3);
});

test('flags a section where BAD outnumbers GOOD (objection, live)', () => {
  const out = buildSectionBreakdown('objection', {
    analyses: [A('c1', { objection_score: 62 }, '2026-07-01')],
    highlights: [
      H('c1', 'objection', 'objection', 'unhandled', { resolution: 'unhandled' }),
      H('c1', 'objection', 'objection', 'partial', { resolution: 'partial' }),
      H('c1', 'objection', 'objection', 'handled', { resolution: 'handled' }),
    ],
    callMeta: {},
  });
  assert.strictEqual(out.bad_outnumber_good, true);
});

test('section NOTES are two labelled EXAMPLES, not an aggregate (ruling 2)', () => {
  const out = buildSectionBreakdown('discovery', {
    analyses: [
      A('c1', { discovery_score: 20, discovery_notes: 'weak note' }, '2026-07-01'),
      A('c2', { discovery_score: 75, discovery_notes: 'strong note' }, '2026-07-02'),
      A('c3', { discovery_score: 50, discovery_notes: 'middle note' }, '2026-07-03'),
    ],
    highlights: [], callMeta: {},
  });
  assert.strictEqual(out.examples.best.notes, 'strong note');
  assert.strictEqual(out.examples.worst.notes, 'weak note');
  assert.strictEqual(out.examples.best.score, 75);
});

test('buildSectionBreakdown is total on empty/junk input', () => {
  for (const v of [undefined, null, {}, { analyses: null, highlights: null }]) {
    const out = buildSectionBreakdown('discovery', v);
    assert.ok(Array.isArray(out.good) && Array.isArray(out.bad));
    assert.strictEqual(out.average, null);
  }
});
