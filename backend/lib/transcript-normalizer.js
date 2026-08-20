/**
 * Transcript Normalizer — Scout v2.0 Phase 2 utility
 *
 * Pure module. No DB, no fetch, no side effects. Takes a Fathom meeting
 * object (with optional transcript array, highlights array, and
 * recorded_by field) and produces a normalized shape the analysis
 * pipeline can consume without knowing it's Fathom data. When v1.3.0+
 * adds Zoom or Google Meet adapters, they emit the same shape — the
 * analysis pipeline never changes.
 *
 * Normalization decisions locked here:
 *   - Timestamps: Fathom transcript turns use "HH:MM:SS" strings;
 *     highlights use numeric seconds; we collapse both to numeric
 *     seconds from start of recording. This is also the format Fathom's
 *     deep-link URLs use (https://fathom.video/calls/{id}?t={seconds}).
 *   - Speaker identity: PRIMARY signal is per-turn
 *     `speaker.matched_calendar_invitee_email` compared for EXACT EQUALITY
 *     against the connection's recorded-by email (`meeting.closer_email`).
 *
 *     (The header used to say this field was "Coming soon!" and never
 *     populated. That was STALE and it cost us: because the comment said the
 *     signal didn't exist, the code never looked for it, every call fell to
 *     the model-inference fallback, and ~8% of speaker labels corpus-wide were
 *     wrong — including prospect quotes filed into reps' knowledge bases as
 *     their own winning material. Settled by live fetch 2026-08-11: ONLY the
 *     recorded_by user's turns carry the email — closer 47/47, 551/551,
 *     653/653; prospects 0/180, 0/257. Presence/absence is a perfect
 *     discriminator, so equality needs no threshold and no heuristic.)
 *
 *     RULING (2026-08-11): email equality is the ONLY discriminator the
 *     pipeline uses. No name fallback, no talk-time heuristic, no fuzzy
 *     matching — each of those can and did return the CLOSER as the prospect.
 *     The legacy recorded_by-name fuzzy match below is kept for callers that
 *     still pass `recorded_by`, but the Fathom and Zoom paths pass null and
 *     MUST NOT be wired to it.
 *
 *     RULING 1 (2026-08-11): the email is resolved to a role here and then
 *     DISCARDED. It is never copied onto a turn, because `turns` is persisted
 *     verbatim into `call_analyses.transcript_stored` — writing a personal
 *     email onto every row of every transcript would spread PII for no
 *     downstream gain, since the label is the only thing anything reads.
 *
 *     When no email signal is available (no connection email, a Zoom VTT, or
 *     a call recorded by a different workspace member) we pass display names
 *     through verbatim and the pipeline asks Claude to infer roles. That path
 *     is a GUESS and is recorded as such via speaker_confidence='unknown' —
 *     downstream surfaces must not present it as established fact.
 *
 * Three possible speaker_confidence values:
 *   - 'matched'  — fuzzy match found; speakers tagged CLOSER/PROSPECT
 *   - 'unknown'  — no match; speakers tagged with raw display_name strings
 *   - 'inferred' — set DOWNSTREAM by the analysis pipeline after Claude
 *                  infers the closer; the normalizer never sets this.
 *
 * The output `turns[].speaker` field carries either CLOSER/PROSPECT
 * (matched case) OR the raw display_name string (unknown case). Callers
 * must check `speaker_confidence` before assuming the controlled
 * vocabulary.
 */

// Zoom speaker identity: byte-identical display-name match + the two-person
// collision detector. Kept in its own module because the reasoning for why it
// is NOT the refused fuzzy name match belongs beside the rule, not here.
var zoomIdentity = require('./zoom-identity');

