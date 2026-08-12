/**
 * 7c — the coverage map and prospect context.
 *
 * Both are structured, checkable, and DRIVE NOTHING yet: no score, no grade, no
 * surface. That is the discipline that made qualification_covered work after
 * three attempts to express the same intent as score nudging failed against a
 * ±14 noise floor.
 *
 * The evidence rule is the load-bearing part. `evidence_verified` is set at
 * WRITE TIME by quote-locate, not by the model's opinion of its own quote —
 * because under v13 wording only 17% of the grader's evidence quotes could be
 * reconstructed from the transcript at all.
 */
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const AREAS = [
  { key: 'financial_qualification', label: 'Financial qualification' },
  { key: 'timeline_and_readiness', label: 'Timeline & readiness' },
];
const sanitizeCoverage = worker._sanitizeCoverage;
const sanitizeProspectContext = worker._sanitizeProspectContext;

// ─── coverage ──────────────────────────────────────────────────────────────

test('a well-formed entry survives intact', () => {
  const out = sanitizeCoverage([{ area_key: 'financial_qualification', covered: true, evidence: 'I have fifteen thousand saved' }], AREAS);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].area_key, 'financial_qualification');
  assert.strictEqual(out[0].covered, true);
  assert.strictEqual(out[0].evidence, 'I have fifteen thousand saved');
  assert.strictEqual(out[0].evidence_verified, false, 'verification happens later, at write time — never assumed here');
});

test('an area the rep does not have is DROPPED, not invented into the map', () => {
  const out = sanitizeCoverage([{ area_key: 'astrological_sign', covered: true, evidence: 'x' }], AREAS);
  assert.deepStrictEqual(out, []);
});

test('area keys are matched after normalising, so casing drift does not lose a row', () => {
  const out = sanitizeCoverage([{ area_key: 'Financial Qualification', covered: true, evidence: 'saved fifteen thousand' }], AREAS);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].area_key, 'financial_qualification');
});

test('covered must be a real boolean — junk is treated as NOT covered', () => {
  ['yes', 1, null, undefined, {}].forEach((junk) => {
    const out = sanitizeCoverage([{ area_key: 'financial_qualification', covered: junk, evidence: 'q' }], AREAS);
    assert.strictEqual(out[0].covered, false, 'junk: ' + JSON.stringify(junk));
  });
});

test('evidence is dropped when the area was NOT covered', () => {
  const out = sanitizeCoverage([{ area_key: 'financial_qualification', covered: false, evidence: 'stray quote' }], AREAS);
  assert.strictEqual(out[0].evidence, null);
});

test('COVERED-WITHOUT-EVIDENCE stays covered but unproven — it must not manufacture a gap', () => {
  // qualification_covered flips true->false when the quote is missing, and that
  // is right THERE because it drives nothing. Here it would be wrong: 7d ranks
  // UNCOVERED areas into "the question that mattered", so flipping an
  // unsupported claim to false would invent a gap and coach the rep on it.
  // Claiming coverage without proof and asserting a miss are both assertions;
  // we make neither. The row stays covered, with no displayable quote.
  const out = sanitizeCoverage([{ area_key: 'financial_qualification', covered: true, evidence: '  ' }], AREAS);
  assert.strictEqual(out[0].covered, true);
  assert.strictEqual(out[0].evidence, null);
  assert.strictEqual(out[0].evidence_verified, false);
});

test('duplicate areas collapse to the first entry', () => {
  const out = sanitizeCoverage([
    { area_key: 'financial_qualification', covered: true, evidence: 'first' },
    { area_key: 'financial_qualification', covered: false, evidence: null },
  ], AREAS);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].evidence, 'first');
});

test('malformed input degrades to an empty map, never throws', () => {
  [null, undefined, 'text', 42, {}].forEach((junk) => {
    assert.deepStrictEqual(sanitizeCoverage(junk, AREAS), []);
  });
  assert.deepStrictEqual(sanitizeCoverage([null, 'x', 5], AREAS), []);
});

test('no areas means no coverage map — a rep with no material gets nothing', () => {
  assert.deepStrictEqual(sanitizeCoverage([{ area_key: 'anything', covered: true, evidence: 'q' }], []), []);
  assert.deepStrictEqual(sanitizeCoverage([{ area_key: 'anything', covered: true, evidence: 'q' }], null), []);
});

// ─── prospect_context ──────────────────────────────────────────────────────

test('a well-formed attribute survives, unverified until write time', () => {
  const out = sanitizeProspectContext([{ attribute: 'runs a counseling practice', evidence: 'I have had my own practice six years' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].attribute, 'runs a counseling practice');
  assert.strictEqual(out[0].evidence_verified, false);
});

test('an attribute with NO evidence is dropped — the whole point is groundedness', () => {
  // Unlike coverage, an unsupported attribute has no useful meaning: 7d would
  // use it to justify which question mattered, citing nothing.
  const out = sanitizeProspectContext([
    { attribute: 'wealthy', evidence: null },
    { attribute: 'has a practice', evidence: 'I run a practice downtown' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].attribute, 'has a practice');
});

test('the attribute list is capped at 3', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ attribute: 'attr ' + i, evidence: 'evidence line ' + i }));
  assert.strictEqual(sanitizeProspectContext(many).length, 3);
});

