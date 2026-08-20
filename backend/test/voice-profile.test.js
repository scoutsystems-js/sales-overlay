/**
 * VOICE PROFILE — properties, not phrasings (2026-08-20).
 *
 * ⚠ FIXTURES ARE JOSH'S REAL LINES where a real line is needed. The synthetic-
 * input rule applies with extra force here: a profile is a MEASUREMENT, so
 * testing it on invented text measures the invention.
 */
const test = require('node:test');
const assert = require('node:assert');
const vp = require('../lib/voice-profile');

// real verified lines (from call_highlights.closer_response, verified=true)
const REAL = [
  "You don't need my permission to do whatever the hell you want.",
  'Are you living paycheck to paycheck by any means?',
  "Take as long as you need. Like I said, my job's not to convince you to work with us.",
  "I'm not going to sit here and pretend this is for everybody.",
  "That's a fair question and I'll answer it straight.",
  "You've got the money. The question is whether you want to bet on yourself.",
  "I'd rather you tell me no today than ghost me next week.",
  "Most people who say that are scared, and that's fine.",
  "It's not a magic button. You still have to do the work.",
];

test('a corpus below MIN_LINES returns null — never a profile of nobody', () => {
  assert.strictEqual(vp.deriveVoiceProfile(REAL), null, '9 lines is too thin');
  assert.strictEqual(vp.deriveVoiceProfile([]), null);
  assert.strictEqual(vp.deriveVoiceProfile(null), null);
});

test('with enough lines it derives the measurable properties', () => {
  const many = [];
  while (many.length < vp.MIN_LINES + 5) many.push(...REAL);
  const p = vp.deriveVoiceProfile(many);
  assert.ok(p, 'should derive');
  assert.ok(p.sentence_length_mean > 3 && p.sentence_length_mean < 40);
  assert.ok(p.sentence_length_sd >= 0);
  assert.ok(p.contraction_rate >= 0 && p.contraction_rate <= 1);
  assert.ok(p.question_rate >= 0 && p.question_rate <= 1);
});

test('⚠⚠ the UNMEASURABLE property is NAMED, not approximated', () => {
  const many = [];
  while (many.length < vp.MIN_LINES + 5) many.push(...REAL);
  const p = vp.deriveVoiceProfile(many);
  assert.ok(p.unmeasurable && p.unmeasurable.characteristic_openings,
    'characteristic openings must be present as a NAMED GAP');
  assert.match(p.unmeasurable.characteristic_openings, /NOT MEASURABLE/);
  // ⚠ and it must say WHY, so nobody "fixes" it by loosening filter 1 and
  // reintroducing the stammers that filter exists to remove
  assert.match(p.unmeasurable.characteristic_openings, /filter 1/);
  // it must NOT appear as a derived value anywhere
  assert.strictEqual(p.characteristic_openings, undefined,
    'an unmeasurable property must never be emitted as if it were measured');
});

test('⚠⚠ the UNSTABLE hedge RATE never reaches the model — only its verdict', () => {
  // Measured on the real corpus: hedge_rate drifts 100% between halves (0 vs
  // 0.05) while the thresholded verdict is identical. Printing the rate would
  // claim a precision 114 lines cannot carry.
  const many = [];
  while (many.length < vp.MIN_LINES + 5) many.push(...REAL);
  const p = vp.deriveVoiceProfile(many);
  const block = vp.voiceProfileBlock(p, 'lost');
  assert.ok(!/hedges in \d+%/.test(block),
    'the hedge RATE must not be printed — it is unstable at this sample size');
  assert.ok(/states things directly|softens claims/.test(block),
    'but its VERDICT must be, because the verdict IS stable');
  // same for question rate — a band, never a percentage
  assert.ok(!/asks a question in \d+%/.test(block),
    'question rate drifts 17% between halves — state a band, not a number');
});

test('⚠⚠ FORM: a LOST call gets the SHORTEST email — inverting what v24 did', () => {
  const lost = vp.formConstraintsFor('lost');
  const closed = vp.formConstraintsFor('closed');
  const follow = vp.formConstraintsFor('follow_up');
  assert.ok(lost.maxWords < follow.maxWords && lost.maxWords < closed.maxWords,
    'NOBODY TYPES 180 CAREFUL WORDS TO A NO. v24 gave a lost prospect a '
    + 'three-item diligence checklist; effort must match how the call ended.');
  assert.ok(/NO advice|NO checklist/.test(lost.allow),
    'the lost email must be forbidden from being helpful');
});

test('⚠ an unknown outcome falls back to follow_up, never to unconstrained', () => {
  assert.deepStrictEqual(vp.formConstraintsFor('banana'), vp.OUTCOME_FORM.follow_up);
  assert.deepStrictEqual(vp.formConstraintsFor(null), vp.OUTCOME_FORM.follow_up);
  assert.deepStrictEqual(vp.formConstraintsFor(undefined), vp.OUTCOME_FORM.follow_up);
});

