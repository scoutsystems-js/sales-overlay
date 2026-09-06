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

/* ⚠ v24 -> v25 (2026-08-20): three follow_up_email DEFECT fixes — a
   no-prospect branch, mandatory paragraph breaks, and a pinned sign-off.
   A prompt edit and its version bump are ONE atomic change — a lagging
   version makes the DB stamp, the outdated count and the update button all
   agree with each other and all be wrong. */
test('ANALYSIS_PROMPT_VERSION is the current shipped version (v29)', () => {
  // House rule: a prompt change and its version bump are ONE atomic change. If
  // the constant lags the prompt, every downstream system lies coherently.
  //
  // This pin is a deliberate TRIPWIRE, kept strict on purpose: every bump must
  // consciously touch this line.
  // v27 = Justin's objection boundary in the extractor: cannot-afford is a
  // FINANCIAL DISQUALIFICATION (emitted as disqualify_signal), not a fear objection.
  // v28 = per-criterion qualification check — the grader COMPARES the prospect's
  // disclosure against the rep's own criteria, three verdicts, prospect-verified. v14 = verbatim quoting for every quoted field
  // the extractor emits. (v13 = 6a deterministic speaker labelling.)
  // v29 = BOTH SIDES OF EVERY MOMENT — closer_response is asked for on EVERY
  //       citable type, not just objection/risk_signal/barrier. Measured: of
  //       8,238 real moments only those three carried a reply, so 55% had no
  //       closer side and a synthesis claiming something about the CLOSER could
  //       only quote the PROSPECT. Grading-time change, so already-graded calls
  //       keep one-sided moments; a re-grade is the only route and Justin rules.
  // v30 = PER-MOMENT COACHING — a third model call writes call_highlights.coaching.
  //       ONE call per CALL covering all its moments, never one per moment.
  //       Additive: no existing prompt touched, no score moves, so no delta gate.
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v52-2026-09-05'/);
});

/* ⚠⚠ v25's three fixes, asserted on the BUILT PROMPT STRING rather than on the
   source file — per the note below, a comment that merely DISCUSSES a rule must
   not be able to satisfy the check. This file has a large v25 comment block
   naming all three, so a source scan would pass with the rules absent. */
test('⚠⚠ v25: the NO-PROSPECT branch reaches the model, with its exact string', () => {
  assert.ok(/NO-PROSPECT CASE/.test(GRADER_PROMPT),
    'the no-prospect branch is missing — the model is left to improvise, which '
    + 'is exactly how v24 put a greeting on a call with nobody to greet');
  // ⚠ THE EXACT STRING IS LOAD-BEARING, not decorative: item 3 (non-sales-call
  // tagging) needs a value a downstream reader can RECOGNISE. A paraphrase
  // that varies per run is unusable as a signal.
  assert.ok(GRADER_PROMPT.indexOf('No follow-up email — this recording has no prospect in it.') !== -1,
    'the fixed refusal string must be given verbatim, or it cannot be detected downstream');
  assert.ok(/no sign-off/i.test(GRADER_PROMPT) && /No greeting/.test(GRADER_PROMPT),
    'the branch must forbid a greeting AND a sign-off — the v24 defect was a greeting');
});

test('⚠ v25: paragraph breaks and the sign-off are stated as OPERATIONS', () => {
  // Mechanical ("a BLANK LINE"), never "well formatted" — the adjective-vs-
  // operation lesson, now proven four times in this prompt (v14, v17, v18, v25).
  assert.ok(/BLANK LINE/.test(GRADER_PROMPT),
    'paragraph separation must name the operation, not describe good formatting');
  assert.ok(/one unbroken block/.test(GRADER_PROMPT), 'the failure mode must be named');
  assert.ok(/SIGN-OFF/.test(GRADER_PROMPT) && /ONLY the closer's first name/.test(GRADER_PROMPT),
    'the sign-off must be pinned to one form — three live samples of the same '
    + 'closer signed "Joshua", "Josh" and "— Joshua"');
});

