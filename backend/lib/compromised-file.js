/**
 * A COMPROMISED FILE: one distinct speaker across a substantial conversation
 * (Justin's ruling 2026-08-29 — his word, "compromised file").
 *
 * WHY IT MUST NOT BE GRADED. A transcript where every word carries one label is
 * unreadable as a sales call: the model is told one person said everything,
 * INCLUDING the prospect's objections, and returns a score anyway. Measured on
 * live data before this shipped, three such calls carried 71, 47 and 32 with
 * 5-8 highlights drawn from them. A confident number from an unreadable source
 * is worse than no number, because nothing on screen says the input was broken
 * — the same failure as coaching confidently on the wrong thing.
 *
 * DETECTED FROM THE DATA, NEVER FROM A STRING. Nothing here knows about Zoom,
 * phones or dial-ins. The observed cause is a closer phoning someone mid-meeting
 * so both voices land on one audio channel, but that is one shape of a general
 * fault and the next one will arrive differently. The rule is only: how many
 * distinct speakers does this transcript actually contain?
 *
 * THE FLOOR EXISTS SO A SHORT CALL IS NOT MISTAKEN FOR A BROKEN ONE. A
 * two-minute test meeting with one speaker is a short call, not a compromised
 * file. Derived from the live distribution rather than rounded to taste — the
 * single-speaker calls in the corpus sit at 35146, 13641, 10678 and 4731
 * characters, then 1179, 1108, 878 and a tail down to 21. An EMPTY BAND 3,552
 * characters wide separates the substantial calls from the short ones, so any
 * value inside it splits the same two groups and the threshold is not sitting
 * on a data point. 2,000 is inside it.
 *
 * ~2,000 characters is roughly 350 words: a recording in which one person
 * speaks that long with no second party is implausible for a sales call, while
 * a voicemail, a test meeting or a no-show legitimately is one-sided and short.
 */

// A DATA-DERIVED BOUNDARY, NOT A ROUND NUMBER. See the band above before moving
// it, and re-derive from the corpus rather than nudging it to taste.
var MIN_COMPROMISED_CHARS = 2000;

/**
 * Distinct speaker labels in a normalized turn array.
 * null/undefined counts as its OWN label rather than being skipped: a
 * transcript with no attribution at all is not "zero speakers", it is one
 * unidentified voice — which is exactly the state this guards against.
 */
function distinctSpeakers(turns) {
  if (!Array.isArray(turns)) return 0;
  var seen = Object.create(null);
  var n = 0;
  for (var i = 0; i < turns.length; i++) {
    var t = turns[i];
    if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
    var key = (t.speaker === null || t.speaker === undefined) ? ' null' : String(t.speaker);
    if (!seen[key]) { seen[key] = true; n++; }
  }
  return n;
}

function transcriptChars(turns) {
  if (!Array.isArray(turns)) return 0;
  var n = 0;
  for (var i = 0; i < turns.length; i++) {
    var t = turns[i];
    if (t && typeof t.text === 'string') n += t.text.trim().length;
  }
  return n;
}

/**
 * @returns {{compromised: boolean, speakers: number, chars: number, reason: string|null}}
 * TOTAL — never throws, and returns a NEGATIVE verdict on junk input. An
 * analysis must not fail because this could not make up its mind.
 */
function assessTranscript(turns) {
  var speakers = distinctSpeakers(turns);
  var chars = transcriptChars(turns);
  // speakers === 0 is an EMPTY transcript, which the worker already handles as
  // an error before this runs. It is explicitly NOT a compromised file.
  var compromised = (speakers === 1 && chars >= MIN_COMPROMISED_CHARS);
  return {
    compromised: compromised,
    speakers: speakers,
    chars: chars,
    reason: compromised ? 'single_speaker' : null,
  };
}

/**
 * The graded output a refusal must remove. ONE DEFINITION, because the worker's
 * gate and any backfill that cannot reach the gate must clear exactly the same
 * fields — two hand-written lists would drift and leave one path showing a
 * stale score beside "this could not be graded".
 * The caller decides about `outcome`: a MANUALLY set one is a person's
 * judgement, not something derived from the transcript, and is never cleared.
 */
function clearedGradeFields(includeOutcome) {
  var f = {
    overall_score: null, one_thing: null, why_outcome: null, why_quote: null,
    follow_up_email: null, eod_summary: null,
    intro_score: null, intro_grade: null, discovery_score: null, discovery_grade: null,
    pitch_score: null, pitch_grade: null, objection_score: null, objection_grade: null,
    close_score: null, close_grade: null, close_score_earned: null,
  };
  if (includeOutcome) { f.outcome = null; f.outcome_source = null; }
  return f;
}

module.exports = {
  assessTranscript: assessTranscript,
  clearedGradeFields: clearedGradeFields,
  distinctSpeakers: distinctSpeakers,
  transcriptChars: transcriptChars,
  MIN_COMPROMISED_CHARS: MIN_COMPROMISED_CHARS,
};
