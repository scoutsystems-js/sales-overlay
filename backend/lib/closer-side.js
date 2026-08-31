/**
 * THE CLOSER'S SIDE OF A MOMENT — the sentinels, in one place (v29, 2026-08-28).
 *
 * ⚠⚠ WHY SENTINELS AND NOT null. `closer_response` has to express FOUR distinct
 * states and three of them used to collapse into a single null:
 *
 *   a verbatim span   the closer replied and here are his exact words
 *   __no_reply__      he did NOT reply — the prospect spoke and he moved on.
 *                     A RESULT, not missing data. On a missed_opportunity it is
 *                     often the most coachable fact on the call.
 *   __moment_is_closer__  the moment's own quote is ALREADY the closer speaking,
 *                     so his side is not missing — it is the quote.
 *   null              he did reply and we could not produce an exact span.
 *
 * Collapsing any of these into null is the absent-vs-excluded failure: "he said
 * nothing", "he is the one talking" and "we could not find it" are three
 * different facts that a reader cannot tell apart once they share a value.
 *
 * ⚠ __moment_is_closer__ EXISTS BECAUSE OF MEASURED DATA, not symmetry. Of the
 * five types that never carried a reply, strong_moment is 874 CLOSER-spoken vs
 * 58 PROSPECT and missed_opportunity is a near 50/50 split (463/453). Asking for
 * "the closer's reply" on a moment the closer is already speaking invites the
 * model to reach for some other line of his — which is exactly how a quote ends
 * up attached to the wrong exchange.
 *
 * ⚠⚠ AND THEY MUST NEVER REACH THE QUOTE VERIFIER. `closer_response_verified`
 * runs labelForQuote() over the text; a sentinel cannot reconstruct, so it would
 * be recorded as a REJECTED quote — a real finding filed as a verification
 * failure, and counted in the rejection stats that are used to judge the
 * extractor. isSentinel() is the guard.
 */

const NO_REPLY = '__no_reply__';
const MOMENT_IS_CLOSER = '__moment_is_closer__';
const SENTINELS = [NO_REPLY, MOMENT_IS_CLOSER];

// Total: a non-string, null or anything else is simply not a sentinel.
function isSentinel(v) {
  return typeof v === 'string' && SENTINELS.indexOf(v.trim()) !== -1;
}

/* ⚠⚠⚠ THE DISPLAY GATE. A SENTINEL IS A RESULT, NOT A QUOTE — AND IT MUST NEVER
   REACH A SCREEN, A PROMPT, THE VOICE CORPUS OR A KB ENTRY.

   This exists because it already leaked. The performance synthesis renders
   `quote: str(closer_response) || str(quote)`, and a sentinel is a NON-EMPTY
   STRING, so it WON over the real quote and the evidence line came back as the
   literal text `__moment_is_closer__`. A manager would have read that as the
   proof of a weakness.

   ⚠ v29 added the sentinels and guarded them against the quote VERIFIER only.
   The RENDER paths were never checked — and there are a dozen of them, because
   `closer_response` is consumed by both syntheses, the objection lanes, the
   section breakdown, the voice corpus, KB harvesting and several API payloads.
   ⚠ A consumer that genuinely wants the MEANING ("he did not reply") asks
   isSentinel() explicitly; everything that wants TEXT goes through here. */
function displayCloserResponse(v) {
  if (typeof v !== 'string') return null;
  var t = v.trim();
  if (!t || isSentinel(t)) return null;
  return t;
}

/* ⚠⚠⚠ THE PROOF GATE. AN UNPROVEN REPLY IS THE MODEL'S GUESS AT WHO SPOKE, AND
   IT MUST NEVER BE PRESENTED AS THE REP'S WORDS.

   `closer_response_verified` is stamped true only when the quote locator
   independently proves the closer said it. Measured 2026-08-31: 544 of 4,263
   showable replies — 13% — are NOT proven.

   ⚠ TWO lanes already required proof and FIVE did not, which is why this lives
   here rather than being re-implemented per lane: team-needs-work rendered them
   to a manager as "Your response:", and objection-synthesis and the Why panel
   fed them INTO MODEL PROMPTS. That second one is worse — the model then builds
   coaching prose around words the rep may never have said, and the prose reads
   as authoritative with nothing on screen to check it against.

   ⚠⚠ THREE-VALUED ON PURPOSE, AND ONLY `true` PASSES. null means never
   assessed, false means assessed and not provable. Treating null as permission
   would be the absent-vs-excluded collapse: "we did not check" is not "we
   checked and it was fine".

   ⚠ THE STANDARD IS OMIT, NOT CAVEAT — a caveat inside a two-line evidence row
   reads as noise, and this is the 6b defect that already had to be repaired in
   the knowledge base once.

   ⚠ It is STRICTLY narrower than displayCloserResponse: everything that gate
   rejects, this rejects too. A consumer wanting the raw text for a non-user
   purpose still calls displayCloserResponse deliberately. */
function provenCloserResponse(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.closer_response_verified !== true) return null;
  return displayCloserResponse(row.closer_response);
}

module.exports = { NO_REPLY, MOMENT_IS_CLOSER, SENTINELS, isSentinel, displayCloserResponse, provenCloserResponse };
