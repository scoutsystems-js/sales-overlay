/**
 * Analysis Worker — Scout v2.0 Phase 2
 *
 * Picks up one fathom_calls row at a time and produces the structured coaching
 * output the dashboard's Call Review page renders: a row in call_analyses
 * (overall summary + 5 section grades + one-thing + follow-up email) plus 5-8
 * rows in call_highlights (timestamped moments).
 *
 * Trigger: fire-and-forget IIFE in routes/fathom.js after /sync upserts new
 * rows. Sequential per-user dispatch (not parallel) — Anthropic rate limits +
 * predictable ordering in the dashboard. Closers never wait; the /sync
 * response has already been sent by the time the worker runs.
 *
 * Pipeline (per call):
 *   1. Mark call_analyses status='processing' (upsert; idempotent for re-runs)
 *   2. Load the fathom_calls row → fathom_call_id (Fathom's recording_id) + call_date
 *   3. Load fathom_connections, refresh access token if needed
 *   4. Fetch the meeting (transcript + highlights inline) by paginating
 *      /meetings with created_after = call_date - 10min, walking up to
 *      MAX_SEARCH_PAGES pages looking for matching recording_id
 *   5. Normalize via transcript-normalizer (HH:MM:SS + numeric → numeric seconds,
 *      CLOSER/PROSPECT speaker identification)
 *   6. Two parallel Claude calls (section grader + highlight extractor)
 *   7. Persist: upsert call_analyses with all fields; delete + insert call_highlights
 *   8. Mark fathom_calls.sync_status='processed' (Phase 2 worker's job per migration 009)
 *
 * Error handling: any phase failure marks call_analyses.status='error' with
 * the reason in overall_summary, then returns. Caller (the /sync IIFE) logs
 * but does not propagate — analysis failures never block sync completion.
 *
 * JSON parsing: all Claude output goes through extractFirstJsonObject /
 * extractFirstJsonArray (brace-balanced + bracket-balanced walks). Verbatim
 * port from routes/me.js after v1.1.10 backfill found JSON.parse() failing
 * 100% of the time when Claude wrapped JSON in narrative prose.
 *
 * Section grader does NOT yet consume the closer's uploaded script as a
 * benchmark or KB winning-call comparisons — deferred to a follow-up commit
 * per the brief. Foundational pipeline first; KB-grounded grading second.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { CLAUDE_MODEL } = require('../config');
const { normalizeTranscript } = require('./transcript-normalizer');
const fathomRoutes = require('../routes/fathom');

// ─── Schema-locked vocabularies (mirror migration 010 CHECK constraints) ────
const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];
const VALID_HIGHLIGHT_TYPES = [
  'buying_signal',
  'objection',
  'missed_opportunity',
  'strong_moment',
  'rapport_moment',
  'disqualify_signal',
];
const VALID_HIGHLIGHT_SPEAKERS = ['CLOSER', 'PROSPECT'];

// ─── Tuning ────────────────────────────────────────────────────────────────
const MAX_SEARCH_PAGES   = 3;                // upper bound on /meetings pagination when finding one specific call
const SEARCH_WINDOW_MS   = 10 * 60 * 1000;   // created_after = call_date - 10min (Fathom's `created` is close to but not identical to recording_start_time)
const MAX_HIGHLIGHTS     = 8;                // hard cap — schema-free but the dashboard layout assumes <=8
const GRADER_MAX_TOKENS  = 3000;             // 5 sections × ~300 tokens of notes + overall + follow-up = comfortable headroom
const HIGHLIGHT_MAX_TOK  = 3000;             // 8 highlights × ~300 tokens each

// ─── Lazy clients — same pattern as routes/me.js + routes/proxy.js ─────────
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  }
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ─── JSON extraction (verbatim port from routes/me.js extractFirstJsonObject) ──
// Strip ```json / ``` fences from Claude responses. Same pattern as
// call-memory.js — Claude sometimes ignores "no fences" prompt instructions.
function stripCodeFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Extract the first balanced JSON object from a string. Tolerates Claude
// wrapping JSON in prose, markdown fences, or trailing commentary. Returns
// the parsed object or null on failure. Switched into use in v1.1.10 after
// strict JSON.parse failed 100% of the time on narrative-wrapped output.
function extractFirstJsonObject(text) {
  if (!text) return null;
  var cleaned = stripCodeFences(text);
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }
  var start = cleaned.indexOf('{');
  if (start === -1) return null;
  var depth = 0;
  var inString = false;
  var escape = false;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

// Sibling for arrays — same brace-walk logic, swapped for square brackets.
// Used by the highlight extractor whose output is a JSON array, not an object.
function extractFirstJsonArray(text) {
  if (!text) return null;
  var cleaned = stripCodeFences(text);
  try {
    var direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
  } catch (_) { /* fall through */ }
  var start = cleaned.indexOf('[');
  if (start === -1) return null;
  var depth = 0;
  var inString = false;
  var escape = false;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          var parsed = JSON.parse(cleaned.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch (_) { return null; }
      }
    }
  }
  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatSeconds(s) {
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
}