test('⚠ the block bans a call summary and caps em-dashes, on every outcome', () => {
  const many = [];
  while (many.length < vp.MIN_LINES + 5) many.push(...REAL);
  const p = vp.deriveVoiceProfile(many);
  const b = vp.voiceProfileBlock(p, null);
  assert.match(b, /Do NOT summarise what was discussed/);
  assert.match(b, /ONE em-dash/);

  /* ⚠⚠ THE BLOCK CARRIES ALL FOUR CEILINGS AND THE MODEL PICKS — a design
     constraint found by WIRING this, not by planning it. The form rules are a
     function of how the call ended, and the grader is what DETERMINES how it
     ended, in the same call. So the outcome is not knowable when the prompt is
     built. Handing over all four and having the model apply the row matching
     the outcome it assigns in the same JSON is self-consistent BY
     CONSTRUCTION: ceiling and outcome come out of one decision.
     ⚠ This test previously asserted the block NAMES ONE OUTCOME. That was
     correct for the old shape and is now wrong — updated deliberately rather
     than deleted, because the property it protects (every outcome has a
     stated ceiling) still matters. */
  ['closed', 'follow_up', 'lost', 'no_show'].forEach(o => {
    assert.ok(b.indexOf(o) !== -1, 'every outcome must carry a ceiling: ' + o);
    assert.ok(new RegExp(o + '\\s*->\\s*HARD CEILING \\d+ words').test(b),
      o + ' must state its own hard ceiling');
  });
  assert.match(b, /APPLY THE ROW MATCHING THE `outcome` YOU ASSIGN ABOVE/,
    'the model must be told to select by its own verdict — otherwise four '
    + 'ceilings are four suggestions');
  /* ⚠⚠ DERIVED FROM OUTCOME_FORM, NOT PINNED TO LITERALS — and this line
     previously did the opposite, which is the reason it is called out. It read
     `'lost      -> HARD CEILING 40'` while the comment three lines above said
     the test pins the RELATIONSHIP and not the values. It then went red the
     moment the ceiling moved 40 -> 50 for a documented reason, against a
     correct change. Third instance this session of a guard pinning a literal
     that a normal, correct edit is expected to move. */
  Object.keys(vp.OUTCOME_FORM).forEach(o => {
    assert.ok(b.indexOf(o + ' ') !== -1 || b.indexOf(o + '\t') !== -1, o + ' present');
    assert.ok(b.indexOf('HARD CEILING ' + vp.OUTCOME_FORM[o].maxWords + ' words') !== -1,
      o + ' must render the ceiling the module actually defines');
  });
});

test('no profile -> no block (silence, never a guessed voice)', () => {
  assert.strictEqual(vp.voiceProfileBlock(null, 'lost'), null);
});

test('⚠ the block instructs WRITTEN register explicitly — the whole point', () => {
  const many = [];
  while (many.length < vp.MIN_LINES + 5) many.push(...REAL);
  const b = vp.voiceProfileBlock(vp.deriveVoiceProfile(many), 'closed');
  assert.match(b, /WRITTEN register/);
  assert.match(b, /Do NOT imitate spoken grammar/,
    'lines invite imitation of SPOKEN register — that is what v24 did wrong');
});

/* ── THE THREE GATE FIXES (2026-08-20) ─────────────────────────────────────
   All three came from RUNNING the gates on real output, not from review. */

test('⚠⚠ UNREACHABLE BOUND: the greeting spends an em-dash, so the body is counted', () => {
  // "Hey Teesha —" IS one em-dash. A flat ceiling of 1 left the body a budget
  // of ZERO and could essentially never pass — the same defect class as a band
  // that can never render.
  // ⚠ FIXED BY EXEMPTING THE GREETING, NOT BY RAISING THE CEILING TO 2:
  // raising it would silently permit two in the body of any draft that skipped
  // the greeting, hiding the bug rather than fixing it.
  const greeted = 'Hey Teesha —\n\nAsk them how many members — actively — they have.\n\nJoshua';
  assert.strictEqual((greeted.match(/—/g) || []).length, 3, 'three em-dashes raw');
  assert.strictEqual(vp.countBodyEmDashes(greeted), 2, 'but two in the BODY');

  const ok = 'Hey Teesha —\n\nAsk them how many members — actively — they have.'.replace(' — actively —', ' actively');
  assert.strictEqual(vp.countBodyEmDashes(ok), 0,
    'a greeting alone must cost the body nothing');

  // and it must still FAIL when the body genuinely overspends
  assert.ok(vp.countBodyEmDashes('One thing — really — matters.') > 1,
    'the gate must still catch real overspend');
});

