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
  // and the ordering that makes the whole feature work
  assert.ok(b.indexOf('lost      -> HARD CEILING 40') !== -1
         && b.indexOf('closed    -> HARD CEILING 120') !== -1,
    'lost must be the shortest and closed the longest');
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