// Render the normalized turn array as plain text Claude can grade against.
// Keeps timestamps + speakers + raw text on each line so notes can quote
// "[00:12:04] CLOSER: 'we can do that for $5k'" verbatim.
function formatTurnsForPrompt(turns) {
  return turns.map(function(t) {
    var ts = (t.start_seconds != null) ? formatSeconds(t.start_seconds) : '--:--:--';
    return '[' + ts + '] ' + t.speaker + ': ' + (t.text || '');
  }).join('\n');
}

// Find the Fathom meeting matching one recording_id by walking /meetings
// filtered by created_after = (call_date - 10min). Up to MAX_SEARCH_PAGES
// pages — past that we surface "not found" rather than blow Anthropic budget
// on an open-ended scan. Acceptable here because the trigger fires immediately
// after sync, so we know the recording_id exists and is recent.
//
// NB: the `recordingId` parameter is Fathom's id (the string we store in
// fathom_calls.fathom_call_id), NOT our internal fathom_calls(id) UUID — they
// have the same column name in the schema by historical accident.
async function findMeeting(accessToken, recordingId, callDate) {
  var createdAfter = null;
  if (callDate) {
    var startMs = new Date(callDate).getTime();
    if (!isNaN(startMs)) {
      createdAfter = new Date(startMs - SEARCH_WINDOW_MS).toISOString();
    }
  }
  var cursor = null;
  var pagesWalked = 0;
  for (var page = 0; page < MAX_SEARCH_PAGES; page++) {
    var data = await fathomRoutes._fetchMeetingsPage(accessToken, cursor, createdAfter, true, true);
    pagesWalked++;
    var items = Array.isArray(data.items) ? data.items : [];
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].recording_id) === String(recordingId)) {
        return { meeting: items[i], pagesWalked: pagesWalked };
      }
    }
    cursor = (typeof data.next_cursor === 'string' && data.next_cursor) ? data.next_cursor : null;
    if (!cursor) break;
  }
  return { meeting: null, pagesWalked: pagesWalked };
}