/**
 * Convert a duration-style timestamp string to integer seconds.
 *
 * Accepts two formats:
 *   "HH:MM:SS"  → hours*3600 + minutes*60 + seconds
 *   "MM:SS"     → minutes*60 + seconds
 *
 * Validation:
 *   - Each segment must be a non-negative decimal integer (no signs,
 *     no decimals, no whitespace inside).
 *   - In HH:MM:SS form, minutes must be < 60 and seconds must be < 60.
 *     Hours are unbounded — long recordings are valid.
 *   - In MM:SS form, seconds must be < 60. Minutes are unbounded for
 *     safety (a 90-minute log might emit "90:00").
 *
 * Returns null for any malformed input (non-string, empty, wrong colon
 * count, non-integer segments, out-of-range segments). Never throws.
 *
 * @param {string} str
 * @returns {number|null}
 */
function hhmmssToSeconds(str) {
  if (typeof str !== 'string') return null;
  var trimmed = str.trim();
  if (!trimmed) return null;

  var parts = trimmed.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  // Each segment must be a non-empty run of decimal digits.
  var nums = new Array(parts.length);
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) return null;
    nums[i] = parseInt(parts[i], 10);
  }

  if (parts.length === 3) {
    var hours = nums[0], minutes = nums[1], seconds = nums[2];
    if (minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  // MM:SS
  var mm = nums[0], ss = nums[1];
  if (ss >= 60) return null;
  return mm * 60 + ss;
}

/**
 * Internal: fuzzy-match a recorded_by name against a list of transcript
 * display names. Bidirectional case-insensitive substring match — either
 * direction counts as a hit (recorded_by="John" matches display="John Smith"
 * AND recorded_by="John Smith" matches display="John").
 *
 * Returns the FIRST matching display_name on success, or null when no
 * candidate matches. When multiple candidates match, the first in the
 * input array wins — ambiguity is documented in the JSDoc on the
 * exported normalizeTranscript() function.
 *
 * @param {string|null} recordedByName
 * @param {string[]} displayNames
 * @returns {string|null}
 */
function findCloserDisplayName(recordedByName, displayNames) {
  if (typeof recordedByName !== 'string' || !recordedByName.trim()) return null;
  if (!Array.isArray(displayNames) || displayNames.length === 0) return null;

  var recLower = recordedByName.trim().toLowerCase();
  for (var i = 0; i < displayNames.length; i++) {
    var dn = displayNames[i];
    if (typeof dn !== 'string' || !dn.trim()) continue;
    var dnLower = dn.trim().toLowerCase();
    // Bidirectional substring match. Either direction is a hit.
    if (dnLower.indexOf(recLower) !== -1 || recLower.indexOf(dnLower) !== -1) {
      return dn;
    }
  }
  return null;
}

/**
 * Normalize a raw Fathom Meeting object into the source-agnostic shape
 * the analysis pipeline consumes.
 *
 * Input: a Meeting as returned by Fathom's GET /meetings?include_transcript=
 * true endpoint (or the equivalent shape from a future Zoom/Meet adapter).
 * Missing top-level fields are tolerated — null `meeting`, missing
 * transcript, missing highlights, missing recorded_by all degrade
 * gracefully rather than throwing.
 *
 * Output:
 * {
 *   turns: [
 *     {
 *       speaker: 'CLOSER' | 'PROSPECT' | string,  // raw display_name when speaker_confidence='unknown'
 *       display_name: string,                      // always the original Fathom display_name
 *       text: string,
 *       start_seconds: number | null               // null when timestamp was unparseable
 *     },
 *     ...
 *   ],
 *   highlights: [
 *     {
 *       type: string,                              // Fathom's bookmark label (e.g., "Question")
 *       summary: string | null,
 *       text: string | null,                       // present only when it differs from summary
 *       start_seconds: number,                     // already numeric in Fathom
 *       end_seconds: number
 *     },
 *     ...
 *   ],
 *   closer_name: string | null,                    // the display_name we identified as CLOSER (null when speaker_confidence='unknown')
 *   speaker_confidence: 'matched' | 'unknown'      // 'inferred' is set DOWNSTREAM by the analysis pipeline
 * }
 *
 * Edge cases:
 *   - Turns missing both `text` and `speaker.display_name` are dropped
 *     (no signal for the analysis pipeline to use).
 *   - When multiple display_names match recorded_by.name (e.g., closer
 *     and their named co-host share a first name), the first in encounter
 *     order wins. Callers wanting stricter disambiguation should pre-filter
 *     the meeting's calendar_invitees before calling.
 *   - Highlights with non-numeric start/end times are dropped.
 *
 * @param {object|null} meeting
 * @returns {{turns: Array, highlights: Array, closer_name: string|null, speaker_confidence: string}}
 */
function normalizeTranscript(meeting) {
  var EMPTY = { turns: [], highlights: [], closer_name: null, speaker_confidence: 'unknown' };
  if (!meeting || typeof meeting !== 'object') return EMPTY;

  // ─── Highlights pass-through ─────────────────────────────────────────
  // Fathom highlights already carry numeric seconds (start_time/end_time).
  // We rename to start_seconds/end_seconds to match the source-agnostic
  // contract and drop any with non-numeric times.
  var rawHighlights = Array.isArray(meeting.highlights) ? meeting.highlights : [];
  var highlights = [];
  for (var hi = 0; hi < rawHighlights.length; hi++) {
    var h = rawHighlights[hi];
    if (!h || typeof h !== 'object') continue;
    if (typeof h.start_time !== 'number' || typeof h.end_time !== 'number') continue;
    highlights.push({
      type:          (typeof h.type === 'string') ? h.type : null,
      summary:       (typeof h.summary === 'string') ? h.summary : null,
      text:          (typeof h.text === 'string') ? h.text : null,
      start_seconds: Math.floor(h.start_time),
      end_seconds:   Math.floor(h.end_time),
    });
  }

  // ─── Transcript turns: timestamp normalization + speaker collection ──
  var rawTurns = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  var preTurns = [];                  // turns with display_name + text + parsed seconds, role TBD
  var displayNamesSeen = [];          // unique display_names in encounter order

  for (var ti = 0; ti < rawTurns.length; ti++) {
    var t = rawTurns[ti];
    if (!t || typeof t !== 'object') continue;
    var speakerObj = (t.speaker && typeof t.speaker === 'object') ? t.speaker : null;
    var displayName = speakerObj && typeof speakerObj.display_name === 'string' ? speakerObj.display_name : '';
    var text = (typeof t.text === 'string') ? t.text : '';
    // Drop turns with no signal — neither name nor text is usable.
    if (!displayName.trim() && !text.trim()) continue;
    // Drop turns without a speaker name — analysis pipeline can't attribute them.
    if (!displayName.trim()) continue;

    var seconds = hhmmssToSeconds(t.timestamp);

    // Per-turn invitee email, normalized for comparison ONLY. Deliberately held
    // on the intermediate `preTurns` and dropped before output (RULING 1).
    var turnEmail = (typeof speakerObj.matched_calendar_invitee_email === 'string')
      ? speakerObj.matched_calendar_invitee_email.trim().toLowerCase()
      : null;

    preTurns.push({
      display_name:  displayName,
      text:          text,
      start_seconds: seconds,  // may be null if timestamp unparseable; analysis tolerates
      email:         turnEmail || null,
    });

    // Track first encounter of each display_name for the matcher.
    if (displayNamesSeen.indexOf(displayName) === -1) {
      displayNamesSeen.push(displayName);
    }
  }

  // ─── Speaker identification ──────────────────────────────────────────
  // PRIMARY: exact equality on the per-turn invitee email. Only the recorded_by
  // user's turns carry it, so a match is proof rather than evidence.
  var closerEmail = (typeof meeting.closer_email === 'string' && meeting.closer_email.trim())
    ? meeting.closer_email.trim().toLowerCase()
    : null;

  var emailCloserName = null;
  if (closerEmail) {
    for (var ei = 0; ei < preTurns.length; ei++) {
      if (preTurns[ei].email && preTurns[ei].email === closerEmail) {
        emailCloserName = preTurns[ei].display_name;
        break;
      }
    }
  }

  // ZOOM: byte-identical display-name match against the connected account's
  // own Zoom profile name, guarded by the two-person collision detector.
  // ⚠ THIS IS AN EQUALITY TEST, NOT A RESEMBLANCE TEST — see lib/zoom-identity
  // for why that distinction is the whole feature, and why it must never be
  // relaxed into normalisation. A Zoom VTT carries display names ONLY (no
  // emails, no <v> tags, no ids — measured on a real 1012-turn call), so the
  // email branch above can never fire on a Zoom call.
  var zoomCloser = { closerName: null, reason: 'not_zoom' };
  if (!emailCloserName && typeof meeting.closer_display_name === 'string') {
    zoomCloser = zoomIdentity.resolveZoomCloser(meeting.closer_display_name, displayNamesSeen);
  }

  // LEGACY (unwired): recorded_by-name fuzzy match. The Fathom and Zoom paths
  // both pass recorded_by:null — see the RULING in the header before wiring it.
  // ⚠ DO NOT read the Zoom branch above as this rule being revived: that one
  // asks "does this LOOK LIKE the name?" against an open world and recorded the
  // CLOSER as the PROSPECT on 6 of 83 real calls. This asks "is this the SAME
  // BYTES as the name Zoom itself has on file?" inside a closed set.
  var recordedByName = (meeting.recorded_by && typeof meeting.recorded_by.name === 'string')
    ? meeting.recorded_by.name
    : null;
  var matchedCloser = findCloserDisplayName(recordedByName, displayNamesSeen);

  var turns;
  var closerName;
  var speakerConfidence;

  if (!emailCloserName && zoomCloser.closerName) {
    // Label by the matched display name. Same shape as the email branch, but
    // the identity came from Zoom's account profile rather than a per-turn
    // invitee email.
    turns = preTurns.map(function(p) {
      return {
        speaker:       (p.display_name === zoomCloser.closerName) ? 'CLOSER' : 'PROSPECT',
        display_name:  p.display_name,
        text:          p.text,
        start_seconds: p.start_seconds,
      };
    });
    closerName = zoomCloser.closerName;
    speakerConfidence = 'matched';
  } else if (emailCloserName) {
    // Label by EMAIL, not by the matched display name — Fathom sometimes splits
    // one speaker across two display names, and the email survives that.
    turns = preTurns.map(function(p) {
      return {
        speaker:       (p.email === closerEmail) ? 'CLOSER' : 'PROSPECT',
        display_name:  p.display_name,
        text:          p.text,
        start_seconds: p.start_seconds,
        // NOTE: `email` deliberately absent — RULING 1.
      };
    });
    closerName = emailCloserName;
    speakerConfidence = 'matched';
  } else if (matchedCloser) {
    // Matched case: tag CLOSER vs PROSPECT.
    turns = preTurns.map(function(p) {
      return {
        speaker:       (p.display_name === matchedCloser) ? 'CLOSER' : 'PROSPECT',
        display_name:  p.display_name,
        text:          p.text,
        start_seconds: p.start_seconds,
      };
    });
    closerName = matchedCloser;
    speakerConfidence = 'matched';
  } else {
    // Unknown case: pass display_name through as `speaker`. Downstream
    // Claude inference will resolve roles.
    turns = preTurns.map(function(p) {
      return {
        speaker:       p.display_name,
        display_name:  p.display_name,
        text:          p.text,
        start_seconds: p.start_seconds,
      };
    });
    closerName = null;
    speakerConfidence = 'unknown';
  }

  return {
    turns:              turns,
    highlights:         highlights,
    closer_name:        closerName,
    speaker_confidence: speakerConfidence,
  };
}

module.exports = {
  normalizeTranscript:     normalizeTranscript,
  hhmmssToSeconds:         hhmmssToSeconds,
  // Exported for tests / future module-internal callers.
  _findCloserDisplayName:  findCloserDisplayName,
};
