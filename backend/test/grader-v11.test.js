// Grader v11 — the prospect_name field (PROSPECT NAMES 3b).
//
// The contract is deliberately the v7 follow-up-email greeting rule REUSED
// VERBATIM: transcript-only, null when unclear, never the meeting title. That
// rule was already proven in production (it is why the follow-up email greets
// "Jamie" on a call whose title says "Tasha"), so 3b inherits a known-good
// contract rather than inventing a second, subtly different one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');

test('ANALYSIS_PROMPT_VERSION is the current shipped version (v13)', () => {
  // House rule: a prompt change and its version bump are ONE atomic change. If
  // the constant lags the prompt, every downstream system lies coherently.
  //
  // This pin is a deliberate TRIPWIRE, kept strict on purpose: every bump must
  // consciously touch this line. v13 = 6a deterministic speaker labelling —
  // the template is unedited but the prompt STRING changes (closer identified
  // by name, transcript lines prefixed CLOSER/PROSPECT instead of raw names).
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v13-2026-08-11'/);
});

test('the grader asks for prospect_name and declares it in the JSON shape', () => {
  assert.ok(/- prospect_name:/.test(src), 'field instruction missing');
  assert.ok(/"prospect_name": "\.\.\." \| null/.test(src), 'JSON shape entry missing');
});

test('the prospect_name rule is TRANSCRIPT-ONLY and forbids the meeting title', () => {
  const line = src.split('\n').find((l) => l.indexOf('- prospect_name:') !== -1);
  assert.ok(line, 'prospect_name instruction not found');
  assert.ok(/IN THE TRANSCRIPT/.test(line), 'must anchor the name to the transcript');
  assert.ok(/return null/.test(line), 'must return null when unclear rather than guessing');
  assert.ok(/[Nn]ever take a name from the meeting title/.test(line), 'must forbid the meeting title — the entire bug');
});

test('a couple returns as ONE joined name (ruling: couples are one prospect)', () => {
  const line = src.split('\n').find((l) => l.indexOf('- prospect_name:') !== -1);
  assert.ok(/ONE prospect/.test(line));
  assert.ok(/ and /.test(line), 'must specify the join form');
});

test('the grader name is fed into the resolver, not written directly', () => {
  // Precedence, rejection rules and the couples cap all live in
  // lib/prospect-name.js. Writing graderParsed.prospect_name straight to the
  // column would bypass every one of them.
  assert.ok(/graderName:\s+\(typeof graderParsed\.prospect_name === 'string'\)/.test(src),
    'grader name must be passed to resolveProspectName');
  assert.ok(/prospect_name:\s+resolvedProspect\.name/.test(src),
    'the persisted value must come from the resolver');
});

test('v11 is ADDITIVE — the scoring/outcome instructions are untouched', () => {
  // Why no delta-gate is needed. Same reasoning that let v10 ship without one.
  assert.ok(/ADDITIVE/.test(src));
  assert.ok(/85-100: exceptional/.test(src), 'the anchored rubric must still be present');
  assert.ok(/25-35% close rate is STRONG/.test(src), 'domain context must still be present');
});

// ── v12: qualification_covered — a MEASUREMENT-ONLY structured field ──────
// Adopted because three attempts to encode this as grader WORDING failed: the
// intended effect is smaller than the grader's noise floor, so it could not be
// validated by score deltas. A boolean with a quote can be validated by reading.
const worker = require('../lib/analysis-worker');

test('v12: the field is requested, with a quote, and declared in the JSON shape', () => {
  const line = src.split('\n').find((l) => l.indexOf('- qualification_covered:') !== -1);
  assert.ok(line, 'qualification_covered instruction missing');
  assert.ok(/financial position/i.test(line));
  assert.ok(/quoted verbatim/i.test(line), 'must demand a verbatim quote as evidence');
  assert.ok(/"qualification_covered": \{"financial": true\|false/.test(src), 'JSON shape entry missing');
});

test('v12: the field is framed as an OBSERVATION that must not move any score', () => {
  // This is what keeps it measurement-only. Without it the model may treat the
  // observation as a judgement and let it bleed into the section scores — which
  // is precisely the coupling that made the wording attempts unmeasurable.
  const line = src.split('\n').find((l) => l.indexOf('- qualification_covered:') !== -1);
  assert.ok(/OBSERVATION, NOT A JUDGEMENT/.test(line));
  assert.ok(/must not influence any section score/i.test(line));
});

test('v12: credit is given for ANY conversational route, not specific words', () => {
  const line = src.split('\n').find((l) => l.indexOf('- qualification_covered:') !== -1);
  assert.ok(/BY ANY conversational route/.test(line));
  assert.ok(/No specific words, figures or criteria need to appear/.test(line));
});

test('v12: anti-literal-matching guidance is present and is PROHIBITIVE, not permissive', () => {
  // The one-sided "credit any route, count FULLY" phrasing read as general
  // leniency and lifted every section by 7 points. This wording only ever
  // REMOVES a penalty; it must never instruct extra generosity.
  const line = src.split('\n').find((l) => l.indexOf('HOW TO JUDGE EVERY SECTION') !== -1 && l.indexOf('DO NOT REDUCE') !== -1);
  assert.ok(line, 'guidance line missing');
  assert.ok(/DO NOT REDUCE/.test(line));
  assert.ok(/does NOT make you more generous overall/.test(line));
  assert.ok(!/count FULLY/.test(src), 'the rejected permissive phrasing is back');
});

test('sanitizeQualificationCovered FAILS CLOSED on anything malformed', () => {
  const f = worker._sanitizeQualificationCovered;
  for (const junk of [null, undefined, 'yes', 42, [], {}]) {
    assert.deepStrictEqual(f(junk), { financial: false, evidence: null }, 'junk: ' + JSON.stringify(junk));
  }
});

test('sanitizeQualificationCovered rejects a TRUE with no supporting quote', () => {
  // Over-reporting coverage defeats the entire purpose — the field exists to
  // measure how often the ground is genuinely covered.
  assert.deepStrictEqual(worker._sanitizeQualificationCovered({ financial: true }), { financial: false, evidence: null });
  assert.deepStrictEqual(worker._sanitizeQualificationCovered({ financial: true, evidence: '  ' }), { financial: false, evidence: null });
});

test('sanitizeQualificationCovered keeps a well-formed observation', () => {
  const out = worker._sanitizeQualificationCovered({ financial: true, evidence: 'I have about 15k set aside for this' });
  assert.strictEqual(out.financial, true);
  assert.strictEqual(out.evidence, 'I have about 15k set aside for this');
});

test('sanitizeQualificationCovered drops evidence when financial is false', () => {
  assert.deepStrictEqual(worker._sanitizeQualificationCovered({ financial: false, evidence: 'stray' }), { financial: false, evidence: null });
});
