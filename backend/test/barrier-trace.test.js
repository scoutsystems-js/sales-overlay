/**
 * 8c/8d — tracing a late obstacle back to ground never established.
 *
 * Justin's target: "the lender only approved $5,000 — and financial
 * qualification was never established in discovery, which is where that would
 * have surfaced."
 *
 * Held until the data made the link a real choice rather than a forced one:
 * with 0/1/1 uncovered areas per call it was forced; 25 of 39 mapped calls now
 * carry 2+ uncovered areas.
 *
 * Validation REUSES resolveWhatMattered — obstacle_quote takes the
 * reason_evidence slot — so there is exactly one chain, not two that can drift.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const worker = require('../lib/analysis-worker');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const PANEL = HTML.slice(HTML.indexOf('function renderBarrierTraceHtml'), HTML.indexOf('// ─── 8b: risk signals'));

const FAKE = { turns: [{ speaker: 'CLOSER', display_name: 'C', text: 'hello there friend', start_seconds: 1 }], highlights: [], closer_name: 'C', speaker_confidence: 'matched' };
const AREAS = [{ key: 'financial_qualification', label: 'Financial qualification' }];

const pick = worker._selectMissedCuePair;
const GAP = worker.MIN_CUE_GAP_SECONDS;

function cue(over) {
  return Object.assign({ type: 'risk_signal', handling: 'deflected', speaker_verified: true,
    timestamp_seconds: 100, quote: 'I have only a couple of thousand ready right now' }, over);
}
function obstacle(over) {
  return Object.assign({ type: 'barrier', speaker_verified: true,
    timestamp_seconds: 1000, quote: 'it says we are unable to approve you for the offer' }, over);
}

test('pairs an unaddressed cue with a later obstacle', () => {
  const r = pick([cue(), obstacle()], GAP);
  assert.ok(r);
  assert.strictEqual(r.gap_seconds, 900);
  assert.ok(r.cue_quote.indexOf('couple of thousand') !== -1);
});

test('an ADDRESSED cue is not a missed cue', () => {
  // That is shape (b), deferred as its own stage — `addressed` is far too weak
  // a proxy for "dug and the prospect genuinely had nothing".
  assert.strictEqual(pick([cue({ handling: 'addressed' }), obstacle()], GAP), null);
  assert.strictEqual(pick([cue({ handling: null }), obstacle()], GAP), null);
});

test('IGNORED counts as missed, alongside deflected', () => {
  assert.ok(pick([cue({ handling: 'ignored' }), obstacle()], GAP));
});

test('the separation threshold is enforced', () => {
  // Derived, not rounded: degenerate pairs top out at 101s, the next genuine
  // one is 183s, so 120 sits in an observed empty band.
  assert.strictEqual(GAP, 120);
  assert.strictEqual(pick([cue({ timestamp_seconds: 100 }), obstacle({ timestamp_seconds: 201 })], GAP), null, '101s must be rejected');
  assert.ok(pick([cue({ timestamp_seconds: 100 }), obstacle({ timestamp_seconds: 283 })], GAP), '183s must be accepted');
});

test('an obstacle BEFORE the cue is never paired', () => {
  assert.strictEqual(pick([cue({ timestamp_seconds: 2000 }), obstacle({ timestamp_seconds: 100 })], GAP), null);
});

test('UNPROVEN quotes are excluded — the panel quotes both as the prospect', () => {
  assert.strictEqual(pick([cue({ speaker_verified: false }), obstacle()], GAP), null);
  assert.strictEqual(pick([cue(), obstacle({ speaker_verified: null })], GAP), null);
});

test('SELECTION: earliest cue, and its FIRST qualifying obstacle', () => {
  // 44 pairs across 20 calls but only 24 distinct cues — the multiplication is
  // one cue against several later obstacles, so showing all is repetition.
  const r = pick([
    cue({ timestamp_seconds: 900, quote: 'a later cue about financing worries here' }),
    cue({ timestamp_seconds: 100, quote: 'the earliest cue about money set aside' }),
    obstacle({ timestamp_seconds: 2000, quote: 'the later obstacle about approval limits' }),
    obstacle({ timestamp_seconds: 1000, quote: 'the first obstacle about the loan amount' }),
  ], GAP);
  assert.ok(r.cue_quote.indexOf('earliest cue') !== -1, 'earliest cue anchors the story');
  assert.ok(r.obstacle_quote.indexOf('first obstacle') !== -1, 'first consequence, not the last — the last inflates the gap');
});

test('only ONE pair is returned per call', () => {
  const r = pick([cue(), obstacle(), obstacle({ timestamp_seconds: 1500 })], GAP);
  assert.ok(r && !Array.isArray(r));
});

test('the closer\'s own reply travels with the pair when it exists', () => {
  const r = pick([cue({ closer_response: 'But that is set aside for business, right?' }), obstacle()], GAP);
  assert.strictEqual(r.closer_said, 'But that is set aside for business, right?');
});

test('no cues or no obstacles yields nothing, never throws', () => {
  assert.strictEqual(pick([cue()], GAP), null);
  assert.strictEqual(pick([obstacle()], GAP), null);
  assert.strictEqual(pick([], GAP), null);
  assert.strictEqual(pick(null, GAP), null);
});

test('NO model decline step exists — the judgement was made at capture', () => {
  // Ruling 2026-08-13. Restoring a decline step would put the judgement back
  // where its evidence is not, which is what produced 0 links in 8 calls.
  assert.ok(!/missed_cue: did the PROSPECT/.test(SRC), 'the grader must not be asked for this');
  assert.ok(/selectMissedCuePair\(sanitizedHighlights/.test(SRC), 'it is paired in the worker');
});

// ─── the surface ───────────────────────────────────────────────────────────

test('the panel states the two facts and refuses the causal reading', () => {
  assert.ok(/They said/.test(PANEL), 'must show the cue');
  assert.ok(/min later/.test(PANEL), 'must show how much later it bit');
  assert.ok(/didn.{1,8}t qualify on it/i.test(PANEL), "Justin's wording");
  assert.ok(/where the time went/i.test(PANEL), "Justin's wording");
  assert.ok(/not proof the deal was winnable/i.test(PANEL), 'must refuse "you would have closed it"');
  [/because you/i, /cost you/i, /caused/i, /led to/i, /would have closed/i].forEach(rx => {
    assert.ok(!rx.test(PANEL), 'panel must not assert causation: ' + rx);
  });
});

test('the panel renders nothing without a complete pair', () => {
  assert.ok(/if \(!t \|\| !t\.cue_quote \|\| !t\.obstacle_quote\) return '';/.test(PANEL));
});

test('GUARD: the review API selects barrier_trace', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const sel = src.match(/\.select\('status, prospect_name[^']*'\)/);
  assert.ok(sel && sel[0].indexOf('barrier_trace') !== -1);
});
