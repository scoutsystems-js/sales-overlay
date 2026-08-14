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

test('the trace is asked for ONLY when the rep has derived areas', () => {
  assert.ok(!/missed_cue/.test(worker._buildSectionGraderPrompt(FAKE, 1800, '', [])),
    'a rep with no material must not be asked to trace anything');
  assert.ok(/- missed_cue:/.test(worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS)));
});

test('the prompt tells the model to DECLINE, and says why', () => {
  // With 25 of 39 calls carrying 2+ gaps this is a real choice — but calls with
  // exactly one gap still exist and must not force a link.
  const line = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS).split('\n').find(l => l.indexOf('- missed_cue:') !== -1);
  assert.ok(/RETURN null FREELY/i.test(line), 'declining must be made easy, not grudging');
  assert.ok(/Proximity in time is NOT causation/i.test(line),
    'must state the distinction explicitly — with 87% of calls eligible, over-firing is now the risk');
  assert.ok(/Do not reach for the nearest available pair/i.test(line), 'must name the specific failure mode');
});

test('the obstacle quote must be the PROSPECT\'s own words, verbatim', () => {
  const line = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS).split('\n').find(l => l.indexOf('- missed_cue:') !== -1);
  assert.ok(/PROSPECT\\?'S OWN lines/i.test(line), 'BOTH quotes must be the prospect');
  assert.ok(/contiguous run of words/i.test(line));
});

test('validation reuses the PROVING primitive, and the gap is deterministic', () => {
  // resolveWhatMattered's area checks do not apply — there is no area here. What
  // carries over is labelForQuote, applied to BOTH quotes, plus a separation
  // check that is arithmetic rather than judgement.
  assert.ok(/cueRole = labelForQuote\(normalized\.turns, rawTrace\.cue_quote\)/.test(SRC));
  assert.ok(/obsRole = labelForQuote\(normalized\.turns, rawTrace\.obstacle_quote\)/.test(SRC));
  assert.ok(/cueRole !== 'PROSPECT' \|\| obsRole !== 'PROSPECT'/.test(SRC), 'both must be the prospect');
  assert.ok(/obsTs - cueTs < MIN_CUE_GAP_SECONDS/.test(SRC), 'the gap must be enforced in code');
  assert.ok(!/function resolveBarrierTrace/.test(SRC), 'a second validator must not exist');
});

test('the separation threshold is derived and documented, not a round guess', () => {
  assert.ok(/MIN_CUE_GAP_SECONDS = 120/.test(SRC));
  assert.ok(/top out at 101s/.test(SRC), 'the derivation must be recorded beside the constant');
  assert.ok(/SECTION constraint[\s\S]{0,200}REJECTED/.test(SRC), 'the rejected alternative must be recorded too');
});

test('the trace is suppressed on a role-inverted call', () => {
  assert.ok(/!roleInv\.inverted && rawTrace/.test(SRC));
});

// ─── the surface: wording is the load-bearing part ─────────────────────────

test('the panel states the two facts and does NOT assert causation', () => {
  assert.ok(/They said/.test(PANEL), 'must show the cue');
  assert.ok(/min later/.test(PANEL), 'must show how much later the obstacle came');
  assert.ok(/didn.{1,8}t qualify on it/i.test(PANEL), 'the message Justin specified');
  assert.ok(/where the time went/i.test(PANEL), 'the message Justin specified');
  assert.ok(/not proof the deal was winnable/i.test(PANEL), 'must refuse the you-would-have-closed-it reading');
  // Nothing that reads as a finding.
  [/because you/i, /cost you/i, /caused/i, /this is why/i, /led to/i].forEach(rx => {
    assert.ok(!rx.test(PANEL), 'panel must not assert causation: ' + rx);
  });
});

test('the panel renders nothing without a validated trace', () => {
  assert.ok(/if \(!t \|\| !t\.cue_quote \|\| !t\.obstacle_quote\) return '';/.test(PANEL),
    'a partial trace must render nothing rather than half a claim');
});

test('GUARD: the review API selects barrier_trace', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const sel = src.match(/\.select\('status, prospect_name[^']*'\)/);
  assert.ok(sel && sel[0].indexOf('barrier_trace') !== -1, 'select must include barrier_trace');
});
