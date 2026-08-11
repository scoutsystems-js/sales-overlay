/**
 * 6d — the closer-side view of a section drilldown.
 *
 * This is the feature that has been blocked since the speaker-identity recon.
 * The blocking reason was never "we lack a UI" — it was that a closer-only
 * filter over inferred labels presents the PROSPECT's words back to the rep as
 * "your good moments". Three such moments were found in a six-item sample.
 *
 * So the contract is: a moment appears in the closer view ONLY when its
 * speaker was PROVEN (reconstructed from consecutive transcript turns). An
 * unproven label is the model's guess and is excluded; a never-assessed row
 * (no closer identity exists for that call at all) is excluded outright rather
 * than rendered as a guess.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildSectionBreakdown } = require('../lib/section-breakdown');

test('GUARD: the drilldown query SELECTS speaker_verified', () => {
  // Recurring bug class, twice shipped: Part 1b omitted `section` and 2b omitted
  // `id` from a highlights select, so the client silently received nothing and
  // the feature looked broken rather than erroring. Here the failure would be
  // worse than broken — every moment would arrive with speaker_verified
  // undefined, read as "never assessed", and the closer view would render
  // permanently empty with no error anywhere.
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8');
  const sel = src.match(/\.select\('id, fathom_call_id, section, type, resolution, speaker, quote, observation, timestamp_seconds[^']*'\)/);
  assert.ok(sel, 'section-drilldown highlights select not found');
  assert.ok(sel[0].indexOf('speaker_verified') !== -1,
    'the drilldown select must include speaker_verified or the closer view silently renders empty');
});

const META = { c1: { prospect_name: 'Leonard', recording_url: 'https://fathom.video/calls/1', call_date: '2026-08-01T10:00:00Z' } };

function hl(over) {
  return Object.assign({
    id: 'h' + Math.random().toString(36).slice(2, 7),
    fathom_call_id: 'c1', section: 'discovery', type: 'strong_moment',
    speaker: 'CLOSER', quote: 'q', observation: 'o', timestamp_seconds: 100,
    speaker_verified: true,
  }, over);
}

function build(highlights) {
  return buildSectionBreakdown('discovery', { analyses: [], highlights: highlights, callMeta: META });
}

test('a PROVEN closer moment appears in the closer view', () => {
  const out = build([hl({ quote: 'What is keeping the beds empty?' })]);
  assert.strictEqual(out.closer_moments.length, 1);
  assert.strictEqual(out.closer_moments[0].quote, 'What is keeping the beds empty?');
  assert.strictEqual(out.closer_counts.verified, 1);
});

test('an UNPROVEN closer moment is EXCLUDED and counted', () => {
  const out = build([hl({ speaker_verified: false, quote: 'Might be the prospect talking' })]);
  assert.strictEqual(out.closer_moments.length, 0);
  assert.strictEqual(out.closer_counts.hidden_unverified, 1);
});

test('a NEVER-ASSESSED moment is excluded outright, not rendered as a guess', () => {
  // No closer identity exists for that call (e.g. demo users) — unfixable by
  // any method, so it must never reach a closer-side surface.
  const out = build([hl({ speaker_verified: null })]);
  assert.strictEqual(out.closer_moments.length, 0);
  assert.strictEqual(out.closer_counts.hidden_unassessed, 1);
  assert.strictEqual(out.closer_counts.hidden_unverified, 0, 'must not be conflated with "assessed and unprovable"');
});

test('a PROSPECT moment never appears in the closer view, however verified', () => {
  const out = build([hl({ speaker: 'PROSPECT', speaker_verified: true })]);
  assert.strictEqual(out.closer_moments.length, 0);
});

test('a "what to fix" moment is not presented as something that worked', () => {
  const out = build([hl({ type: 'missed_opportunity' })]);
  assert.strictEqual(out.closer_moments.length, 0);
});

test('an objection counts as a closer win only when it was HANDLED', () => {
  const handled = build([hl({ type: 'objection', resolution: 'handled' })]);
  const partial = build([hl({ type: 'objection', resolution: 'partial' })]);
  assert.strictEqual(handled.closer_moments.length, 1);
  assert.strictEqual(partial.closer_moments.length, 0);
});

test('the prospect line that PRECEDES the closer moment is attached as context', () => {
  const out = build([
    hl({ speaker: 'PROSPECT', type: 'objection', resolution: 'unhandled', quote: 'I have no money for this', timestamp_seconds: 90 }),
    hl({ quote: 'What would have to be true for this to work?', timestamp_seconds: 100 }),
  ]);
  assert.strictEqual(out.closer_moments.length, 1);
  assert.ok(out.closer_moments[0].context, 'context must be attached');
  assert.strictEqual(out.closer_moments[0].context.quote, 'I have no money for this');
});

test('context comes from the NEAREST preceding prospect line, not the earliest', () => {
  const out = build([
    hl({ speaker: 'PROSPECT', quote: 'way earlier and unrelated', timestamp_seconds: 10 }),
    hl({ speaker: 'PROSPECT', quote: 'the line right before', timestamp_seconds: 95 }),
    hl({ quote: 'closer replies here', timestamp_seconds: 100 }),
  ]);
  assert.strictEqual(out.closer_moments[0].context.quote, 'the line right before');
});

test('a prospect line AFTER the closer moment is not used as its context', () => {
  const out = build([
    hl({ quote: 'closer speaks first', timestamp_seconds: 100 }),
    hl({ speaker: 'PROSPECT', quote: 'reply came later', timestamp_seconds: 200 }),
  ]);
  assert.strictEqual(out.closer_moments[0].context, null);
});

test('context is only drawn from the SAME call', () => {
  const meta2 = Object.assign({ c2: { prospect_name: 'Other', recording_url: null, call_date: '2026-08-02T10:00:00Z' } }, META);
  const out = buildSectionBreakdown('discovery', {
    analyses: [],
    highlights: [
      hl({ fathom_call_id: 'c2', speaker: 'PROSPECT', quote: 'different call entirely', timestamp_seconds: 90 }),
      hl({ fathom_call_id: 'c1', quote: 'closer on call one', timestamp_seconds: 100 }),
    ],
    callMeta: meta2,
  });
  assert.strictEqual(out.closer_moments[0].context, null);
});

test('unverified prospect lines may still be context — they are not attributed as the closer', () => {
  // Context is labelled as the prospect's and never presented as the rep's own
  // material, so an unproven one is a display risk, not an attribution claim.
  // It is still marked so the UI can hedge.
  const out = build([
    hl({ speaker: 'PROSPECT', speaker_verified: false, quote: 'unproven prospect line', timestamp_seconds: 95 }),
    hl({ quote: 'closer replies', timestamp_seconds: 100 }),
  ]);
  assert.strictEqual(out.closer_moments[0].context.quote, 'unproven prospect line');
  assert.strictEqual(out.closer_moments[0].context.verified, false);
});

test('empty input yields an empty closer view, not a crash or a placeholder', () => {
  const out = build([]);
  assert.deepStrictEqual(out.closer_moments, []);
  assert.deepStrictEqual(out.closer_counts, { verified: 0, hidden_unverified: 0, hidden_unassessed: 0 });
});

test('the existing good/bad groups are unchanged by the closer view', () => {
  // 6d ADDS a view; it must not quietly re-filter the section breakdown that
  // the call-review page already renders.
  const out = build([
    hl({ speaker_verified: false, quote: 'unproven but still a good moment' }),
    hl({ speaker: 'PROSPECT', speaker_verified: null, quote: 'prospect good moment' }),
  ]);
  assert.strictEqual(out.good.length, 2, 'good group must still contain both');
  assert.strictEqual(out.closer_moments.length, 0);
});
