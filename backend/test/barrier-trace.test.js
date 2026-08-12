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
  assert.ok(!/barrier_trace/.test(worker._buildSectionGraderPrompt(FAKE, 1800, '', [])),
    'a rep with no material must not be asked to trace anything');
  assert.ok(/- barrier_trace:/.test(worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS)));
});

test('the prompt tells the model to DECLINE, and says why', () => {
  // With 25 of 39 calls carrying 2+ gaps this is a real choice — but calls with
  // exactly one gap still exist and must not force a link.
  const line = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS).split('\n').find(l => l.indexOf('- barrier_trace:') !== -1);
  assert.ok(/RETURN null FREELY/i.test(line), 'declining must be made easy, not grudging');
  assert.ok(/AVAILABLE is not the same as it being the CAUSE/i.test(line),
    'must state the distinction explicitly — this is the whole risk');
  assert.ok(/only one, or the nearest one/i.test(line), 'must name the specific failure mode');
});

test('the obstacle quote must be the PROSPECT\'s own words, verbatim', () => {
  const line = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS).split('\n').find(l => l.indexOf('- barrier_trace:') !== -1);
  assert.ok(/PROSPECT\\?'S OWN line/i.test(line));
  assert.ok(/contiguous run of words/i.test(line));
});

test('ONE validation chain — the trace reuses resolveWhatMattered, not a copy', () => {
  // Two chains would drift. The obstacle quote is mapped onto reason_evidence
  // so it inherits area-exists, area-uncovered and proven-prospect-quote.
  assert.ok(/resolveWhatMattered\(\s*\n?\s*\{ area_key: rawTrace\.area_key, reason_evidence: rawTrace\.obstacle_quote \}/.test(SRC),
    'barrier_trace must be resolved through resolveWhatMattered');
  assert.ok(!/function resolveBarrierTrace/.test(SRC), 'a second validator must not exist');
});

test('the trace is suppressed on a role-inverted call', () => {
  assert.ok(/roleInv\.inverted \|\| !rawTrace/.test(SRC));
});

// ─── the surface: wording is the load-bearing part ─────────────────────────

test('the panel states the two facts and does NOT assert causation', () => {
  assert.ok(/Not established/.test(PANEL), 'must say what was uncovered');
  assert.ok(/Came up later/.test(PANEL), 'must say what showed up later');
  // Explicitly hands the judgement over.
  assert.ok(/your read, not ours/i.test(PANEL), 'the connection must be the closer\'s call');
  // Nothing that reads as a finding.
  [/because you/i, /cost you/i, /caused/i, /this is why/i, /led to/i].forEach(rx => {
    assert.ok(!rx.test(PANEL), 'panel must not assert causation: ' + rx);
  });
});

test('the panel renders nothing without a validated trace', () => {
  assert.ok(/if \(!t \|\| !t\.area_key \|\| !t\.obstacle_quote\) return '';/.test(PANEL),
    'a partial trace must render nothing rather than half a claim');
});

test('GUARD: the review API selects barrier_trace', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const sel = src.match(/\.select\('status, prospect_name[^']*'\)/);
  assert.ok(sel && sel[0].indexOf('barrier_trace') !== -1, 'select must include barrier_trace');
});
