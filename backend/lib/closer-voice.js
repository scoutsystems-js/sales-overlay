/**
 * THE CLOSER'S OWN LANGUAGE, FOR THE FOLLOW-UP EMAIL (Josh, 2026-08-20).
 * His brief, verbatim: "unless the closer sounds dumb lol".
 *
 * ⚠⚠ THE FINDING THAT SHOULD LEAD ANY FUTURE EDIT HERE: THIS WAS A MISSING
 * INPUT, NOT A MISSING INSTRUCTION. The grader prompt has said "sound like a
 * real person following up on a real conversation" since v7, and it produced
 * pastiche anyway — because it names what to AVOID and gives the model nothing
 * to IMITATE. Do not try to fix voice by rewording the instruction again; that
 * has already been tried and is what this module replaces.
 *
 * ⚠ THE MATERIAL IS ALREADY VERIFIED AND COSTS NOTHING TO FETCH.
 * `call_highlights.closer_response` with `closer_response_verified = true` has
 * passed the 6e chain: proven verbatim against the transcript AND proven to be
 * the CLOSER speaking. Live on Josh: 413 lines across 168 calls. These are not
 * transcript scrapings and must never be replaced with unverified ones — see
 * the Zoom note at the bottom for why that distinction is load-bearing.
 */
'use strict';

// How many lines reach the prompt. Enough to establish a register, few enough
// that the model cannot treat them as a phrase bank to copy from.
const VOICE_LINE_COUNT = 15;
const MIN_CHARS = 35;
const MAX_CHARS = 180;

/**
 * FILTER 1 — CLEAN THE INPUT BEFORE THE MODEL SEES IT.
 *
 * ⚠ This is the cheap filter and it does most of the work. Josh's own verified
 * lines include "that's not the, the real estate's not the hard part." — a real
 * stammer, verbatim, and precisely what must not be imitated. Removing it costs
 * a regex; asking a model to ignore it costs a judgement it will sometimes get
 * wrong.
 *
 * ⚠ REJECTS, NEVER REPAIRS. A cleaned-up line is no longer evidence of how they
 * talk — it is evidence of how this function rewrites. There are 413 lines; we
 * can afford to be picky and keep only what is already clean.
 */
