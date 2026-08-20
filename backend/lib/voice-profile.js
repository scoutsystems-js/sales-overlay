/**
 * VOICE PROFILE — the closer's OBSERVABLE, TRANSFERABLE speech properties
 * (Justin's ruling, 2026-08-20).
 *
 * ⚠⚠ THIS REPLACES FEEDING LINES AS EXEMPLARS, AND THE REASON IS THE WHOLE
 * DESIGN. v24 handed the model 15 of the closer's real spoken lines. It
 * produced an email whose every word was plausible and which still read as
 * generated — because LINES INVITE IMITATION, and what gets imitated is
 * SPOKEN register. Josh talks in fragments, asks rhetorical questions, and
 * interrupts himself; imitate that in writing and you get a bad email.
 *
 * ⚠ WHAT SURVIVES A CHANGE OF MEDIUM IS A PROPERTY, NOT A PHRASING.
 * "His sentences average 14 words with high variance, he contracts almost
 * everything, and he states rather than hedges" is true of Josh whether he
 * is speaking or writing. "that's not the, the real estate's not the hard
 * part" is true only of Josh speaking.
 *
 * Justin's brief, verbatim: Scout should be smart enough to DETECT SPEECH
 * PATTERNS FROM CLOSERS and apply them to an email based on the context of
 * the call. So the spoken-to-written transformation is Scout's problem —
 * not something to sidestep by asking for sample emails.
 *
 * ⚠ ZERO MODEL CALLS. Every property below is arithmetic over stored text.
 * Computed ONCE per closer and cached on a hash of the source lines (same
 * pattern as lib/coaching-areas), because the numbers barely move as lines
 * accumulate and per-call derivation would pay repeatedly for that.
 */
'use strict';

// Hedges vs. direct statement. Deliberately small and literal — a long
// "hedge lexicon" starts encoding a judgement about what hedging IS, and
// this is a measurement, not an assessment.
const HEDGES = [
  'kind of', 'sort of', 'maybe', 'i think', 'i guess', 'probably',
  'perhaps', 'might', 'possibly', 'somewhat', 'a little bit', 'i feel like',
];

