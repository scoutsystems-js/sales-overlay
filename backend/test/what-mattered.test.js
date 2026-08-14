/**
 * 7d — "the question that mattered", per call.
 *
 * Justin's target: "You asked X and Y; given this prospect said they were a
 * counselor with a practice, the question that mattered was Z."
 *
 * Shape ruling: it names a structured area_key and cites the prospect's own
 * PROVEN quote as the reason. Never free text — free text cannot be checked,
 * cannot be filtered against the example library (7e), and reads plausibly
 * whether or not it is right.
 *
 * If no uncovered area has a proven reason, it emits NOTHING rather than
 * reaching for the nearest plausible pairing.
 */
const test = require('node:test');
const assert = require('node:assert');
const worker = require('../lib/analysis-worker');

const resolveWhatMattered = worker._resolveWhatMattered;
const detectRoleInversion = worker._detectRoleInversion;

const AREAS = [
  { key: 'income_goal_and_motivation', label: 'Income goal & motivation' },
  { key: 'financial_qualification', label: 'Financial qualification' },
];

// Turns carrying resolved roles, as a matched normalize produces.
const TURNS = [
  { display_name: 'Joshua Pinner', speaker: 'CLOSER', text: 'So what are you hoping this does for you?' },
  { display_name: 'Leonard', speaker: 'PROSPECT', text: 'I run a counseling practice and I want out of the day job.' },
  { display_name: 'Joshua Pinner', speaker: 'CLOSER', text: 'I own a primary residence over in Central Florida.' },
];

const COVERAGE = [
  { area_key: 'income_goal_and_motivation', covered: false, evidence: null, evidence_verified: false },
  { area_key: 'financial_qualification', covered: true, evidence: 'I have fifteen saved', evidence_verified: true },
];

function ctx(over) {
  return Object.assign({ attribute: 'runs a counseling practice', evidence: 'I run a counseling practice and I want out of the day job.', evidence_verified: true }, over);
}

// ─── what_mattered ─────────────────────────────────────────────────────────