// ─── Section Grader prompt ────────────────────────────────────────────────
function buildSectionGraderPrompt(normalized, durationSeconds) {
  var transcriptText = formatTurnsForPrompt(normalized.turns);
  var durationLabel = (durationSeconds != null) ? Math.round(durationSeconds / 60) + ' minutes' : 'unknown duration';
  var closerLabel = (normalized.speaker_confidence === 'matched')
    ? 'The closer is "' + normalized.closer_name + '", labeled CLOSER in the transcript. The prospect is labeled PROSPECT.'
    : 'Speaker identity is uncertain — the transcript shows raw display names. Infer who the closer is from conversational cues (asks discovery questions, makes the pitch, handles objections). Map both roles to CLOSER and PROSPECT in your evidence quotes.';

  return [
    'You are an expert sales coach reviewing a transcript of a high-ticket sales call. Grade five sections on a 0-100 spectrum (NOT pass/fail), each with a letter grade A-F.',
    '',
    'CRITICAL: Every claim in `notes` MUST cite a specific transcript line by quoting it with its [HH:MM:SS] timestamp. No unsupported assertions, no generic feedback, no cheerleading.',
    '',
    'Call duration: ' + durationLabel + '.',
    closerLabel,
    '',
    'Five sections to grade:',
    '  1. INTRO       — did the closer set frame and control from the first 60 seconds, establish credibility without overselling, set a clear agenda the prospect agreed to',
    '  2. DISCOVERY   — emotional pain depth (not just surface problem), specific dollar/timeline commitment, decision-maker confirmed present, \'why now\' urgency established',
    '  3. PITCH       — solution framing tied directly to discovery findings',
    '  4. OBJECTION   — handling resistance via isolation + framework rebuttal',
    '  5. CLOSE       — was a clear assumptive or direct close attempted, was price presented confidently without apologizing, were final objections handled before the call ended',
    '',
    'For each section return: {"grade":"A"|"B"|"C"|"D"|"F","score":0-100,"notes":"<evidence + reasoning, including 1-2 quoted transcript lines with timestamps>"}',
    'If a section did not occur (e.g. no objections were raised), return {"grade":null,"score":null,"notes":"Section did not occur in this call."} — null is honest.',
    '',
    'Then provide call-level fields:',
    '  - overall_score: 0-100, weighted gestalt across sections that occurred',
    '  - overall_summary: 2-3 sentences. Factual only — no encouragement, no softening. State what happened, what stage was reached, and what the apparent outcome was.',
    '  - one_thing: the single most actionable behavioral change for the closer\'s next call — specific, not generic. Bad: "ask better discovery questions." Good: "when the prospect mentioned the $50k loan at [00:08:21], you moved straight to pitch instead of isolating the urgency — pause and ask \'what would change if you didn\'t solve this in 60 days?\' next time."',
    '  - follow_up_email: a draft the closer can copy + send today. Reference specific moments from this call. First-person, written as the closer (not an AI). No \'I hope this finds you well\', no \'don\'t hesitate to reach out\'. Sound like a real person following up on a real conversation. Under 200 words.',
    '',
    'Respond with ONLY this JSON object — no markdown, no code fences, no narrative wrapping:',
    '{',
    '  "intro":     {"grade":"...","score":N,"notes":"..."},',
    '  "discovery": {"grade":"...","score":N,"notes":"..."},',
    '  "pitch":     {"grade":"...","score":N,"notes":"..."},',
    '  "objection": {"grade":"...","score":N,"notes":"..."},',
    '  "close":     {"grade":"...","score":N,"notes":"..."},',
    '  "overall_score": N,',
    '  "overall_summary": "...",',
    '  "one_thing": "...",',
    '  "follow_up_email": "..."',
    '}',
    '',
    'TRANSCRIPT:',
    transcriptText,
  ].join('\n');
}