test('⚠⚠ SIGN-OFF GATE: a pinned element disappearing silently is what gates are for', () => {
  // v25 pinned the sign-off. On the first live v26 run, call 1 came back with
  // NO sign-off at all — the word ceiling squeezed it out and every existing
  // check passed. That is the defect this gate exists for.
  assert.strictEqual(vp.hasSignOff('Hey T —\n\nBody here.\n\nJoshua', 'Joshua'), true);
  assert.strictEqual(
    vp.hasSignOff('Hey Teesha —\n\nWhat would you need to feel solid about?', 'Joshua'), false,
    'the exact live defect must be caught');
  assert.strictEqual(vp.hasSignOff('', 'Joshua'), false);
});

test('⚠ the ceilings are declared a JUDGEMENT, and only the ORDERING is pinned', () => {
  // The absolute numbers cannot be derived — there is no corpus of real sent
  // emails, because Justin ruled out supplying one. So the test pins the
  // relationship, which IS grounded, and not the values, which are not.
  assert.strictEqual(vp.CEILINGS_ARE_A_JUDGEMENT, true,
    'the flag exists so nobody later treats these numbers as measured');
  assert.ok(vp.OUTCOME_FORM.lost.maxWords < vp.OUTCOME_FORM.follow_up.maxWords);
  assert.ok(vp.OUTCOME_FORM.follow_up.maxWords < vp.OUTCOME_FORM.closed.maxWords);
  assert.ok(vp.OUTCOME_FORM.no_show.maxWords < vp.OUTCOME_FORM.follow_up.maxWords);
});

test('⚠ the block now states BOTH fixed rules to the model', () => {
  const many = [];
  while (many.length < vp.MIN_LINES + 5) many.push(...REAL);
  const b = vp.voiceProfileBlock(vp.deriveVoiceProfile(many), null);
  assert.match(b, /ONE em-dash IN THE BODY/, 'the greeting exemption must reach the model');
  assert.match(b, /End with a line containing ONLY the closer's first name/,
    'the sign-off must be instructed, not just gated');
});

test('⚠⚠ bodyOf FAILED OPEN on single-paragraph email — the gate passed anything', () => {
  /* The first version matched `[^\n]*`, i.e. everything up to the first
     newline. Every pre-v26 draft is ONE paragraph, so it stripped the whole
     email and countBodyEmDashes returned 0 for a 175-word draft with FOUR
     em-dashes. A gate that fails OPEN is worse than no gate: it reports PASS,
     so nobody looks again.
     ⚠ Found only by running the gates over the OLD drafts as well as the new
     ones. Checking only the drafts you expect to pass cannot reveal a check
     that can no longer fail. */
  const oneParagraph =
    'Hey Teesha — wanted to follow up. I know the price landed — and I get it '
    + '— you came in to learn — not to be hit.';
  assert.strictEqual((oneParagraph.match(/—/g) || []).length, 4, 'four raw');
  assert.strictEqual(vp.countBodyEmDashes(oneParagraph), 3,
    'the greeting costs one; the other THREE must still be counted');
});

test('⚠ the salutation strip is BOUNDED — it must not eat a body em-dash', () => {
  // An intermediate version allowed any 40 chars before the punctuation, so
  // "Hey Dan I have — one dash." lost its BODY dash to the greeting strip.
  assert.strictEqual(vp.countBodyEmDashes('Hey Dan I have — one dash.'), 1,
    'no salutation punctuation => strip nothing, count everything');
  assert.strictEqual(vp.countBodyEmDashes('Hey Dan —\n\nNo dashes here.'), 0);
  assert.strictEqual(vp.countBodyEmDashes('Hi Dan,\n\nOne — dash.'), 1);
  // a two-word name is still a salutation
  assert.strictEqual(vp.countBodyEmDashes('Hello Mary Jane — one — two.'), 1);
  // no greeting at all => nothing stripped
  assert.strictEqual(vp.countBodyEmDashes('One — dash — here.'), 2);
});

test('⚠ short_sentence is ADVISORY — measured, never blocking', () => {
  // It was in the key table and in NEITHER gate list, rendering as a bare "no"
  // that read as a failure. "Contains a sentence under six words" is checkable,
  // but a good email can legitimately have none, so blocking would reject
  // valid drafts.
  assert.ok(vp.ADVISORY_GATES.includes('short_sentence'));
  assert.ok(!vp.BLOCKING_GATES.includes('short_sentence'));
  const noShort = 'Hey Dan —\n\nThis sentence is quite deliberately longer than six words indeed.\n\nJoshua';
  const g = vp.evaluateGates(noShort, 'closed', 'Joshua');
  assert.strictEqual(g.results.short_sentence.pass, false, 'measured as false');
  assert.ok(!g.blocked.includes('short_sentence'), 'but must NOT block');
  assert.strictEqual(g.fitToRead, true, 'and the draft stays fit to read');
});
