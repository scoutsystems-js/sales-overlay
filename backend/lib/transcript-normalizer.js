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
 *   - Speaker identity: TranscriptItemSpeaker.display_name is the only
 *     thing Fathom reliably populates today (matched_calendar_invitee_email
 *     is "Coming soon!"). We fuzzy-match recorded_by.name against
 *     transcript display_names to identify the CLOSER; everyone else is
 *     PROSPECT. When no match clears the threshold, we pass display
 *     names through verbatim and the analysis pipeline asks Claude to
 *     infer roles from conversational cues (per the CLAUDE.md Speaker
 *     Identification fallback).
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

    preTurns.push({
      display_name:  displayName,
      text:          text,
      start_seconds: seconds,  // may be null if timestamp unparseable; analysis tolerates
    });

    // Track first encounter of each display_name for the matcher.
    if (displayNamesSeen.indexOf(displayName) === -1) {
      displayNamesSeen.push(displayName);
    }
  }

  // ─── Speaker identification ──────────────────────────────────────────
  var recordedByName = (meeting.recorded_by && typeof meeting.recorded_by.name === 'string')
    ? meeting.recorded_by.name
    : null;
  var matchedCloser = findCloserDisplayName(recordedByName, displayNamesSeen);

  var turns;
  var closerName;
  var speakerConfidence;

  if (matchedCloser) {
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