// ─── Highlight Extractor prompt ───────────────────────────────────────────
function buildHighlightExtractorPrompt(normalized) {
  var transcriptText = formatTurnsForPrompt(normalized.turns);
  var speakerNote = (normalized.speaker_confidence === 'matched')
    ? 'The closer is labeled CLOSER, the prospect PROSPECT.'
    : 'Speaker identity is uncertain — the transcript shows raw display names. Infer CLOSER vs PROSPECT from conversational cues and map both to those two labels in your output.';

  return [
    'You are a film coach reviewing tape. Extract 5-8 critical moments from this sales call transcript. Be factual, not cheerleading and not critical for its own sake. When two moments are related (the same objection reappears later, an early signal gets confirmed, a missed opportunity has a callback), connect them in the observation field — that pattern-spotting is the whole point of the timeline view.',
    '',
    speakerNote,
    '',
    'For each moment include:',
    '  - timestamp_seconds: integer seconds from start of recording (read from the [HH:MM:SS] tag on the line, convert to seconds)',
    '  - speaker: exactly "CLOSER" or "PROSPECT"',
    '  - quote: the exact words spoken at that moment (5-30 words, trim filler)',
    '  - observation: one factual sentence, 25 words max. Describe what happened. No commentary, no validation, no "great job" or "should have done X". If two moments are part of the same pattern, the second observation may reference the first by timestamp.',
    '  - type: exactly one of these six values:',
    '      "buying_signal"      — prospect indicates intent (asks about onboarding, mentions next steps, asks price/timing like a buyer)',
    '      "objection"          — prospect raises a concern (money, time, spouse, doubt, comparison shopping)',
    '      "missed_opportunity" — closer let a discovery thread, pain signal, or buying cue slip without follow-up',
    '      "strong_moment"      — closer executed a framework cleanly (V-L-F-A-R, identity shift, isolation, etc.)',
    '      "rapport_moment"     — closer or prospect built genuine connection (humor, shared experience, vulnerability)',
    '      "disqualify_signal"  — prospect revealed they\'re not a real fit (no budget, no decision authority, wrong stage)',
    '',
    'Order moments chronologically (earliest first).',
    '',
    'Quality gate: if fewer than 5 genuinely high-signal moments exist in this call, return only the ones that qualify. Never pad to reach a minimum count. An array of 3 honest moments is better than 8 diluted ones.',
    '',
    'Respond with ONLY a JSON array — no markdown, no code fences, no narrative wrapping:',
    '[',
    '  {"timestamp_seconds":N,"speaker":"CLOSER","quote":"...","observation":"...","type":"..."},',
    '  ...',
    ']',
    '',
    'TRANSCRIPT:',
    transcriptText,
  ].join('\n');
}

// ─── Output sanitizers ────────────────────────────────────────────────────
// Validates Claude's section output against the schema CHECK constraints.
// Coerces invalid values to NULL rather than throwing — partial output is
// better than no analysis. The schema allows NULL on every section column.
function sanitizeSection(s) {
  if (!s || typeof s !== 'object') return { grade: null, score: null, notes: null };
  var grade = (typeof s.grade === 'string' && VALID_GRADES.indexOf(s.grade.toUpperCase()) !== -1)
    ? s.grade.toUpperCase()
    : null;
  var score = (typeof s.score === 'number' && s.score >= 0 && s.score <= 100)
    ? Math.round(s.score)
    : null;
  var notes = (typeof s.notes === 'string') ? s.notes.slice(0, 4000) : null;
  return { grade: grade, score: score, notes: notes };
}

// Validates the highlight array — drops any row with the wrong shape or
// out-of-vocabulary type/speaker. Caps at MAX_HIGHLIGHTS. Assigns
// sequence_order in encounter order (Claude is asked to sort chronologically
// already, but we don't rely on it).
function sanitizeHighlights(arr, durationSeconds) {
  if (!Array.isArray(arr)) return [];
  var out = [];
  for (var i = 0; i < arr.length && out.length < MAX_HIGHLIGHTS; i++) {
    var h = arr[i];
    if (!h || typeof h !== 'object') continue;
    var ts = (typeof h.timestamp_seconds === 'number') ? Math.floor(h.timestamp_seconds) : null;
    if (ts == null || ts < 0) continue;
    // Don't accept timestamps wildly outside the call's duration (defense
    // against Claude hallucinating a moment past the end). +60s grace allowed.
    if (durationSeconds != null && ts > durationSeconds + 60) continue;
    var speaker = (typeof h.speaker === 'string') ? h.speaker.toUpperCase() : null;
    if (VALID_HIGHLIGHT_SPEAKERS.indexOf(speaker) === -1) continue;
    if (typeof h.quote !== 'string' || !h.quote.trim()) continue;
    if (typeof h.observation !== 'string' || !h.observation.trim()) continue;
    var type = (typeof h.type === 'string') ? h.type.toLowerCase() : null;
    if (VALID_HIGHLIGHT_TYPES.indexOf(type) === -1) continue;
    out.push({
      timestamp_seconds: ts,
      speaker:           speaker,
      quote:             h.quote.trim().slice(0, 1000),
      observation:       h.observation.trim().slice(0, 500),
      type:              type,
      sequence_order:    out.length + 1,
    });
  }
  return out;
}