test('⚠ v25: the no-prospect branch did NOT displace the greeting rule', () => {
  // The two rules cover DIFFERENT cases (no name established vs no prospect at
  // all) and both must survive. Conflating them is what caused the defect.
  assert.ok(/Greeting rule: greet the prospect ONLY by the name/.test(GRADER_PROMPT),
    'the v7 greeting contract must still be present — v25 adds a branch beside '
    + 'it, it does not replace it');
});

// v14 assertions run against the BUILT PROMPT STRINGS, not the source file.
// Scanning source would let a comment that merely DISCUSSES the removed wording
// satisfy (or break) the check — the thing that matters is what the model reads.
const _w = require('../lib/analysis-worker');
const FAKE = { turns: [{ speaker: 'CLOSER', display_name: 'C', text: 'hello there', start_seconds: 1 }], highlights: [], closer_name: 'C', speaker_confidence: 'matched' };
const EXTRACTOR_PROMPT = _w._buildHighlightExtractorPrompt(FAKE);
const GRADER_PROMPT = _w._buildSectionGraderPrompt(FAKE, 1800, '');

test('v14: the verbatim contract is MECHANICAL, not just the word "verbatim"', () => {
  // closer_response already said "quoted verbatim" under v13 and still failed
  // reconstruction 67% of the time. The adjective does not work; the rule has
  // to describe the operation (copy a contiguous span from one line).
  assert.ok(/HOW TO QUOTE/.test(EXTRACTOR_PROMPT), 'the shared quoting contract is missing');
  assert.ok(/contiguous run of characters from ONE transcript line/.test(EXTRACTOR_PROMPT));
  assert.ok(/CUT FROM THE ENDS ONLY/.test(EXTRACTOR_PROMPT), 'shortening must be truncation, never stitching');
  assert.ok(/Do not merge two lines/.test(EXTRACTOR_PROMPT));
});

test('v14: the instructions that CAUSED paraphrasing are gone from BOTH prompts', () => {
  // "trim filler" licensed editing the words; the 30-word cap forced the model
  // to compress longer lines. Both produced quotes that begin verbatim and then
  // drift — 86% of sampled failures.
  [['extractor', EXTRACTOR_PROMPT], ['grader', GRADER_PROMPT]].forEach(function (pair) {
    assert.ok(!/trim filler/.test(pair[1]), pair[0] + ': "trim filler" authorises altering the quote');
    assert.ok(!/5-30 words/.test(pair[1]), pair[0] + ': the 30-word cap forces compression of longer lines');
  });
});

test('v14: the contract binds EVERY quoted field, not just the objection lane', () => {
  // Scope ruling: fixing only closer_response would repair one section and
  // leave the identical defect capping stored highlights, the review page's
  // decisive-moment quote, and harvested KB moments.
  const resp = EXTRACTOR_PROMPT.split('\n').find((l) => l.indexOf('- closer_response:') !== -1);
  assert.ok(resp, 'closer_response instruction not found');
  assert.ok(/contiguous verbatim span/.test(resp));
  assert.ok(/HOW TO QUOTE/.test(resp), 'must point at the shared contract rather than restating it loosely');

  // why_outcome.quote — rendered on the review page as the decisive moment.
  const why = GRADER_PROMPT.split('\n').find((l) => l.indexOf('• quote:') !== -1);
  assert.ok(why, 'why_outcome quote instruction not found');
  assert.ok(/CONTIGUOUS run of words copied EXACTLY/.test(why));

  // qualification_covered.evidence — the field whose whole value is checkability.
  const qual = GRADER_PROMPT.split('\n').find((l) => l.indexOf('- qualification_covered:') !== -1);
  assert.ok(/copied EXACTLY as a contiguous run of words/.test(qual));
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
  // v14 replaced the adjective "quoted verbatim" with the mechanical rule —
  // the evidence must be a copyable span, since checkability is the entire
  // point of this field.
  assert.ok(/copied EXACTLY as a contiguous run of words/.test(line), 'must demand an exact, checkable span as evidence');
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