function isCleanVoiceLine(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < MIN_CHARS || t.length > MAX_CHARS) return false;

  // mid-sentence self-repair: "the, the", "do you have, do you have"
  if (/\b(\w+)\b[,\s]+\1\b/i.test(t)) return false;
  // leading filler — the opener is what sets register, so a filler opener poisons it
  if (/^(so|i mean|like|yeah|uh|um|okay|right|well)\b[\s,]/i.test(t)) return false;
  // embedded disfluency markers
  if (/\b(uh|um|erm)\b/i.test(t)) return false;
  // trailing fragments — a line that stops mid-thought reads as an error
  if (/\b(and|but|or|the|a|to|of|that|is)\s*$/i.test(t)) return false;
  // must be a sentence, not a fragment: needs a verb-ish shape and end punctuation
  if (!/[.!?]$/.test(t)) return false;
  // no interviewer-style bracketed transcription artefacts
  if (/[\[\]]/.test(t)) return false;

  /* ⚠ THESE THREE WERE ADDED AFTER TESTING AGAINST THE REAL 413 LINES, because
     the first draft let visible noise through. Testing the filter on actual
     material rather than on invented examples is what caught them. */
  // starts lowercase or with a conjunction => a mid-sentence fragment, not a
  // sentence. "we've also, although we would prefer, right, that it was..."
  if (/^[a-z]/.test(t)) return false;
  if (/^(and|but|so|because|although)\b/i.test(t)) return false;
  // self-repair the duplicate-word test misses: "that's like, you can, that's
  // what you can spend" — a repeated 2-3 word phrase inside one line
  var words = t.toLowerCase().replace(/[^a-z' ]/g, '').split(/\s+/);
  for (var i = 0; i + 3 < words.length; i++) {
    var pair = words[i] + ' ' + words[i + 1];
    if (pair.length < 5) continue;
    if (words.slice(i + 2).join(' ').indexOf(pair) !== -1) return false;
  }
  // comma density as a rambling proxy: a clean spoken sentence rarely needs
  // more than one comma per ~12 words
  var commas = (t.match(/,/g) || []).length;
  if (commas > Math.max(1, Math.floor(words.length / 12))) return false;
  return true;
}

/** Pick a spread rather than the first N, so one call cannot dominate the sample. */
function selectVoiceLines(rows, limit) {
  const cap = limit || VOICE_LINE_COUNT;
  const clean = (rows || [])
    .map((r) => (r && typeof r.closer_response === 'string' ? r.closer_response.trim() : ''))
    .filter(isCleanVoiceLine);

  // dedupe on a normalised form — the same handling line recurs across calls
  const seen = Object.create(null);
  const unique = [];
  clean.forEach((t) => {
    const k = t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
    if (seen[k]) return;
    seen[k] = true;
    unique.push(t);
  });

  if (unique.length <= cap) return unique;
  // even stride across the set — a spread of registers, not one call's mood
  const step = unique.length / cap;
  const out = [];
  for (let i = 0; i < cap; i++) out.push(unique[Math.floor(i * step)]);
  return out;
}

/**
 * FILTERS 2 AND 3 — THE FRAMING, WHICH IS THE FEATURE.
 *
 * ⚠ FILTER 2: EVIDENCE OF REGISTER, NOT TEXT TO REUSE. Same discipline as the
 * KB-harvest ruling, which insists harvested material is labelled "examples of
 * this closer's past execution — NOT the standard to grade against". Without
 * that framing the email becomes a collage of old lines, which is worse than
 * pastiche because it is confidently wrong about this call.
 *
 * ⚠ FILTER 3 IS THE ONE THAT ANSWERS JOSH'S ACTUAL BRIEF. "Write what they
 * would have said if they'd said it cleanly" is what separates VOICE from
 * NOISE. Without it, "sounds like Josh" and "sounds dumb" are the same
 * instruction — and the second is the thing he asked us not to do.
 */
function voicePromptBlock(lines) {
  if (!lines || !lines.length) return null;
  return [
    'HOW THIS CLOSER ACTUALLY TALKS — verified lines they said on past calls:',
  ].concat(lines.map((l) => '  • ' + l)).concat([
    '',
    'Use these as EVIDENCE OF REGISTER, not as text to reuse. Match their',
    'directness, sentence length and vocabulary; do not borrow their phrases or',
    'reference anything from those calls — the email is about THIS call only.',
    '⚠ Do NOT reproduce filler, false starts, repetition or grammatical errors.',
    'Write what they would have said if they had said it cleanly.',
  ]).join('\n');
}

/**
 * ⚠⚠ ZOOM DEGRADES TO SILENCE, AND THIS IS PERMANENT — NOT PENDING.
 *
 * `closer_response_verified` requires a MATCHED speaker, and a Zoom call has
 * none: the recording carries a host_id but the VTT carries display names only
 * (measured 2026-08-20 on a real 1012-turn call — no emails, no <v> tags, no
 * ids). Joining host id to a transcript name is the SAME NAME MATCH refused for
 * Fathom, which recorded the closer as the prospect on 6 of 83 calls.
 *
 * So a Zoom-sourced closer has ZERO verified lines and will keep having zero
 * ⚠ SUPERSEDED 2026-08-20 — no longer true. The byte-identical
 * display-name match (lib/zoom-identity) gives Zoom a matched closer, so
 * Zoom-sourced closers DO accumulate verified lines now.
 * ⚠ AND `dashboard_meetings:read:admin` WAS THE WRONG SCOPE ANYWAY: it is
 * Business-plan-only with no user-level variant, and the participants
 * endpoint cannot improve attribution regardless (a VTT carries display
 * names only, so both sides of the join are names). It buys a participant
 * COUNT for collision detection.
 *
 * ⚠ AND NEVER SUBSTITUTE UNVERIFIED LINES TO FILL THE GAP. On an unmatched
 * transcript they are as likely to be the PROSPECT's words as the closer's, so
 * the email would be written in the wrong person's voice with nothing on screen
 * to reveal it. Absent and wrong are not the same, and wrong is worse.
 */
function shouldGroundVoice(speakerConfidence) {
  return speakerConfidence === 'matched';
}

module.exports = {
  VOICE_LINE_COUNT,
  isCleanVoiceLine,
  selectVoiceLines,
  voicePromptBlock,
  shouldGroundVoice,
};