// Upserts a call_analyses row to the given status. Used for the initial
// "processing" mark AND for terminal "error" / "done" updates. Pass extraFields
// to populate columns alongside the status (analyzed_at, overall_summary,
// section grades, etc.).
//
// onConflict='fathom_call_id' makes this idempotent — re-runs replace prior
// analysis rather than dup-error. Non-fatal on failure: logs and continues so
// a write-during-error path doesn't mask the original failure.
async function setAnalysisStatus(admin, fathomCallId, userId, status, extraFields) {
  var payload = Object.assign({
    fathom_call_id: fathomCallId,
    user_id:        userId,
    status:         status,
  }, extraFields || {});
  var result = await admin
    .from('call_analyses')
    .upsert(payload, { onConflict: 'fathom_call_id' });
  if (result.error) {
    console.error('[analysis] setAnalysisStatus(' + status + ') failed for call ' + fathomCallId + ': ' + result.error.message);
  }
  return result;
}

// Flip fathom_calls.sync_status to 'error' so the row is distinguishable
// from never-attempted ('pending') and successfully-analyzed ('processed').
// Called alongside setAnalysisStatus(..., 'error', ...) at every error exit
// in analyzeCall — without this, the call sticks in 'pending' forever
// because /sync only dispatches newly-inserted rows. A future manual retry
// route + dashboard button (Phase 2 follow-up) will target sync_status='error'
// rows. Non-fatal on failure: logs and continues so a write-during-error path
// doesn't mask the original failure.
async function markFathomCallErrored(admin, fathomCallId, userId) {
  var result = await admin
    .from('fathom_calls')
    .update({ sync_status: 'error' })
    .eq('id', fathomCallId)
    .eq('user_id', userId);
  if (result.error) {
    console.error('[analysis] markFathomCallErrored failed for call ' + fathomCallId + ': ' + result.error.message);
  }
  return result;
}

/**
 * Analyze a single Fathom call end-to-end. Designed for the fire-and-forget
 * IIFE in routes/fathom.js /sync, but safe for manual re-runs (idempotent
 * upserts; old highlights deleted before fresh insert).
 *
 * @param {string} fathomCallId  the public.fathom_calls(id) UUID, NOT Fathom's recording_id
 * @param {string} userId        auth.users(id)
 * @returns {Promise<{status: 'done'|'error', ...}>}
 */