test('an UNCOVERED area with a proven prospect quote is accepted', () => {
  const out = resolveWhatMattered(
    { area_key: 'income_goal_and_motivation', reason_evidence: 'I run a counseling practice and I want out of the day job.' },
    { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' });
  assert.ok(out);
  assert.strictEqual(out.area_key, 'income_goal_and_motivation');
  assert.strictEqual(out.reason_verified, true);
  assert.ok(out.reason_evidence.indexOf('counseling practice') !== -1);
});

test('an area that was COVERED is rejected — it is not a gap', () => {
  const out = resolveWhatMattered(
    { area_key: 'financial_qualification', reason_evidence: 'I run a counseling practice and I want out of the day job.' },
    { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' });
  assert.strictEqual(out, null);
});

test('an area the rep does not have is rejected', () => {
  const out = resolveWhatMattered(
    { area_key: 'invented_area', reason_evidence: 'I run a counseling practice and I want out of the day job.' },
    { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' });
  assert.strictEqual(out, null);
});

test('a reason quote that does NOT reconstruct is rejected — emit nothing', () => {
  const out = resolveWhatMattered(
    { area_key: 'income_goal_and_motivation', reason_evidence: 'the prospect wanted more from life' },
    { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' });
  assert.strictEqual(out, null, 'a paraphrased reason must not be presented as the prospect saying it');
});

test('a reason quote spoken by the CLOSER is rejected', () => {
  // The reason must be what THIS PROSPECT said about themselves. The closer's
  // own words cannot justify what the prospect needed.
  const out = resolveWhatMattered(
    { area_key: 'income_goal_and_motivation', reason_evidence: 'I own a primary residence over in Central Florida.' },
    { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' });
  assert.strictEqual(out, null);
});

test('nothing is emitted when every area was covered', () => {
  const allCovered = COVERAGE.map((c) => Object.assign({}, c, { covered: true }));
  const out = resolveWhatMattered(
    { area_key: 'income_goal_and_motivation', reason_evidence: 'I run a counseling practice and I want out of the day job.' },
    { coverage: allCovered, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' });
  assert.strictEqual(out, null);
});

test('malformed model output degrades to nothing, never throws', () => {
  [null, undefined, 'text', 42, {}, { area_key: 'income_goal_and_motivation' }].forEach((junk) => {
    assert.strictEqual(
      resolveWhatMattered(junk, { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'matched' }),
      null, 'junk: ' + JSON.stringify(junk));
  });
});

test('on an UNKNOWN-speaker call nothing is emitted — the reason cannot be attributed', () => {
  const out = resolveWhatMattered(
    { area_key: 'income_goal_and_motivation', reason_evidence: 'I run a counseling practice and I want out of the day job.' },
    { coverage: COVERAGE, areas: AREAS, turns: TURNS, speakerConfidence: 'unknown' });
  assert.strictEqual(out, null);
});

// ─── role inversion ────────────────────────────────────────────────────────

test('a normal call is NOT flagged as inverted', () => {
  const r = detectRoleInversion([ctx(), ctx({ attribute: 'wants out of day job' })], TURNS, 'matched');
  assert.strictEqual(r.inverted, false);
});

test('a call where the CLOSER supplies the prospect attributes IS flagged', () => {
  // Live case: on a role-inverted call the recorded user is the one being sold
  // to, so "I own a primary residence" and "I have cash on hand" — his own
  // disclosures — get reported as the prospect's situation.
  const inverted = [
    ctx({ attribute: 'owns primary residence', evidence: 'I own a primary residence over in Central Florida.' }),
    ctx({ attribute: 'has cash on hand', evidence: 'I own a primary residence over in Central Florida.' }),
  ];
  const r = detectRoleInversion(inverted, TURNS, 'matched');
  assert.strictEqual(r.inverted, true);
  assert.strictEqual(r.closer_spoken, 2);
});

test('inversion needs the CLOSER to OUTWEIGH the prospect, not merely appear', () => {
  // One closer-spoken attribute among several prospect ones is an extraction
  // slip, not an inverted call. Flagging it would suppress coaching on a
  // perfectly normal call.
  const mixed = [
    ctx(),
    ctx({ attribute: 'wants out of day job' }),
    ctx({ attribute: 'owns residence', evidence: 'I own a primary residence over in Central Florida.' }),
  ];
  assert.strictEqual(detectRoleInversion(mixed, TURNS, 'matched').inverted, false);
});

test('an UNPROVEN attribute is not evidence of inversion — it is just a paraphrase', () => {
  // The detector keys on WHO SPOKE the line, not on whether it verified.
  // Treating unverified quotes as inversion would flag any call where the
  // model paraphrased.
  const vague = [ctx({ evidence: 'something never said on this call at all' }), ctx({ evidence: 'also never said here' })];
  assert.strictEqual(detectRoleInversion(vague, TURNS, 'matched').inverted, false);
});

test('inversion is never claimed without deterministic speakers', () => {
  const inverted = [ctx({ evidence: 'I own a primary residence over in Central Florida.' })];
  assert.strictEqual(detectRoleInversion(inverted, TURNS, 'unknown').inverted, false);
});

test('empty context is not inversion', () => {
  assert.strictEqual(detectRoleInversion([], TURNS, 'matched').inverted, false);
  assert.strictEqual(detectRoleInversion(null, TURNS, 'matched').inverted, false);
});

// ─── wiring guards ─────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');

test('GUARD: the review API selects what_mattered and role_inverted', () => {
  // This omission has shipped twice (Part 1b's `section`, 2b's `id`). Here the
  // panel would simply never render, and "no coaching yet" is indistinguishable
  // from "the column was not selected".
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const sel = src.match(/\.select\('status, prospect_name[^']*'\)/);
  assert.ok(sel, 'review select not found');
  ['what_mattered', 'role_inverted'].forEach((col) => {
    assert.ok(sel[0].indexOf(col) !== -1, 'review select must include ' + col);
  });
});

test('the 7d panel is out of the render path', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.strictEqual((html.match(/^  function renderWhatMatteredHtml/gm) || []).length, 0,
    'removed from the render path 2026-08-14 — Call Highlights only');
  assert.strictEqual((html.match(/^\s*\+ renderWhatMatteredHtml/gm) || []).length, 0);
  assert.ok(/REMOVED FROM THE RENDER PATH 2026-08-14/.test(html), 'commented in place, not deleted');
});

test('but what_mattered KEEPS being written — rendering decision, not data', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  assert.ok(/what_mattered:\s+whatMattered/.test(src), 'the field must still persist');
});

test('RULING GUARD: what_mattered never reaches selling-context', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'selling-context.js'), 'utf8');
  ['what_mattered', 'role_inverted'].forEach((token) => {
    assert.ok(src.indexOf(token) === -1, 'selling-context must not reference ' + token + ' — KB ruling 1');
  });
});

test('RULING GUARD: what_mattered drives no score', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const scoreLines = src.split('\n').filter((l) =>
    /(overall_score|_score|close_score_earned)\s*[:=]/.test(l) && /(what_mattered|whatMattered|role_inverted|roleInv)/.test(l));
  assert.deepStrictEqual(scoreLines, [], 'a score must not be computed from what_mattered');
});