test('malformed prospect context degrades to empty, never throws', () => {
  [null, undefined, 'text', 42, {}].forEach((junk) => {
    assert.deepStrictEqual(sanitizeProspectContext(junk), []);
  });
});

// ─── the prompt contract ───────────────────────────────────────────────────

const FAKE = { turns: [{ speaker: 'CLOSER', display_name: 'C', text: 'hello there friend', start_seconds: 1 }], highlights: [], closer_name: 'C', speaker_confidence: 'matched' };

test('with NO areas the grader is never asked for a coverage map', () => {
  // A rep with no material must not be asked to assess ground nobody defined —
  // that is where an invented rubric would come from.
  const p = worker._buildSectionGraderPrompt(FAKE, 1800, '', []);
  assert.ok(!/- coverage:/.test(p), 'coverage must be absent when there are no areas');
  assert.ok(!/- prospect_context:/.test(p), 'prospect_context rides the same block');
});

test('with areas, the grader is asked for coverage over EXACTLY those areas', () => {
  const p = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS);
  assert.ok(/- coverage:/.test(p));
  assert.ok(p.indexOf('financial_qualification') !== -1);
  assert.ok(p.indexOf('timeline_and_readiness') !== -1);
});

test('coverage is assessed BY ANY ROUTE and forbidden from moving a score', () => {
  // Justin's principle: conversations flow and are all different. Reuses v12's
  // proven wording rather than inventing a second, subtly different rule.
  const p = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS);
  const line = p.split('\n').find((l) => l.indexOf('BY ANY conversational route') !== -1 && l.indexOf('coverage') === -1);
  assert.ok(/BY ANY conversational route/.test(p));
  assert.ok(/No specific words, figures or criteria need to appear/.test(p));
  assert.ok(/must not influence any section score/i.test(p));
});

test('coverage evidence inherits the v14 verbatim contract', () => {
  const p = worker._buildSectionGraderPrompt(FAKE, 1800, '', AREAS);
  const cov = p.split('\n').filter((l) => l.indexOf('evidence:') !== -1);
  assert.ok(cov.some((l) => /contiguous run of words/.test(l)), 'evidence must demand an exact span');
});

// ─── KB ruling 1: coaching output must never become grader input ───────────

test('RULING GUARD: selling-context never reads the coaching fields', () => {
  // The mirror of kb-hash-guard. SELLING CONTEXT tells the grader not to
  // penalise approaches the material endorses — so feeding it a coverage map
  // would let the grader excuse the very gaps the map exists to surface. The
  // failure would be invisible: scores would drift and nothing would error.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'selling-context.js'), 'utf8');
  ['coverage', 'prospect_context', 'coaching_area', 'coaching-areas'].forEach((token) => {
    assert.ok(src.indexOf(token) === -1,
      'selling-context must not reference ' + token + ' — KB ruling 1');
  });
});

test('RULING GUARD: the coverage rubric sits OUTSIDE the selling-context material', () => {
  // Belt and braces. The selling-context block is pasted at the TOP of the
  // prompt as the closer's own material, prefaced by "do not penalise
  // approaches this material endorses". The coverage rubric must land with the
  // call-level FIELD INSTRUCTIONS further down — never inside that material,
  // where the grader would read its own marking scheme as something it has
  // been told to be lenient about.
  const p = worker._buildSectionGraderPrompt(FAKE, 1800, 'OFFER_MATERIAL_MARKER', AREAS);
  const material = p.indexOf('OFFER_MATERIAL_MARKER');
  const cov = p.indexOf('  - coverage:');
  const transcript = p.indexOf('TRANSCRIPT:');
  assert.ok(material !== -1 && cov !== -1 && transcript !== -1, 'prompt landmarks missing');
  assert.ok(cov > material, 'the rubric must not be embedded in the selling-context material');
  assert.ok(cov < transcript, 'the rubric belongs with the field instructions, above the transcript');

  // And it must sit among its peers, not orphaned somewhere else.
  const qual = p.indexOf('  - qualification_covered:');
  assert.ok(Math.abs(p.slice(0, qual).split('\n').length - p.slice(0, cov).split('\n').length) < 12,
    'coverage should be adjacent to the other call-level observation fields');
});

test('coverage and prospect_context DRIVE NOTHING — no score or grade reads them', () => {
  // The discipline that made qualification_covered safe: measured and read
  // before being wired to anything. If a future change makes a score depend on
  // coverage, this fails and the author has to justify it deliberately.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const scoreLines = src.split('\n').filter((l) =>
    /(overall_score|_score|close_score_earned)\s*[:=]/.test(l) &&
    /(coverage|prospect_context|coverageOut|prospectContextOut)/.test(l));
  assert.deepStrictEqual(scoreLines, [], 'a score must not be computed from the coverage map');
});