async function analyzeCall(fathomCallId, userId) {
  var admin = getAdminClient();

  try {
    // ─── Phase 1: mark processing ─────────────────────────────────────────
    await setAnalysisStatus(admin, fathomCallId, userId, 'processing');

    // ─── Phase 2: load the fathom_calls row ───────────────────────────────
    var callQ = await admin
      .from('fathom_calls')
      .select('id, fathom_call_id, call_date, duration_seconds, user_id')
      .eq('id', fathomCallId)
      .maybeSingle();
    if (callQ.error) throw new Error('fathom_calls fetch: ' + callQ.error.message);
    if (!callQ.data) throw new Error('fathom_calls row not found: ' + fathomCallId);
    if (callQ.data.user_id !== userId) {
      throw new Error('Scope mismatch: call ' + fathomCallId + ' does not belong to user ' + userId);
    }
    var callRow = callQ.data;

    // ─── Phase 3: load Fathom connection + refresh token if needed ────────
    var connQ = await admin
      .from('fathom_connections')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (connQ.error) throw new Error('fathom_connections fetch: ' + connQ.error.message);
    if (!connQ.data) throw new Error('Fathom connection not found for user ' + userId);
    var accessToken = await fathomRoutes._getValidAccessToken(admin, userId, connQ.data);

    // ─── Phase 4: find the meeting on Fathom (transcript + highlights inline) ──
    var found = await findMeeting(accessToken, callRow.fathom_call_id, callRow.call_date);
    if (!found.meeting) {
      var notFoundReason = 'Fathom returned no meeting matching recording_id ' + callRow.fathom_call_id + ' within ' + found.pagesWalked + ' page(s)';
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: notFoundReason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + notFoundReason + ' (call=' + fathomCallId + ' user=' + userId + ')');
      return { status: 'error', reason: notFoundReason };
    }
    var meeting = found.meeting;

    // ─── Phase 5: normalize ──────────────────────────────────────────────
    var normalized = normalizeTranscript(meeting);
    if (!normalized.turns || normalized.turns.length === 0) {
      var emptyReason = 'Fathom meeting has no transcript turns (recording_id ' + callRow.fathom_call_id + ')';
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: emptyReason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + emptyReason + ' (call=' + fathomCallId + ')');
      return { status: 'error', reason: emptyReason };
    }

    // ─── Phase 6: two parallel Claude calls ──────────────────────────────
    var anthropic = getAnthropic();
    var sectionPrompt   = buildSectionGraderPrompt(normalized, callRow.duration_seconds);
    var highlightPrompt = buildHighlightExtractorPrompt(normalized);

    var graderPromise = anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: GRADER_MAX_TOKENS,
      messages:   [{ role: 'user', content: sectionPrompt }],
    });
    var highlighterPromise = anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: HIGHLIGHT_MAX_TOK,
      messages:   [{ role: 'user', content: highlightPrompt }],
    });

    var settled = await Promise.all([graderPromise, highlighterPromise]);
    var graderResp     = settled[0];
    var highlighterResp = settled[1];

    var graderText     = graderResp.content[0] ? graderResp.content[0].text : '';
    var highlighterText = highlighterResp.content[0] ? highlighterResp.content[0].text : '';

    // Grader output is the load-bearing one — if it doesn't parse, the whole
    // analysis is unusable. Mark error and bail.
    var graderParsed = extractFirstJsonObject(graderText);
    if (!graderParsed) {
      var graderReason = 'Section grader returned unparseable JSON: ' + graderText.slice(0, 200);
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: graderReason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + graderReason);
      return { status: 'error', reason: graderReason };
    }
    // Highlight failure is non-fatal — we still ship the grades. Stored as
    // zero highlights (the review page renders "No highlights extracted").
    var highlightParsed = extractFirstJsonArray(highlighterText);
    if (!highlightParsed) {
      console.warn('[analysis] highlight extractor returned unparseable JSON for ' + fathomCallId + ' — proceeding with grades only');
    }

    // ─── Phase 7: persist ────────────────────────────────────────────────
    var intro     = sanitizeSection(graderParsed.intro);
    var discovery = sanitizeSection(graderParsed.discovery);
    var pitch     = sanitizeSection(graderParsed.pitch);
    var objection = sanitizeSection(graderParsed.objection);
    var close     = sanitizeSection(graderParsed.close);
    var overallScore = (typeof graderParsed.overall_score === 'number'
                         && graderParsed.overall_score >= 0
                         && graderParsed.overall_score <= 100)
      ? Math.round(graderParsed.overall_score)
      : null;

    var analysisPayload = {
      fathom_call_id:      fathomCallId,
      user_id:             userId,
      overall_score:       overallScore,
      overall_summary:     (typeof graderParsed.overall_summary === 'string') ? graderParsed.overall_summary.slice(0, 3000) : null,
      intro_grade:         intro.grade,
      intro_score:         intro.score,
      intro_notes:         intro.notes,
      discovery_grade:     discovery.grade,
      discovery_score:     discovery.score,
      discovery_notes:     discovery.notes,
      pitch_grade:         pitch.grade,
      pitch_score:         pitch.score,
      pitch_notes:         pitch.notes,
      objection_grade:     objection.grade,
      objection_score:     objection.score,
      objection_notes:     objection.notes,
      close_grade:         close.grade,
      close_score:         close.score,
      close_notes:         close.notes,
      one_thing:           (typeof graderParsed.one_thing === 'string') ? graderParsed.one_thing.slice(0, 2000) : null,
      follow_up_email:     (typeof graderParsed.follow_up_email === 'string') ? graderParsed.follow_up_email.slice(0, 5000) : null,
      transcript_stored:   { turns: normalized.turns, highlights: normalized.highlights },
      speaker_closer_name: normalized.closer_name,
      analyzed_at:         new Date().toISOString(),
      status:              'done',
    };
    var upsert = await admin
      .from('call_analyses')
      .upsert(analysisPayload, { onConflict: 'fathom_call_id' });
    if (upsert.error) throw new Error('call_analyses upsert: ' + upsert.error.message);

    // Highlights: delete existing for this call, then insert fresh. Re-analysis
    // semantics (per the brief): old highlights gone, new highlights win.
    var del = await admin
      .from('call_highlights')
      .delete()
      .eq('fathom_call_id', fathomCallId);
    if (del.error) {
      // Non-fatal — log and continue. Worst case: stale highlights linger
      // alongside the new ones; the dashboard can dedupe at render time.
      console.warn('[analysis] highlight delete failed for ' + fathomCallId + ': ' + del.error.message);
    }
    var sanitizedHighlights = sanitizeHighlights(highlightParsed, callRow.duration_seconds);
    if (sanitizedHighlights.length > 0) {
      var highlightRows = sanitizedHighlights.map(function(h) {
        return Object.assign({ fathom_call_id: fathomCallId, user_id: userId }, h);
      });
      var hIns = await admin.from('call_highlights').insert(highlightRows);
      if (hIns.error) {
        // Non-fatal — grades are already saved. Log loudly.
        console.warn('[analysis] highlight insert failed for ' + fathomCallId + ': ' + hIns.error.message);
      }
    }

    // ─── Phase 8: advance fathom_calls.sync_status ───────────────────────
    var processed = await admin
      .from('fathom_calls')
      .update({ sync_status: 'processed' })
      .eq('id', fathomCallId)
      .eq('user_id', userId);
    if (processed.error) {
      console.warn('[analysis] fathom_calls sync_status flip failed for ' + fathomCallId + ': ' + processed.error.message);
    }

    console.log('[analysis] Done for call ' + fathomCallId + ' (user=' + userId + ', overall=' + overallScore + ', highlights=' + sanitizedHighlights.length + ')');
    return {
      status:            'done',
      overall_score:     overallScore,
      highlights_count:  sanitizedHighlights.length,
      speaker_confidence: normalized.speaker_confidence,
    };
  } catch (err) {
    var msg = (err && err.message) || 'unknown';
    await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
      overall_summary: 'analysis_error: ' + msg.slice(0, 1000),
      analyzed_at:     new Date().toISOString(),
    });
    await markFathomCallErrored(admin, fathomCallId, userId);
    console.error('[analysis] Failed for call ' + fathomCallId + ' (user=' + userId + '): ' + msg);
    return { status: 'error', reason: msg };
  }
}

module.exports = {
  analyzeCall: analyzeCall,
  // Exported for tests / future internal callers — same precedent as me.js
  // (_computeCoachingPatterns, etc.).
  _extractFirstJsonObject:     extractFirstJsonObject,
  _extractFirstJsonArray:      extractFirstJsonArray,
  _sanitizeSection:            sanitizeSection,
  _sanitizeHighlights:         sanitizeHighlights,
  _findMeeting:                findMeeting,
  _formatTurnsForPrompt:       formatTurnsForPrompt,
  _formatSeconds:              formatSeconds,
  _buildSectionGraderPrompt:   buildSectionGraderPrompt,
  _buildHighlightExtractorPrompt: buildHighlightExtractorPrompt,
  _markFathomCallErrored:      markFathomCallErrored,
};