function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}
function words(text) {
  return String(text).toLowerCase().match(/[a-z']+/g) || [];
}

/**
 * ⚠⚠ THE PROPERTY WE CANNOT MEASURE, NAMED HERE RATHER THAN APPROXIMATED.
 *
 * CHARACTERISTIC OPENINGS are not extractable from this corpus, and the
 * reason is that OUR OWN FILTER REMOVED THE EVIDENCE. `closer-voice.js`
 * filter 1 rejects lines that start with filler ("so", "I mean", "like",
 * "yeah") and lines that start lowercase — precisely the shapes a real
 * opening takes. So the surviving lines systematically OVER-REPRESENT
 * clean openings, and a profile built from them would report an opening
 * style THE FILTER SELECTED FOR, not one the closer has.
 *
 * ⚠ DO NOT "FIX" THIS BY LOOSENING FILTER 1. That filter exists because
 * unfiltered lines carry stammers and self-repairs, and letting those back
 * in to recover openings would reintroduce exactly the noise the grounding
 * work spent a block removing. The trade is not worth it for one property.
 *
 * ⚠ AND DO NOT APPROXIMATE IT. An opening style guessed from filtered lines
 * would be stated with the same confidence as the six measured properties
 * and would be wrong in a way nothing downstream could detect — the
 * wrong-label-worse-than-none failure, in a profile the model is told to
 * imitate. A property we cannot measure is better NAMED than approximated.
 *
 * If it is ever wanted: derive it from UNFILTERED `closer_response` rows in
 * a separate pass, where the noise is acceptable because the only thing
 * being read is the first two or three words.
 */
const UNMEASURABLE = Object.freeze({
  characteristic_openings:
    'NOT MEASURABLE from this corpus — closer-voice filter 1 rejects leading '
    + 'filler and lowercase starts, which is exactly where openings live. '
    + 'Never approximated; see lib/voice-profile.',
});

/**
 * Derive the profile. Pure, total, no I/O.
 * @param {string[]} lines  verified closer lines (already filtered for cleanliness)
 */
function deriveVoiceProfile(lines) {
  const clean = (lines || []).filter(l => typeof l === 'string' && l.trim());
  if (clean.length < MIN_LINES) return null;   // too thin to describe anyone

  const allSentences = clean.flatMap(sentences);
  const lens = allSentences.map(s => words(s).length).filter(n => n > 0);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, n) => a + (n - mean) * (n - mean), 0) / lens.length;

  const allWords = clean.flatMap(words);
  const contractions = allWords.filter(w => w.indexOf("'") !== -1).length;
  // words that COULD contract, as the denominator — a raw contraction count
  // says more about how often he uses "is/not/will" than about his style
  const contractible = allWords.filter(w =>
    /^(is|are|was|not|will|would|have|has|had|am|do|does|did|cannot)$/.test(w)).length;

  const lower = clean.map(l => l.toLowerCase());
  const hedged = lower.filter(l => HEDGES.some(h => l.indexOf(h) !== -1)).length;
  const questions = allSentences.filter(s => /\?\s*$/.test(s)).length;
  const longWords = allWords.filter(w => w.length >= 8).length;

  return {
    sample_size: clean.length,
    sentence_length_mean: +mean.toFixed(1),
    sentence_length_sd: +Math.sqrt(variance).toFixed(1),
    // ⚠ VARIANCE IS REPORTED, NOT JUST THE MEAN. Uniform sentence length is
    // the rhythm of generated prose; the mean alone cannot express that, and
    // a field with regions is exactly where a mean hides the thing you need.
    contraction_rate: contractible ? +(contractions / (contractions + contractible)).toFixed(2) : 0,
    question_rate: +(questions / allSentences.length).toFixed(2),
    hedge_rate: +(hedged / clean.length).toFixed(2),
    long_word_rate: +(longWords / allWords.length).toFixed(3),
    unmeasurable: UNMEASURABLE,
  };
}

const MIN_LINES = 30;

/**
 * ⚠⚠ THE FORM CONSTRAINTS — THE STRONGER HALF, AND THE ONLY PART THAT IS
 * MACHINE-CHECKABLE.
 *
 * The sharpest generated-text tell found so far is not vocabulary or
 * structure — it is EFFORT. v24 volunteered a three-item diligence
 * checklist to a prospect who had just refused to buy. NOBODY TYPES 180
 * CAREFUL WORDS TO A NO. Perfect voice inside that shape still reads as
 * generated, so length and helpfulness are constrained AS A FUNCTION OF HOW
 * THE CALL ENDED rather than as tone guidance.
 */
const OUTCOME_FORM = {
  closed:    { maxWords: 120, allow: 'logistics only — next step, confirmations. No persuasion, no recap.' },
  follow_up: { maxWords:  90, allow: 'one open question. No summary of what was discussed.' },
  // ⚠ THE SHORTEST OF THE THREE, DELIBERATELY INVERTING WHAT v24 DID.
  lost:      { maxWords:  40, allow: 'a door left open. NO advice, NO checklist, NO reasons to reconsider.' },
  no_show:   { maxWords:  30, allow: 'a reschedule line. Nothing else.' },
};

function formConstraintsFor(outcome) {
  return OUTCOME_FORM[outcome] || OUTCOME_FORM.follow_up;
}

