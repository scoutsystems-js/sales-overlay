// The selectivity bar (H721) — Justin's ruling 2026-09-04, FORWARD ONLY.
// "A moment needs a reason to exist." COACHABLE: a missed opportunity · an objection
// left partial or unhandled · a risk signal or barrier ignored or deflected.
// APPLAUDABLE: a verified closer strong moment · an objection handled · a risk
// signal or barrier addressed · a buying signal with an evidenced move.
// A prompt rule, a filter and a version bump; nothing new at write time; NOTHING
// DELETED — the bar governs what is captured, existing moments stay as they are.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const bar = require('../lib/moment-bar');
const W = require('../lib/analysis-worker');

const M = (o) => Object.assign({ speaker: 'PROSPECT', speaker_verified: true, timestamp_seconds: 100, quote: 'q', observation: 'o', section: 'discovery' }, o);
const CAUSE = { move: 'digging for pain', none_reason: null, evidence: [{ timestamp_seconds: 10, quote: 'a', located: true }, { timestamp_seconds: 20, quote: 'b', located: true }] };

test('every coachable reason, by the field it is derived from', () => {
  assert.deepStrictEqual(bar.momentReason(M({ type: 'missed_opportunity' })), { kind: 'coachable', reason: 'a missed opportunity' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'objection', resolution: 'partial' })), { kind: 'coachable', reason: 'an objection left partial' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'objection', resolution: 'unhandled' })), { kind: 'coachable', reason: 'an objection left unhandled' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'risk_signal', handling: 'ignored' })), { kind: 'coachable', reason: 'a risk signal ignored' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'barrier', handling: 'deflected' })), { kind: 'coachable', reason: 'a barrier deflected' });
});

test('every applaudable reason', () => {
  assert.deepStrictEqual(bar.momentReason(M({ type: 'strong_moment', speaker: 'CLOSER', speaker_verified: true })), { kind: 'applaudable', reason: 'a verified closer strong moment' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'objection', resolution: 'handled' })), { kind: 'applaudable', reason: 'an objection handled' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'risk_signal', handling: 'addressed' })), { kind: 'applaudable', reason: 'a risk signal addressed' });
  assert.deepStrictEqual(bar.momentReason(M({ type: 'buying_signal', cause: CAUSE })), { kind: 'applaudable', reason: 'a buying signal the closer earned (digging for pain)' });
});

test('what falls: an unevidenced buying signal, a rapport moment, an unverified strong moment, a lone DQ signal, an objection with no resolution, a risk signal with no verdict', () => {
  assert.strictEqual(bar.momentReason(M({ type: 'buying_signal', cause: { move: 'none', none_reason: 'arrived_pre_sold' } })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'buying_signal', cause: null })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'buying_signal', cause: { move: 'none', none_reason: 'not_evidenced', refused: { move: 'reframing' } } })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'rapport_moment' })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'strong_moment', speaker: 'CLOSER', speaker_verified: false })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'strong_moment', speaker: 'PROSPECT', speaker_verified: true })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'disqualify_signal' })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'objection', resolution: null })), null);
  assert.strictEqual(bar.momentReason(M({ type: 'risk_signal', handling: null })), null);
});

test('applyMomentBar keeps the survivors in order, stamps the reason on each, re-numbers sequence_order, and reports what fell', () => {
  const rows = [M({ type: 'rapport_moment', timestamp_seconds: 10 }), M({ type: 'missed_opportunity', timestamp_seconds: 20, sequence_order: 2 }), M({ type: 'buying_signal', timestamp_seconds: 30, cause: CAUSE, sequence_order: 3 }), M({ type: 'disqualify_signal', timestamp_seconds: 40 })];
  const out = bar.applyMomentBar(rows);
  assert.deepStrictEqual(out.kept.map((h) => h.type), ['missed_opportunity', 'buying_signal']);
  assert.deepStrictEqual(out.kept.map((h) => h.sequence_order), [1, 2]);
  assert.strictEqual(out.kept[0].bar_reason, 'a missed opportunity');
  assert.deepStrictEqual(out.dropped.map((h) => h.type), ['rapport_moment', 'disqualify_signal']);
  assert.notStrictEqual(out.kept, rows, 'a new array — a caller that drops the result keeps nothing');
});

// ── the worker: executed through sanitize → attach → bar, then pinned ─────────
test('the worker exposes the bar and applies it AFTER the arc fields (the buying-signal leg reads the verified cause) and BEFORE persist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const { stripComments } = require('../sweep/strip');
  const s = stripComments(src);
  const fn = s.indexOf('async function analyzeCall(');
  const attach = s.indexOf('sanitizedHighlights = attachArcFields(sanitizedHighlights, normalized.turns, normalized.speaker_confidence)', fn);
  const barAt = s.indexOf('sanitizedHighlights = applyMomentBarToCall(sanitizedHighlights, fathomCallId)', fn);
  const persist = s.indexOf('persistHighlights(admin, fathomCallId, userId, sanitizedHighlights)', fn);
  assert.ok(attach > fn && barAt > attach && persist > barAt, 'attach → bar → persist, in that order');
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v44-2026-09-05'/);
  const prompt = W._buildHighlightExtractorPrompt({ turns: [{ speaker: 'CLOSER', text: 'hi', start_seconds: 1 }], speaker_confidence: 'matched' });
  assert.ok(prompt.indexOf(bar.barPromptRule()) !== -1, 'the prompt carries the ONE bar rule from the lib');
  // executed: a rapport moment and an unevidenced buying signal never reach the rows a persist would write
  const kept = W._applyMomentBarToCall([M({ type: 'rapport_moment' }), M({ type: 'missed_opportunity' }), M({ type: 'buying_signal', cause: { move: 'none', none_reason: 'arrived_pre_sold' } })], 'call-x');
  assert.deepStrictEqual(kept.map((h) => h.type), ['missed_opportunity']);
});

test('the bar is not a delete: persistHighlights is untouched by it and an EMPTY survivor set preserves the existing rows (the no-wipe rule)', async () => {
  const kept = W._applyMomentBarToCall([M({ type: 'rapport_moment' })], 'call-y');
  assert.strictEqual(kept.length, 0);
  let deleted = false;
  const admin = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: 'old' }], error: null }) }), insert: async () => ({ error: null }), delete: () => ({ in: async () => { deleted = true; return { error: null }; } }) }) };
  const r = await W._persistHighlights(admin, 'call-y', 'u', kept);
  assert.strictEqual(r.kept_existing, true); assert.strictEqual(deleted, false);
});
