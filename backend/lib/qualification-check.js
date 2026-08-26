// Per-criterion qualification verdicts (Justin's ruling 2026-08-26).
//
// THE GAP: `qualification_covered` stored the prospect's disclosure verbatim —
// "My personal credit score right now is about 60 or something like that." —
// and the rep's own criteria ("640 or above credit score") already reached the
// grader. BOTH NUMBERS WERE IN FRONT OF THE MODEL AND NOTHING COMPARED THEM.
// That field answers "was the topic covered", never "did the prospect pass".
//
// ⚠⚠ THREE STATES, NOT TWO. `failed` and `undetermined` must never render the
// same. A prospect who never mentioned money is NOT a prospect who failed, and
// collapsing those two is a mistake this project has already had to fix twice
// on other surfaces. `undetermined` is the honest, common answer.
//
// ⚠⚠ THE MODEL DOES THE COMPARISON, NOT A PARSER. "About 60 or something like
// that" is not a number a parser can read, and "not living paycheck to
// paycheck" is not a number at all. A model can judge both — but it must be
// able to say it could not tell, which is why `undetermined` is a first-class
// verdict rather than a failure mode.
//
// ⚠ CRITERIA ARE FREE TEXT, PER USER (user_profiles.qualifications). There is
// no schema, no threshold column and no shared vocabulary, so NOTHING here may
// hardcode "640" or "credit score". The rule is: whatever text this rep wrote
// is the bar, and the model checks the prospect against it.

var VERDICTS = ['passed', 'failed', 'undetermined'];

// A rep could write a long list; bound the array so a pathological profile
// cannot blow the grader's output budget. Josh has 3.
var MAX_CRITERIA = 8;
var MAX_CRITERION_CHARS = 200;
var MAX_EVIDENCE_CHARS = 400;

function str(v, max) {
  return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;
}

// SHAPE ONLY — no transcript needed, so this stays pure and cheap to test.
// Anything malformed becomes `undetermined` rather than being dropped: losing a
// criterion silently would understate what the closer failed to establish.
function sanitizeQualificationCheck(raw) {
  if (!Array.isArray(raw)) return null;              // null = never evaluated
  var out = [];
  for (var i = 0; i < raw.length && out.length < MAX_CRITERIA; i++) {
    var e = raw[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    var criterion = str(e.criterion, MAX_CRITERION_CHARS);
    if (!criterion) continue;                        // a verdict about nothing is meaningless
    var covered = (e.covered === true);
    var verdict = (typeof e.verdict === 'string' && VERDICTS.indexOf(e.verdict.toLowerCase()) !== -1)
      ? e.verdict.toLowerCase() : 'undetermined';
    var evidence = str(e.evidence, MAX_EVIDENCE_CHARS);
    // ⚠ NOT COVERED CANNOT CARRY A VERDICT. If the ground was never established
    // there is nothing to judge, and a verdict here would be an assertion about
    // a prospect who was never asked.
    if (!covered) { verdict = 'undetermined'; evidence = null; }
    // A decided verdict with no quote is not trustworthy — the contract asks for one.
    if ((verdict === 'passed' || verdict === 'failed') && !evidence) verdict = 'undetermined';
    out.push({
      criterion: criterion,
      covered: covered,
      verdict: verdict,
      evidence: evidence,
      evidence_verified: false,        // set by verifyQualificationCheck
    });
  }
  return out;
}

// WRITE-TIME VERIFICATION — the half that makes a `failed` safe to act on.
//
// ⚠⚠ A DECIDED VERDICT MUST REST ON THE PROSPECT'S OWN WORDS. Measured on 349
// real calls, 82% of stored qualification evidence reconstructs — but 55 of
// those 286 are the CLOSER speaking, e.g. "Your credit, is your credit shot?"
// or "you have 5 to 10K set aside, right?". Those are the closer ASKING, not
// the prospect ANSWERING. Deciding a criterion on them would let a closer's
// own question disqualify a prospect.
//
// ⚠ THE DIRECTION IS DELIBERATE AND FOLLOWS THE CONSEQUENCE: an unprovable
// quote DOWNGRADES to `undetermined` and the quote is withheld — it never
// flips a verdict to `failed`. A wrong disqualification is worse than no
// verdict at all, the same governing principle as prospect names.
//
// `labelFor(turns, quote)` is injected so this stays pure and testable; the
// worker passes lib/quote-locate's labelForQuote.
function verifyQualificationCheck(entries, turns, labelFor) {
  if (!Array.isArray(entries)) return entries;
  return entries.map(function (e) {
    var out = {
      criterion: e.criterion,
      covered: e.covered,
      verdict: e.verdict,
      evidence: e.evidence,
      evidence_verified: false,
    };
    if (!out.evidence) return out;
    var who = null;
    try { who = labelFor(turns, out.evidence); } catch (err) { who = null; }
    if (who === 'PROSPECT') {
      out.evidence_verified = true;
      return out;
    }
    // Could not prove the prospect said it. Keep the criterion and the fact it
    // was covered; withhold the unprovable quote and refuse to decide on it.
    if (out.verdict === 'passed' || out.verdict === 'failed') out.verdict = 'undetermined';
    out.evidence = null;
    return out;
  });
}

// A failed criterion IS a financial disqualification — the SAME notion the v27
// boundary already established, not a second competing one. This is the single
// place that decides it, so a caller cannot invent its own definition.
function hasFailedCriterion(entries) {
  return Array.isArray(entries) && entries.some(function (e) {
    return e && e.verdict === 'failed' && e.evidence_verified === true;
  });
}

module.exports = {
  VERDICTS: VERDICTS,
  MAX_CRITERIA: MAX_CRITERIA,
  sanitizeQualificationCheck: sanitizeQualificationCheck,
  verifyQualificationCheck: verifyQualificationCheck,
  hasFailedCriterion: hasFailedCriterion,
};