/**
 * Render the profile + form rules as a prompt block. Null when unavailable.
 *
 * ⚠⚠ ALL FOUR CEILINGS ARE GIVEN, AND THE MODEL PICKS — A CONSTRAINT DISCOVERED
 * BY WIRING THIS, NOT BY DESIGNING IT. The form rules are a function of HOW THE
 * CALL ENDED, and the thing that determines how it ended is THIS SAME GRADER
 * CALL. So the outcome is not knowable when the prompt is built.
 * Three ways out, and only one is honest:
 *   (a) use the PREVIOUSLY stored outcome — stale, and null on a first analysis
 *   (b) hand over all four ceilings and have the model apply the one matching
 *       the outcome it assigns in the same JSON  <- chosen
 *   (c) run two passes — doubles the spend to learn something the model
 *       already knows by the time it writes the email
 * (b) costs a few tokens and is self-consistent BY CONSTRUCTION: the ceiling
 * and the outcome come out of one decision, so they can never disagree.
 * ⚠ The server-side gate still uses formConstraintsFor(actualOutcome) — that
 * runs AFTER the response, where the outcome IS known, so the check does not
 * depend on the model having obeyed.
 */
function voiceProfileBlock(profile, outcome) {
  if (!profile) return null;
  const f = formConstraintsFor(outcome);
  return [
    'HOW THIS CLOSER WRITES — measured properties of their real speech,',
    'to be applied to WRITTEN register. Do NOT imitate spoken grammar.',
    /* ⚠⚠ ONLY THE STABLE PROPERTIES ARE STATED AS NUMBERS. Measured by
       splitting Josh's real corpus in half and comparing (n=57 vs n=57):
         sentence_length_mean   1% drift   <- solid
         sentence_length_sd     6%         <- solid
         contraction_rate      10%         <- solid
         long_word_rate        13%         <- acceptable, not surfaced
         question_rate         17%         <- MARGINAL, so stated as a band
         hedge_rate           100%         <- UNSTABLE (0 vs 0.05), never a number
       ⚠ THE HEDGE RATE IS UNSTABLE BUT ITS THRESHOLDED VERDICT IS NOT: both
       halves sit far below 0.2, so "states things directly" holds either way.
       So the VERDICT is reported and the RATE is not — a noisy input can still
       support a robust judgement, and printing the input would claim a
       precision the corpus cannot carry. Same family as compare-the-underlying-
       value-round-only-to-render, one step earlier in the pipeline. */
    '  • sentences average ' + profile.sentence_length_mean + ' words (spread ±'
      + profile.sentence_length_sd + ') — VARY sentence length; include at least one under 6 words',
    '  • contracts ' + Math.round(profile.contraction_rate * 100) + '% of contractible words',
    '  • ' + (profile.hedge_rate < 0.2 ? 'states things directly — do not soften or qualify'
                                       : 'softens claims — do not overstate'),
    '  • ' + (profile.question_rate >= 0.25 ? 'asks questions often — a question is in character'
             : profile.question_rate >= 0.1 ? 'asks a question occasionally — at most one'
                                            : 'rarely asks questions — prefer statements'),
    '',
    'FORM — APPLY THE ROW MATCHING THE `outcome` YOU ASSIGN ABOVE:',
    '  closed    -> HARD CEILING ' + OUTCOME_FORM.closed.maxWords    + ' words. ' + OUTCOME_FORM.closed.allow,
    '  follow_up -> HARD CEILING ' + OUTCOME_FORM.follow_up.maxWords + ' words. ' + OUTCOME_FORM.follow_up.allow,
    '  lost      -> HARD CEILING ' + OUTCOME_FORM.lost.maxWords      + ' words. ' + OUTCOME_FORM.lost.allow,
    '  no_show   -> HARD CEILING ' + OUTCOME_FORM.no_show.maxWords   + ' words. ' + OUTCOME_FORM.no_show.allow,
    '',
    '⚠ EFFORT MUST MATCH THE OUTCOME. Nobody types 180 careful words to a',
    'prospect who just said no. A long, helpful, well-organised email after a',
    'LOST call is the single clearest sign it was not written by a person.',
    '  • Do NOT summarise what was discussed. They were on the call.',
    '  • At most ONE em-dash in the whole email.',
    '  • No "I hope this finds you well", no "don\'t hesitate to reach out".',
  ].join('\n');
}

module.exports = {
  MIN_LINES,
  HEDGES,
  UNMEASURABLE,
  OUTCOME_FORM,
  deriveVoiceProfile,
  formConstraintsFor,
  voiceProfileBlock,
};
