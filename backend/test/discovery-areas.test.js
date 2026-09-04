/**
 * The six fixed discovery items (v33).
 *
 * ⚠⚠ THE LOAD-BEARING TEST IS THE WIRING ONE. `withDiscoveryAreas` working in
 * isolation says nothing about whether the worker CALLS it — this codebase has
 * shipped a correct, never-invoked function more than once.
 *
 * ⚠ AND THE MERGED LIST MUST REACH ALL THREE CONSUMERS. The grader prompt,
 * `sanitizeCoverage` and `resolveWhatMattered` each validate against an area
 * list; if they disagree, a valid pick gets silently dropped.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../lib/discovery-areas');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function code(s) {
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the six are exactly Justin\'s checklist, in his order', () => {
  assert.deepStrictEqual(D.DISCOVERY_KEYS,
    ['pain', 'goals', 'current_situation', 'decision_makers', 'why_now', 'financial_resources']);
});

test('⚠ PAIN carries the logical-sale caveat — absent pain is not a failure', () => {
  const pain = D.DISCOVERY_AREAS.find(a => a.key === 'pain');
  assert.ok(/BOUGHT ON LOGIC/i.test(pain.label), 'the caveat must be in the label the grader sees');
  assert.ok(/NOT a failure/i.test(pain.label), 'and it must say so explicitly');
});

test('fixed six are ADDED to derived areas, never instead — what_mattered ranks the derived ones', () => {
  const derived = [{ key: 'income_goal_and_motivation', label: 'x' }, { key: 'previous_attempts', label: 'y' }];
  const merged = D.withDiscoveryAreas(derived);
  assert.strictEqual(merged.length, 8, 'six fixed plus two derived');
  D.DISCOVERY_KEYS.forEach(k => assert.ok(merged.some(a => a.key === k), 'missing fixed ' + k));
  derived.forEach(d => assert.ok(merged.some(a => a.key === d.key), 'dropped derived ' + d.key));
});

test('⚠ the six LEAD, so a colliding derived key loses and the STABLE key wins', () => {
  const merged = D.withDiscoveryAreas([{ key: 'pain', label: 'a derived pain that would drift' }]);
  assert.strictEqual(merged.filter(a => a.key === 'pain').length, 1, 'no duplicate key');
  assert.strictEqual(merged[0].key, 'pain');
  assert.ok(/BOUGHT ON LOGIC/i.test(merged[0].label), 'the FIXED label survives, not the derived one');
});

test('the six are present even when derivation returns nothing — that is the whole point', () => {
  [[], null, undefined].forEach(v => {
    const m = D.withDiscoveryAreas(v);
    assert.strictEqual(m.length, 6, 'six with input ' + JSON.stringify(v));
  });
});

test('⚠ THE WORKER ACTUALLY CALLS IT — a function nothing invokes is the recurring failure', () => {
  const w = code(read('lib/analysis-worker.js'));
  assert.ok(/withDiscoveryAreas \} = require\('\.\/discovery-areas'\)/.test(w), 'must be imported');
  assert.ok(/coachingAreas = withDiscoveryAreas\(coachingAreas\)/.test(w), 'must be applied to the area list');
  // ⚠ AFTER the try/catch: a failed derivation must not cost the six.
  const catchAt = w.indexOf('coaching-area lookup failed');
  const mergeAt = w.indexOf('coachingAreas = withDiscoveryAreas(');
  assert.ok(catchAt !== -1 && mergeAt > catchAt,
    'the merge must run AFTER the derivation catch, so a failure still leaves the six');
});

test('⚠ all THREE consumers receive the SAME merged list, or a valid pick is silently dropped', () => {
  const w = code(read('lib/analysis-worker.js'));
  assert.ok(/buildSectionGraderPrompt\([^)]*coachingAreas/.test(w), 'the grader prompt');
  assert.ok(/sanitizeCoverage\(graderParsed\.coverage, coachingAreas\)/.test(w), 'the coverage sanitiser');
  assert.ok(/areas: coachingAreas/.test(w), 'and what_mattered');
});

test('the six drive NO score — the coverage block carries that prohibition', () => {
  const w = read('lib/analysis-worker.js');
  const at = w.indexOf("'  - coverage:");
  assert.ok(at !== -1, 'the coverage instruction must exist');
  const block = w.slice(at, at + 1400);
  assert.ok(block.length > 500, 'slice must cover the instruction: ' + block.length);
  assert.ok(/must not influence any section score/i.test(block),
    'capture only — the prohibition is what makes this additive');
});

test('the version bump ships with the change', () => {
  const w = read('lib/analysis-worker.js');
  assert.ok(/ANALYSIS_PROMPT_VERSION = 'v43-2026-09-04'/.test(w));
  assert.ok(/NOT A SEVENTH FIELD/.test(w), 'the reasoning must travel with the bump');
});

/* ── v34: two customer-visible defects, both one-line prompt rules ───────── */

test('⚠ why_outcome may not name the prospect — the "Gary" defect', () => {
  const w = require('../lib/analysis-worker');
  const p = w._buildSectionGraderPrompt(
    { turns: [{ text: 'hi', speaker: 'CLOSER', start_seconds: 0 }], highlights: [] }, 600, '', [], {});
  assert.ok(/NEVER NAME THE PROSPECT IN `reason`/.test(p), 'the rule must be in the built prompt');
  assert.ok(/prospect_name` is the field that carries a name contract/.test(p),
    'and must say WHY — two rules that can disagree is the defect itself');
});

test('⚠ an observation timestamp must be [HH:MM:SS], never raw seconds', () => {
  const w = require('../lib/analysis-worker');
  const e = w._buildHighlightExtractorPrompt({ turns: [{ text: 'hi', speaker: 'CLOSER', start_seconds: 0 }] });
  assert.ok(/NEVER a raw seconds number/.test(e), 'the format must be pinned');
  assert.ok(/3598/.test(e), 'and the real observed output is named so the rule is concrete');
});
