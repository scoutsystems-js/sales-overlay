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
 *   1. Atomically claim the run (claimAnalysisRun: conditional UPDATE to
 *      status='processing', or INSERT arbitrated by the fathom_call_id unique
 *      index). A run that loses the claim exits as a quiet no-op — overlapping
 *      dispatches can no longer double-analyze a call.
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
const { fetchSellingContext } = require('./selling-context');
const { shouldHarvest, harvestClosedCall } = require('./kb-harvest');
const { resolveProspectName } = require('./prospect-name');
const { nameKey } = require('./prospect-entity');
const { effectiveCloseScore } = require('./outcome-tag');
const fathomRoutes = require('../routes/fathom');
// Zoom source (sub-stage 2). Token via the unified call_connections store (its
// serialized single-flight refresh is a correctness requirement for Zoom's
// single-use refresh tokens — never bypass it); transcript via the VTT adapter.
const callConnections = require('./call-connections');
const zoomClient = require('./zoom-client');
const { parseVttToTranscript } = require('./vtt-adapter');
// Section tagging for highlights (Call Review Context, Part 1a).
const { sanitizeSectionValue } = require('./highlight-section');
// 6a: independent quote→speaker attribution (refuses rather than guesses).
const { labelForQuote } = require('./quote-locate');

// Which transcript path a call takes. 'zoom' → Zoom (call_connections + VTT);
// anything else (fathom / null / legacy pre-source rows) → Fathom, unchanged.
// PURE — the analyzeCall branch keys on this so the decision is unit-testable.
function transcriptSourceFor(callRow) {
  return (callRow && callRow.source === 'zoom') ? 'zoom' : 'fathom';
}

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
// Objection sub-categories (migration 012). Only set on type='objection' rows.
const VALID_OBJECTION_CATEGORIES = ['fear', 'logistical', 'timing', 'partner'];
// Objection resolution (migration 013). Grounds the coaching synthesis.
const VALID_RESOLUTIONS = ['handled', 'partial', 'unhandled'];
// Deal outcome inferred by the section grader (migration 012).
const VALID_OUTCOMES = ['closed', 'follow_up', 'lost', 'no_show'];
// Payment structures (migration 022). Closed calls only — the worker forces
// 'none_stated' for every other outcome.
const VALID_PAYMENT_STRUCTURES = ['paid_in_full', 'payment_plan', 'bnpl', 'none_stated'];
// Analysis prompt version (migration 014) — BUMP MANUALLY whenever the grader or
// highlight-extractor prompts change. Stamped on every call_analyses row so a
// stale-prompt analysis is one query away (the guard for the Issue-1 class of
// bug). v2 = outcome inference + objection category/resolution/closer_response/surface.
// v3 = grader scale re-calibration (anchored bands + high-ticket domain context;
//      a typical solid call lands 65-80/section — no longer graded vs a perfect ideal).
// v7 = (a) cash_collected extraction — explicit-only, zero-default, never inferred;
//      (b) follow_up_email greeting contract — transcript-established name only,
//      omitted entirely when unclear (fixes title-vs-attendee greeting bugs).
// v8 = (a) cash extraction hunts transaction evidence (card runs, deposits,
//      charge confirmations, BNPL approvals, plan first-payments) with
//      per-structure cash rules; (b) payment_structure field (closed-only);
//      (c) eod_summary — first-person closer-voice EOD report summary
//      (coaching's overall_summary untouched). Never-fabricate unchanged.
const ANALYSIS_PROMPT_VERSION = 'v13-2026-08-11'; // v13 (6a — deterministic speaker labelling): the prompt TEMPLATE is unedited, but the prompt STRING sent to Claude changes materially on every call where the closer is now identified — `closerLabel`/`speakerNote` flip from "Speaker identity is uncertain — infer who the closer is" to "The closer is X, labeled CLOSER", and EVERY transcript line's speaker prefix changes from a raw display name to CLOSER/PROSPECT. That is a different input to the model, so it gets a version stamp: prompt_version is the ONLY way to tell which analyses were graded with MATCHED speakers versus GUESSED ones, and that distinction is load-bearing for every closer-side feature built on top. Cost, stated plainly: this marks every prior analysis outdated. Per the standing new-calls-only ruling, do NOT mass re-analyze to clear it — the count is cosmetic and the corpus corrects itself as new calls arrive. // v12: (1) qualification_covered {financial, evidence} — a MEASUREMENT-ONLY structured field, additive, drives NOTHING (no score, no UI). Adopted after three attempts to encode qualification enforcement as grader WORDING all failed: the intended effect is smaller than the grader's noise floor (see GRADER NOISE PROFILE in CLAUDE.md), so it cannot be validated by score deltas and must be validated by READING the boolean against transcripts. (2) the anti-literal-matching guidance kept as prompt text — it gated clean and costs nothing. NOT a scoring change; under new-calls-only the outdated count it produces is cosmetic. // v11: grader emits `prospect_name` (PROSPECT NAMES 3b), reusing the v7 follow-up-email greeting contract VERBATIM — transcript-only, null when no name is established, never the meeting title. A couple returns as ONE joined name (ruling: couples are one prospect). ADDITIVE — scoring/outcome/section prompts are UNCHANGED from v10, so NO delta-gate (same reasoning that let v10 ship without one). Feeds lib/prospect-name.js, which already ranked a grader name above diarized and title. // v10: highlight extractor now tags each moment with its `section` (intro/discovery/pitch/objection/close) for the Call Review section breakdown (migration 028). ADDITIVE — an extractor-only field; grader scoring/outcome prompts are UNCHANGED from v9, so no delta-gate needed (the score/outcome noise on re-analysis is the same as any re-grade). Backfill = last 30 days only (reviewed step); older calls stay v9 (no section tags → UI falls back to notes prose). Manual outcomes are frozen by the outcome_source='manual' guard, so re-analysis can't clobber them. // v9: sharper outcome criteria (no_show = very short/no discovery-pitch-close; disqualified/no-path = lost; follow_up requires a live path forward).

// ─── Tuning ────────────────────────────────────────────────────────────────
const MAX_SEARCH_PAGES   = 3;                // upper bound on /meetings pagination when finding one specific call
const SEARCH_WINDOW_MS   = 10 * 60 * 1000;   // created_after = call_date - 10min (Fathom's `created` is close to but not identical to recording_start_time)
const MAX_HIGHLIGHTS     = 8;                // hard cap — schema-free but the dashboard layout assumes <=8
const GRADER_MAX_TOKENS  = 4500;             // 5 sections × notes + overall + one_thing + follow_up_email + outcome. Bumped 3000→4500: at 3000 the grader JSON truncated (unparseable) on longer calls once the outcome field was added.
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

// SUPERSEDED (2026-07): no longer called by analyzeCall — the /meetings search
// below failed for all 200 of Josh's calls (created_after window + 3-page cap
// never surfaced the target). analyzeCall now fetches the transcript directly
// via /recordings/{id}/transcript using the stored fathom_call_id. Kept intact
// for reference / rollback; safe to delete once the direct-fetch path is proven.
//
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
    // includeTranscript=false: OAuth apps can't use include_transcript on
    // /meetings (silently ignored), so we no longer ask for it here — the
    // transcript is fetched separately via /recordings/{id}/transcript in
    // analyzeCall. includeHighlights=true stays (highlights DO come back inline).
    var data = await fathomRoutes._fetchMeetingsPage(accessToken, cursor, createdAfter, false, true);
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
function buildSectionGraderPrompt(normalized, durationSeconds, sellingContext) {
  var transcriptText = formatTurnsForPrompt(normalized.turns);
  var durationLabel = (durationSeconds != null) ? Math.round(durationSeconds / 60) + ' minutes' : 'unknown duration';
  var closerLabel = (normalized.speaker_confidence === 'matched')
    ? 'The closer is "' + normalized.closer_name + '", labeled CLOSER in the transcript. The prospect is labeled PROSPECT.'
    : 'Speaker identity is uncertain — the transcript shows raw display names. Infer who the closer is from conversational cues (asks discovery questions, makes the pitch, handles objections). Map both roles to CLOSER and PROSPECT in your evidence quotes.';

  // v7 diverges from v5/v6: cash_collected extraction + the follow_up_email
  // greeting contract (transcript-name-only, omit when unclear). The SELLING
  // CONTEXT block is still spliced in ONLY when non-empty. No version text
  // lives in the prompt — the version is a DB stamp.
  var lines = [
    'You are an expert sales coach reviewing a transcript of a high-ticket sales call. Grade five sections on a 0-100 spectrum (NOT pass/fail), each with a letter grade A-F.',
    '',
    'DOMAIN CONTEXT: This is high-ticket sales, where a 25-35% close rate is STRONG performance. Most calls do not close, and that is normal and expected. A call that advances the prospect to a next step, or ends with an appropriate disqualification, is a SUCCESSFUL outcome — not a failure. Do not treat "did not close on this call" as a poor performance.',
    '',
    'SCORING SCALE — anchor every section score to these bands:',
    '  85-100: exceptional — rare, near-perfect execution of this section',
    '  70-84 : strong — did the job well with only minor gaps. THIS IS WHAT GOOD WORKING CLOSERS SCORE ON MOST CALLS.',
    '  55-69 : adequate — the section happened, with real gaps that likely cost leverage',
    '  40-54 : weak — significant misses',
    '  <40   : the section failed or was barely attempted',
    'A competent professional closer\'s TYPICAL call should land 65-80 per section. Reserve sub-50 for genuine failures, not for imperfection. DO NOT grade against a perfect-call ideal — grade against what a solid working closer actually does.',
    '',
    'RANKING INTEGRITY: this anchoring shifts the SCALE, not your discrimination. The relative differences between sections (and between calls) must still reflect real quality differences — a genuinely stronger section must still score higher than a weaker one. Calibrate the overall level up, but keep the ordering honest.',
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
    '',
    'HOW TO JUDGE EVERY SECTION: the bullets above name the AREAS each section must establish — they are not required words, questions or techniques. DO NOT REDUCE a score because the closer reached the required ground by a DIFFERENT ROUTE: a different order, their own wording, a technique used without naming it, an area established by inference or volunteered by the prospect, or a thread picked up again later in the call. Named methods (isolation, framework rebuttal, assumptive close, agenda-setting) are examples of routes that work, not requirements. Route alone is never a fault. This does NOT make you more generous overall — it changes what counts as a fault, not the scoring scale.',
    '',
    'For each section return: {"grade":"A"|"B"|"C"|"D"|"F","score":0-100,"notes":"<evidence + reasoning, including 1-2 quoted transcript lines with timestamps>"}',
    'If a section did not occur (e.g. no objections were raised), return {"grade":null,"score":null,"notes":"Section did not occur in this call."} — null is honest.',
    '',
    'Then provide call-level fields:',
    '  - overall_score: 0-100, weighted gestalt across sections that occurred',
    '  - overall_summary: 2-3 sentences. Factual only — no encouragement, no softening. State what happened, what stage was reached, and what the apparent outcome was.',
    '  - one_thing: the single most actionable behavioral change for the closer\'s next call — specific, not generic. Bad: "ask better discovery questions." Good: "when the prospect mentioned the $50k loan at [00:08:21], you moved straight to pitch instead of isolating the urgency — pause and ask \'what would change if you didn\'t solve this in 60 days?\' next time." For a "lost" OR "follow_up" call, one_thing MUST be the direct antidote to why_outcome.reason — the correction (for follow_up: the move that advances the deal) that addresses that exact cause, at the same or the adjacent moment. why_outcome and one_thing must read as cause → correction.',
    '  - why_outcome: the SINGLE most decisive cause of this call\'s result, anchored to one transcript moment — an object {"reason":"...","quote":"...","timestamp_seconds":N}:',
    '      • reason: ONE specific cause, not a list. For a "lost" call this is the primary reason the deal did not close (the one thing that most cost it). For a "closed" call this is what most won the deal (the decisive moment). For a "follow_up" call this is the primary BLOCKER that kept it from closing on THIS call — the unresolved objection, hesitation, or missing piece the closer must resolve next. The deal is alive, not lost: frame it as what is standing between here and a close.',
    '      • quote: the exact words spoken at that moment (the closer\'s or the prospect\'s), 5-30 words, trimmed.',
    '      • timestamp_seconds: integer seconds of that moment (read the [HH:MM:SS] tag, convert to seconds).',
    '      • REQUIRED for "closed", "lost", and "follow_up". Set why_outcome to null ONLY when outcome is "no_show" (no real conversation to diagnose).',
    '  - one_thing_timestamp_seconds: integer seconds of the moment the one_thing correction belonged to — the same moment as why_outcome, or the adjacent moment where the closer should have intervened. Null if not applicable.',
    '  - prospect_name: the prospect\'s name, using the SAME rule as the follow-up email greeting: the name they are actually called (or call themselves) IN THE TRANSCRIPT. If no name is clearly established in the transcript, return null. Never take a name from the meeting title or any source other than the transcript itself. If two people are on the prospect side (a couple or business partners buying together), return them as one name joined by \" and \" (e.g. \"Alan and Jen\") \u2014 they are ONE prospect. Return the name only, with no title, company, or location.',
    '  - qualification_covered: a factual OBSERVATION about whether the closer established the prospect\'s FINANCIAL POSITION on this call — their budget, what they earn, what they have saved, or what they are able to invest. Return {"financial": true, "evidence": "<the line that establishes it, quoted verbatim from the transcript, 5-30 words>"} when that ground was covered BY ANY conversational route: a direct question, an indirect one, an inference the prospect confirms, or something the prospect volunteers all count equally. No specific words, figures or criteria need to appear. Return {"financial": false, "evidence": null} ONLY when the call genuinely never establishes it. THIS IS AN OBSERVATION, NOT A JUDGEMENT: it must not influence any section score, grade or the overall score in any way.',
    '  - follow_up_email: a draft the closer can copy + send today. Reference specific moments from this call. First-person, written as the closer (not an AI). No \'I hope this finds you well\', no \'don\'t hesitate to reach out\'. Sound like a real person following up on a real conversation. Under 200 words. Greeting rule: greet the prospect ONLY by the name they are actually called (or call themselves) in the transcript. If no name is clearly established in the transcript, omit the name from the greeting entirely (e.g. \'Hey — great talking today.\'). Never take a name from the meeting title or any source other than the transcript itself.',
    '  - cash_collected + payment_structure: for CLOSED calls, actively look for transaction evidence anywhere in the transcript — card details being taken or run, a deposit being made, confirmation that a charge went through, financing approvals (Affirm, Klarna, or similar BNPL — buy now pay later), or a first payment on a payment plan. Then report BOTH fields:',
    '      • payment_structure: exactly one of "paid_in_full" | "payment_plan" | "bnpl" | "none_stated". Only a closed call can have a structure other than "none_stated" — for follow_up, lost, and no_show ALWAYS return "none_stated". If the call closed but how it was paid is not evidenced, return "none_stated".',
    '      • cash_collected: a plain number, no currency symbol. THE CASH DEFINITION DEPENDS ON THE STRUCTURE — apply the matching rule:',
    '          - paid_in_full: the full amount charged on the call.',
    '          - payment_plan: ONLY the money actually collected on the call (the deposit or first payment) — NEVER the total contract value of the plan.',
    '          - bnpl: the full financed amount approved on the call.',
    '          - none_stated: 0.',
    '      • The never-fabricate rule is unchanged: NEVER guess or infer an amount — only report an amount EXPLICITLY evidenced in the transcript. A price merely quoted, offered, or discussed is NOT cash collected. If no amount is actually evidenced, return 0 even for a closed call. When in doubt: 0.',
    '  - eod_summary: a 2-4 sentence end-of-day report summary written in FIRST PERSON as the closer, as if they wrote it themselves for their team\'s Slack channel ("Spoke with X about... She\'s deciding between... I set a follow-up for Friday."). Factual and professional — names, decisions, next steps. State losses plainly with no self-criticism and no coaching language. NO AI tells: no hedging filler, and never narrate the closer in the third person — you ARE the closer\'s voice here. This is separate from overall_summary (which stays analytical).',
    '  - outcome: the deal outcome for THIS call, inferred from what actually happened in the transcript. Exactly one of:',
    '      "closed"    — prospect committed, paid, or clearly agreed to buy on this call',
    '      "follow_up" — the deal is ALIVE with a genuine path forward: a booked next call, active thinking time, or a spouse/partner check the prospect intends to complete. There must be real intent to continue — not just the absence of a "no".',
    '      "lost"      — the prospect declined, walked with no path forward, or was DISQUALIFIED. A disqualification (e.g. they fail a qualification on credit/finances/fit) that the closer accepts and does not overcome is "lost", NOT "follow_up". A vague "reschedule" with no date and no real intent is "lost", not "follow_up".',
    '      "no_show"   — the prospect never meaningfully joined, OR the call ended almost immediately: a very short call (roughly under ~2 minutes) with NO discovery, NO pitch, and NO close. Empty/near-empty transcript, no real sales conversation.',
    '    Infer from evidence in the transcript. Use "follow_up" ONLY when there is a real live path forward; if the prospect was disqualified or walked with no path, that is "lost"; if the call never got going, that is "no_show". Never guess "closed" without clear support.',
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
    '  "why_outcome": {"reason":"...","quote":"...","timestamp_seconds":N} | null,',
    '  "one_thing_timestamp_seconds": N | null,',
    '  "prospect_name": "..." | null,',
    '  "qualification_covered": {"financial": true|false, "evidence": "..."|null},',
    '  "follow_up_email": "...",',
    '  "cash_collected": N,',
    '  "payment_structure": "paid_in_full"|"payment_plan"|"bnpl"|"none_stated",',
    '  "eod_summary": "...",',
    '  "outcome": "closed"|"follow_up"|"lost"|"no_show"',
    '}',
    '',
    'TRANSCRIPT:',
    transcriptText,
  ];

  // Splice SELLING CONTEXT between DOMAIN CONTEXT and the SCORING SCALE, present
  // only when there is content. When empty, `lines` is untouched → identical to v5.
  if (sellingContext && sellingContext.trim()) {
    var at = lines.indexOf('SCORING SCALE — anchor every section score to these bands:');
    if (at !== -1) {
      lines.splice(at, 0,
        'SELLING CONTEXT: The following is this closer\'s actual offer and sales approach, uploaded by their team. Ground your grading in it: judge the call against THIS offer and THIS selling style. Do not penalize approaches this material explicitly endorses (e.g., a logical, ROI-driven close for a B2B offer must not be marked down for lacking emotional urgency). Where the closer deviates from their own script/offer in a way that hurt the call, say so and cite it.',
        '',
        sellingContext.trim(),
        '');
    }
  }
  return lines.join('\n');
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
    '  - section: which part of the call this moment happened in — exactly one of "intro", "discovery", "pitch", "objection", "close". Use the ACTUAL flow of THIS call, not a fixed order: a call may run discovery after the pitch, revisit objections late, etc. — pick the section the moment genuinely belongs to.',
    '  - type: exactly one of these six values:',
    '      "buying_signal"      — prospect indicates intent (asks about onboarding, mentions next steps, asks price/timing like a buyer)',
    '      "objection"          — prospect raises a concern (money, time, spouse, doubt, comparison shopping)',
    '      "missed_opportunity" — closer let a discovery thread, pain signal, or buying cue slip without follow-up',
    '      "strong_moment"      — closer executed a framework cleanly (V-L-F-A-R, identity shift, isolation, etc.)',
    '      "rapport_moment"     — closer or prospect built genuine connection (humor, shared experience, vulnerability)',
    '      "disqualify_signal"  — prospect revealed they\'re not a real fit (no budget, no decision authority, wrong stage)',
    '',
    'FOR type="objection" MOMENTS ONLY, also include these extra fields (omit them for every other type):',
    '  - objection_surface: the SURFACE objection as the prospect ACTUALLY framed it, in 1-3 words (e.g. "too expensive", "needs spouse", "bad timing", "wants to research", "not sure it works"). This is the apparent objection in the prospect\'s own words; objection_category below is the underlying driver.',
    '  - objection_category: exactly one of these four values:',
    '      "fear"       — the objection is really about fear, doubt, or self-belief. IMPORTANT: money-phrased objections ("I can\'t afford it", "it\'s too expensive", "I don\'t have the money") are ALMOST ALWAYS fear in this domain — categorize them as "fear" UNLESS the transcript shows a genuine logistical payment constraint.',
    '      "logistical" — a concrete, real-world constraint: a genuine payment/financing mechanics issue, scheduling/availability, or a hard external blocker the prospect actually describes.',
    '      "timing"     — "not now", "call me next quarter", "after X happens" — a deferral about WHEN, not whether.',
    '      "partner"    — the prospect needs to consult a spouse/partner/business partner before deciding. When you use "partner", the observation MUST cite the prospect\'s own framing (quote how they referenced the partner).',
    '  - resolution: exactly one of "handled" (closer resolved it and advanced toward the close), "partial" (partially addressed but prospect stayed hesitant), or "unhandled" (left unresolved).',
    '  - closer_response: the closer\'s ACTUAL words responding to this objection, quoted verbatim from the transcript (the lines that did the handling). This is used to coach the closer from their OWN real language, so quote exactly what they said. Use null if the closer did not respond or resolution is "unhandled".',
    '',
    'Order moments chronologically (earliest first).',
    '',
    'Quality gate: if fewer than 5 genuinely high-signal moments exist in this call, return only the ones that qualify. Never pad to reach a minimum count. An array of 3 honest moments is better than 8 diluted ones.',
    '',
    'Respond with ONLY a JSON array — no markdown, no code fences, no narrative wrapping:',
    '[',
    '  {"timestamp_seconds":N,"speaker":"PROSPECT","quote":"...","observation":"...","section":"objection","type":"objection","objection_surface":"too expensive","objection_category":"fear","resolution":"handled","closer_response":"..."},',
    '  {"timestamp_seconds":N,"speaker":"CLOSER","quote":"...","observation":"...","section":"discovery","type":"strong_moment"},',
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
// cash_collected guard (v7): numbers, plus clean string formats normalized —
// leading $, thousands separators, plain numeric strings (the model sometimes
// echoes the transcript's formatting despite the prompt asking for a number).
// Anything that doesn't normalize unambiguously to a single non-negative
// amount → 0; then the same bounds (0–$1M) + cents rounding. The
// never-fabricate rule is unchanged — this widens FORMAT tolerance only,
// never inference.
function sanitizeCashCollected(v) {
  var n = null;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    var t = v.trim().replace(/^\$/, '');
    // Exactly one clean amount: 1234 | 1,234 | 1234.56 | 1,234.56
    if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(t) || /^\d+(\.\d{1,2})?$/.test(t)) {
      n = parseFloat(t.replace(/,/g, ''));
    }
  }
  if (typeof n !== 'number' || !isFinite(n)) return 0;
  if (n < 0 || n > 1000000) return 0;
  return Math.round(n * 100) / 100;
}

// payment_structure guard (v8): allowlist, case-normalized; anything unknown
// → 'none_stated'. Coupling enforced HERE, not just in the prompt: a non-closed
// outcome always yields 'none_stated' whatever the model said.
function sanitizePaymentStructure(v, outcome) {
  if (outcome !== 'closed') return 'none_stated';
  var t = (typeof v === 'string') ? v.trim().toLowerCase() : '';
  return VALID_PAYMENT_STRUCTURES.indexOf(t) !== -1 ? t : 'none_stated';
}

// eod_summary guard (v8): non-empty string, trimmed, capped to 2000; else null
// (NULL = "no v8 summary" — the EOD view falls back to overall_summary).
// qualification_covered — a measurement-only field (v12). Fails CLOSED: anything
// malformed becomes {financial:false, evidence:null} rather than a truthy guess,
// because a field that over-reports coverage is worse than one that under-reports
// (the whole point is to measure how often the ground is actually covered).
function sanitizeQualificationCovered(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { financial: false, evidence: null };
  var fin = (v.financial === true);
  var ev = (typeof v.evidence === 'string' && v.evidence.trim()) ? v.evidence.trim().slice(0, 400) : null;
  // A true with no evidence is not trustworthy — the contract asks for a quote.
  if (fin && !ev) return { financial: false, evidence: null };
  return { financial: fin, evidence: fin ? ev : null };
}

function sanitizeEodSummary(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim().slice(0, 2000);
}

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

// Clamp a Claude-supplied timestamp to a sane integer second within the call.
// Mirrors sanitizeHighlights' bound: reject negatives and anything wildly past
// the recording's end. Returns null when unusable (so the clip link degrades
// to a plain, unlinked reason).
function boundTs(v, durationSeconds) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  var ts = Math.floor(v);
  if (ts < 0) return null;
  if (durationSeconds != null && ts > durationSeconds + 60) return null;
  return ts;
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
    // Objection sub-fields: only kept for type='objection'; coerced to null
    // (not dropped) when missing/invalid so a bad value never loses the moment.
    var objSurface = null;
    var objCategory = null;
    var resolution = null;
    var closerResponse = null;
    var objHandled = null;
    if (type === 'objection') {
      objSurface = (typeof h.objection_surface === 'string' && h.objection_surface.trim())
        ? h.objection_surface.trim().slice(0, 80) : null;
      var cat = (typeof h.objection_category === 'string') ? h.objection_category.toLowerCase() : null;
      objCategory = (VALID_OBJECTION_CATEGORIES.indexOf(cat) !== -1) ? cat : null;
      var res = (typeof h.resolution === 'string') ? h.resolution.toLowerCase() : null;
      resolution = (VALID_RESOLUTIONS.indexOf(res) !== -1) ? res : null;
      objHandled = (resolution === null) ? null : (resolution === 'handled'); // back-compat with mig 012 column
      closerResponse = (typeof h.closer_response === 'string' && h.closer_response.trim())
        ? h.closer_response.trim().slice(0, 1500) : null;
    }
    out.push({
      timestamp_seconds:  ts,
      speaker:            speaker,
      quote:              h.quote.trim().slice(0, 1000),
      observation:        h.observation.trim().slice(0, 500),
      type:               type,
      // Section tag (nullable): coerced to null when missing/invalid so a bad
      // value never loses the moment — same discipline as the objection sub-fields.
      section:            sanitizeSectionValue(h.section),
      objection_surface:  objSurface,
      objection_category: objCategory,
      objection_handled:  objHandled,
      resolution:         resolution,
      closer_response:    closerResponse,
      sequence_order:     out.length + 1,
    });
  }
  return out;
}

// Persist a call's highlights with a NO-WIPE-ON-FAILURE ordering (house rule):
// the prior rows are deleted ONLY AFTER the new set is successfully inserted, so
// a failed/empty extraction — realistic on a large backfill — never leaves a call
// with zero highlights. Steps: (1) empty new set → do nothing, keep existing;
// (2) capture the prior rows' ids; (3) insert the new set; if that fails, keep
// existing (no delete); (4) only then delete exactly the prior ids. If the final
// cleanup fails, the new set is already saved (dupes self-heal next run) — never a
// wipe. Non-fatal throughout (grades are already saved). Exported for tests.
async function persistHighlights(admin, fathomCallId, userId, sanitizedHighlights) {
  if (!sanitizedHighlights || sanitizedHighlights.length === 0) {
    console.warn('[analysis] no new highlights extracted for ' + fathomCallId + ' — preserving existing highlights (no delete)');
    return { inserted: 0, deleted: 0, kept_existing: true };
  }

  // Capture the prior rows BEFORE inserting so we can delete exactly those after.
  var existing = await admin.from('call_highlights').select('id').eq('fathom_call_id', fathomCallId);
  var oldIds = (existing && existing.data ? existing.data : []).map(function (r) { return r.id; });
  if (existing && existing.error) {
    // Couldn't read the old ids — proceed with insert anyway (worst case: old
    // rows linger as dupes and self-heal next run). NEVER a data-loss path.
    console.warn('[analysis] highlight old-id read failed for ' + fathomCallId + ' (proceeding; dupes may linger): ' + existing.error.message);
  }

  var rows = sanitizedHighlights.map(function (h) {
    return Object.assign({ fathom_call_id: fathomCallId, user_id: userId }, h);
  });
  var ins = await admin.from('call_highlights').insert(rows);
  if (ins && ins.error) {
    // Insert failed → DO NOT delete. Existing highlights stay intact; the next
    // re-analysis retries.
    console.warn('[analysis] highlight insert failed for ' + fathomCallId + ' — keeping existing highlights (no delete): ' + ins.error.message);
    return { inserted: 0, deleted: 0, kept_existing: true };
  }

  // New set is safely in — now delete exactly the prior rows.
  var deleted = 0;
  if (oldIds.length > 0) {
    var del = await admin.from('call_highlights').delete().in('id', oldIds);
    if (del && del.error) {
      // New highlights saved; old rows lingering is cosmetic and self-heals on
      // the next re-analysis. Not a wipe — log and move on.
      console.warn('[analysis] old-highlight cleanup failed for ' + fathomCallId + ' (new set saved; dupes self-heal next run): ' + del.error.message);
    } else {
      deleted = oldIds.length;
    }
  }
  return { inserted: rows.length, deleted: deleted, kept_existing: false };
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

// How long a 'processing' claim stays valid before another run may steal it.
// Sized from real drain data (2026-07 batches: p50 50s, p95 64s, max 247s per
// call) — 10 min is ~2.4x the longest observed analysis, so a live run is never
// preempted, while a crashed run (Railway redeploy mid-drain) self-heals
// without the manual status reset the old flow needed.
var CLAIM_STALE_MS = 10 * 60 * 1000;

// Atomically claim this call's analysis run. Returns true when this run may
// proceed, false when another run holds a fresh claim (caller must exit as a
// quiet no-op). Why: the dispatch loops (/sync, /reanalyze, /update-analyses)
// share no lock, so two overlapping dispatches could both analyze the SAME
// call — double Claude spend, and the non-atomic highlight delete+insert let
// both sets persist (the 2026-07-20 duplicate-objections bug).
//
// Atomicity, without client-side transactions:
//   • Row exists → ONE conditional UPDATE. Concurrent updates serialize on the
//     row lock; the loser re-evaluates the WHERE against the winner's committed
//     claim and matches 0 rows.
//   • No row yet → INSERT; the unique index on fathom_call_id (the upsert's
//     onConflict target) makes the loser's insert fail cleanly.
// analyzed_at doubles as the claim timestamp while status='processing' (it is
// overwritten at every terminal upsert anyway). NULL branches are explicit in
// the .or() per the 2026-07 silent-null lesson: NULL status and NULL
// analyzed_at must both be claimable, or pre-claim rows become unclaimable.
async function claimAnalysisRun(admin, fathomCallId, userId, nowIso) {
  var cutoffIso = new Date(new Date(nowIso).getTime() - CLAIM_STALE_MS).toISOString();
  var upd = await admin
    .from('call_analyses')
    .update({ status: 'processing', analyzed_at: nowIso, user_id: userId })
    .eq('fathom_call_id', fathomCallId)
    .or('status.neq.processing,status.is.null,analyzed_at.is.null,analyzed_at.lt.' + cutoffIso)
    .select('id');
  if (upd.error) {
    // Fail closed: without a registered claim we must not run (the race would
    // be back). The row stays pending and rides the next batch.
    console.error('[analysis] claim update failed for call ' + fathomCallId + ' — not proceeding: ' + upd.error.message);
    return false;
  }
  if (upd.data && upd.data.length > 0) return true;

  // 0 rows: either no call_analyses row exists yet, or another run holds a
  // fresh claim. Try to create the row — the unique index arbitrates.
  var ins = await admin
    .from('call_analyses')
    .insert({ fathom_call_id: fathomCallId, user_id: userId, status: 'processing', analyzed_at: nowIso })
    .select('id');
  if (!ins.error && ins.data && ins.data.length > 0) return true;
  // 23505 (unique violation) = we lost the race — expected and quiet. Anything
  // else is a real failure worth surfacing; either way we fail closed.
  if (ins.error && ins.error.code !== '23505') {
    console.error('[analysis] claim insert failed for call ' + fathomCallId + ' — not proceeding: ' + ins.error.message);
  }
  return false;
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
  console.log('[analysis] start call ' + fathomCallId + ' (user=' + userId + ', prompt_version=' + ANALYSIS_PROMPT_VERSION + ')');

  try {
    // ─── Phase 1: claim the run (atomic; replaces the blind 'processing' upsert) ──
    // was: await setAnalysisStatus(admin, fathomCallId, userId, 'processing');
    //      (blind upsert — replaced 2026-07-22 by the atomic claim: two
    //      overlapping dispatch loops could both pass it and double-analyze)
    var claimed = await claimAnalysisRun(admin, fathomCallId, userId, new Date().toISOString());
    if (!claimed) {
      // Another dispatch loop is already analyzing this call (or just did).
      // Quiet no-op — NOT an error: no status change, no Claude spend.
      console.log('[analysis] claim lost for call ' + fathomCallId + ' (user=' + userId + ') — another run holds it; skipping');
      return { status: 'skipped', reason: 'claim_held_by_another_run' };
    }

    // ─── Phase 2: load the fathom_calls row ───────────────────────────────
    var callQ = await admin
      .from('fathom_calls')
      .select('id, fathom_call_id, call_date, duration_seconds, user_id, title, recording_url, source')
      .eq('id', fathomCallId)
      .maybeSingle();
    if (callQ.error) throw new Error('fathom_calls fetch: ' + callQ.error.message);
    if (!callQ.data) throw new Error('fathom_calls row not found: ' + fathomCallId);
    if (callQ.data.user_id !== userId) {
      throw new Error('Scope mismatch: call ' + fathomCallId + ' does not belong to user ' + userId);
    }
    var callRow = callQ.data;

    // ─── Phase 3+4: fetch the transcript, SOURCE-AWARE ────────────────────
    // Everything downstream (normalize → grade → extract) is source-agnostic:
    // both branches produce `transcript` = an array of
    //   { speaker: { display_name }, text, timestamp: "HH:MM:SS" }
    // that feeds the same `meeting` object below. Only token store + fetch differ.
    //
    // Shared error exit: on any token/transcript failure, mark the analysis +
    // fathom_calls row errored with a human reason and stop (recoverable — the
    // user can retry via Update-analyses / a later sync).
    async function failTranscript(reason) {
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: reason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + reason + ' (call=' + fathomCallId + ' user=' + userId + ')');
      return { status: 'error', reason: reason };
    }

    var transcript;
    if (transcriptSourceFor(callRow) === 'zoom') {
      // ── Zoom ── token via call_connections (serialized single-flight refresh —
      // Zoom's single-use rotating refresh tokens make this mandatory), transcript
      // via /meetings/{uuid}/recordings → the transcript VTT → the VTT adapter.
      var zoomToken;
      try {
        zoomToken = await callConnections.getValidAccessToken(admin, userId, 'zoom');
      } catch (zTokErr) {
        return await failTranscript('Zoom token unavailable for user ' + userId + ': ' + ((zTokErr && zTokErr.message) || 'unknown'));
      }
      try {
        var vtt = await zoomClient.fetchTranscriptVtt(zoomToken, callRow.fathom_call_id);
        transcript = parseVttToTranscript(vtt);
      } catch (zErr) {
        return await failTranscript('Zoom transcript fetch failed for meeting ' + callRow.fathom_call_id + ': ' + ((zErr && zErr.message) || 'unknown'));
      }
    } else {
      // ── Fathom (unchanged) ── fathom_connections token + /recordings/{id}/transcript.
      // findMeeting() is bypassed (kept below, unused): everything the pipeline
      // needs is on callRow (Phase 2) plus the transcript pulled straight from the
      // recording endpoint by stored recording_id. Fathom highlights skipped (the
      // Claude extractor derives them); recorded_by null → Claude infers roles.
      var connQ = await admin
        .from('fathom_connections')
        .select('access_token, refresh_token, expires_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (connQ.error) throw new Error('fathom_connections fetch: ' + connQ.error.message);
      if (!connQ.data) throw new Error('Fathom connection not found for user ' + userId);
      var accessToken = await fathomRoutes._getValidAccessToken(admin, userId, connQ.data);
      try {
        transcript = await fathomRoutes._fetchRecordingTranscript(accessToken, callRow.fathom_call_id);
      } catch (transcriptErr) {
        return await failTranscript('Transcript fetch failed for recording_id ' + callRow.fathom_call_id + ': ' + ((transcriptErr && transcriptErr.message) || 'unknown'));
      }
    }

    // DIAGNOSTIC (temporary): first live exercise of /recordings/{id}/transcript.
    // Log the turn count + raw first-turn JSON so we can confirm the per-turn
    // field names (speaker.display_name / text / timestamp) from Railway logs.
    // Remove once the transcript shape is verified against real data.
    console.log('[analysis] transcript length: ' + (Array.isArray(transcript) ? transcript.length : '(not an array)') + ' (call=' + fathomCallId + ' recording_id=' + callRow.fathom_call_id + ')');
    console.log('[analysis] transcript shape sample:', JSON.stringify(transcript && transcript[0]));

    // ─── Closer identity (6a) ────────────────────────────────────────────
    // Hoisted ABOVE normalize because the normalizer now needs it: speaker
    // labelling is deterministic via exact equality between the per-turn
    // `matched_calendar_invitee_email` and this address. Phase 6b (prospect
    // name) reuses the same lookup rather than issuing a second query.
    //
    // Failure is non-fatal by design: no email → speaker_confidence 'unknown'
    // → the model infers roles, exactly as before 6a. Degraded, never wrong.
    var closerEmail = null;
    try {
      var connTable = (transcriptSourceFor(callRow) === 'zoom') ? 'call_connections' : 'fathom_connections';
      var emailCol  = (connTable === 'call_connections') ? 'external_account_email' : 'fathom_email';
      var emailConnQ = admin.from(connTable).select(emailCol).eq('user_id', userId);
      if (connTable === 'call_connections') emailConnQ = emailConnQ.eq('provider', 'zoom');
      var emailConnRow = await emailConnQ.maybeSingle();
      var rawCloserEmail = emailConnRow && emailConnRow.data ? emailConnRow.data[emailCol] : null;
      if (rawCloserEmail && typeof rawCloserEmail === 'string') closerEmail = rawCloserEmail;
    } catch (connErr) {
      console.warn('[analysis] closer-identity lookup failed for ' + fathomCallId + ': ' + ((connErr && connErr.message) || 'unknown'));
    }

    // Minimal source-agnostic meeting object built from the DB row + transcript.
    var meeting = {
      recording_id:  callRow.fathom_call_id,
      title:         callRow.title,
      recording_url: callRow.recording_url,
      created_at:    callRow.call_date,
      transcript:    transcript,
      highlights:    [],    // Fathom highlights skipped — extractor derives them
      // recorded_by stays null — the legacy fuzzy NAME match is deliberately
      // not wired (it returned the CLOSER as the prospect on 6 of 83 calls).
      recorded_by:   null,
      closer_email:  closerEmail,  // 6a: exact-equality speaker labelling
    };

    // ─── Phase 5: normalize ──────────────────────────────────────────────
    var normalized = normalizeTranscript(meeting);
    if (!normalized.turns || normalized.turns.length === 0) {
      // Include the raw first turn so a field-name mismatch between
      // /recordings/{id}/transcript and what normalizeTranscript expects
      // (turn.speaker.display_name / turn.text / turn.timestamp) is visible
      // directly on the dashboard error card — no Railway log access required.
      var rawSample = JSON.stringify(transcript && transcript[0]);
      if (rawSample && rawSample.length > 500) rawSample = rawSample.slice(0, 500) + '…';
      var emptyReason = 'No transcript turns after normalize (recording_id ' + callRow.fathom_call_id + '; fetched ' + (Array.isArray(transcript) ? transcript.length : 0) + ' raw turn(s)). First raw turn: ' + rawSample;
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: emptyReason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + emptyReason + ' (call=' + fathomCallId + ')');
      return { status: 'error', reason: emptyReason };
    }

    // ─── Phase 6: two parallel Claude calls ──────────────────────────────
    // KB grounding: one read-only fetch of the closer's selling context (offer
    // docs / scripts). Never throws (empty on any failure) → the grader falls
    // back to the v5-identical prompt. Highlight extractor is unchanged. No new
    // Claude call — still exactly two per analysis.
    var selling = await fetchSellingContext(admin, userId);
    var anthropic = getAnthropic();
    var sectionPrompt   = buildSectionGraderPrompt(normalized, callRow.duration_seconds, selling.contextText);
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

    // GUARD: an Anthropic API failure (credit/quota exhaustion, 429, 5xx,
    // timeout) must hard-fail this call to 'error' — NEVER fall through to a
    // 'done' row with partial nulls. A thrown SDK error already reaches the
    // outer catch, but we handle it explicitly here so the DB reason is
    // unambiguous ("Anthropic API failure (HTTP …)") and stamped with the
    // prompt version.
    var settled;
    try {
      settled = await Promise.all([graderPromise, highlighterPromise]);
    } catch (apiErr) {
      var apiStatus = (apiErr && (apiErr.status || apiErr.statusCode)) || '';
      var apiReason = 'Anthropic API failure' + (apiStatus ? ' (HTTP ' + apiStatus + ')' : '') + ': ' + ((apiErr && apiErr.message) || 'unknown');
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: apiReason.slice(0, 1000),
        analyzed_at:     new Date().toISOString(),
        prompt_version:  ANALYSIS_PROMPT_VERSION,
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + apiReason + ' (call=' + fathomCallId + ' user=' + userId + ')');
      return { status: 'error', reason: apiReason };
    }
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

    // ─── Phase 6b: resolve the prospect name ─────────────────────────────
    // The closer must be excluded from the diarized speakers.
    //
    // 6a UPDATE: `normalized.closer_name` is now POPULATED whenever the invitee
    // email is available (it used to be NULL on every row, because the meeting
    // object hardcoded recorded_by:null and the fuzzy match never ran). The
    // local-part candidates below remain as the path for calls with no email
    // signal — Zoom, and users with no connection email.
    //
    // This matters concretely: on 6 of 83 live calls the PROSPECT out-talked the
    // closer, so the turn-count fallback alone would have returned the CLOSER as
    // the prospect — precisely the wrong-name failure the governing principle
    // forbids. Never let this degrade to that path when an email is available.
    // 6a: the lookup is hoisted above normalize now (the normalizer needs the
    // same address). Reuse it here rather than querying twice.
    var closerCandidates = [];
    if (closerEmail) {
      closerCandidates.push(closerEmail);
      var localPart = closerEmail.split('@')[0];
      if (localPart) closerCandidates.push(localPart);
    }

    var resolvedProspect = resolveProspectName({
      graderName:       (typeof graderParsed.prospect_name === 'string') ? graderParsed.prospect_name : null,
      turns:            normalized.turns,
      closerName:       normalized.closer_name,
      closerCandidates: closerCandidates,
      title:            callRow.title,
    });

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

    // Grader-inferred deal outcome (migration 012). This is only APPLIED when the
    // row isn't manually locked — the read-before-write guard below (manualLocked)
    // freezes a human-set 'manual' outcome, so a re-analysis never clobbers it.
    var inferredOutcome = (typeof graderParsed.outcome === 'string'
      && VALID_OUTCOMES.indexOf(graderParsed.outcome.toLowerCase()) !== -1)
      ? graderParsed.outcome.toLowerCase() : null;

    // "Why this call closed / didn't close / hasn't closed yet" (migration 018,
    // prompt v5). closed (win), lost (loss), AND follow_up (the blocker keeping
    // it open) all carry a decisive-cause object; only no_show/null force it null
    // (no real conversation to diagnose), so the review verdict shows on every
    // real call instead of just wins and losses.
    var whyRaw = graderParsed.why_outcome;
    var whyReason = null, whyQuote = null, whyTs = null;
    var producesVerdict = (inferredOutcome === 'closed' || inferredOutcome === 'lost' || inferredOutcome === 'follow_up');
    if (producesVerdict && whyRaw && typeof whyRaw === 'object'
        && typeof whyRaw.reason === 'string' && whyRaw.reason.trim()) {
      whyReason = whyRaw.reason.trim().slice(0, 2000);
      whyQuote  = (typeof whyRaw.quote === 'string' && whyRaw.quote.trim())
        ? whyRaw.quote.trim().slice(0, 1000) : null;
      whyTs     = boundTs(whyRaw.timestamp_seconds, callRow.duration_seconds);
    }
    var oneThingTs = boundTs(graderParsed.one_thing_timestamp_seconds, callRow.duration_seconds);

    // Manual-override protection (Thread 1, load-bearing): if a human tagged the
    // outcome, a re-analysis must NEVER overwrite it. Read the existing tag +
    // earned close score. The EFFECTIVE outcome (manual if locked, else inferred)
    // drives close_score (Thread 2) and payment_structure.
    var existingRow = await admin.from('call_analyses')
      .select('outcome, outcome_source, outcome_set_at, outcome_set_by')
      .eq('fathom_call_id', fathomCallId).maybeSingle();
    var manualLocked = !!(existingRow.data && existingRow.data.outcome_source === 'manual');
    var effectiveOutcome = manualLocked ? existingRow.data.outcome : inferredOutcome;
    var earnedClose = (typeof close.score === 'number') ? close.score : null;

    var analysisPayload = {
      fathom_call_id:      fathomCallId,
      user_id:             userId,
      // Outcome columns are FROZEN when a human tag exists.
      outcome:             manualLocked ? existingRow.data.outcome : inferredOutcome,
      outcome_source:      manualLocked ? 'manual' : (inferredOutcome ? 'inferred' : null),
      outcome_set_at:      manualLocked ? existingRow.data.outcome_set_at : (inferredOutcome ? new Date().toISOString() : null),
      outcome_set_by:      manualLocked ? existingRow.data.outcome_set_by : null,
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
      // Thread 2: displayed Close = 100 when the effective outcome is 'closed';
      // the grader's earned score is preserved in close_score_earned.
      close_score:         effectiveCloseScore(effectiveOutcome, earnedClose, earnedClose),
      close_score_earned:  earnedClose,
      close_notes:         close.notes,
      one_thing:                   (typeof graderParsed.one_thing === 'string') ? graderParsed.one_thing.slice(0, 2000) : null,
      why_outcome:                 whyReason,
      why_quote:                   whyQuote,
      why_timestamp_seconds:       whyTs,
      one_thing_timestamp_seconds: oneThingTs,
      follow_up_email:     (typeof graderParsed.follow_up_email === 'string') ? graderParsed.follow_up_email.slice(0, 5000) : null,
      cash_collected:      sanitizeCashCollected(graderParsed.cash_collected),
      payment_structure:   sanitizePaymentStructure(graderParsed.payment_structure, effectiveOutcome),
      eod_summary:         sanitizeEodSummary(graderParsed.eod_summary),
      // v12 measurement-only: stored so coverage can be checked by READING, never
      // consumed by a score. What it eventually feeds is a separate decision.
      qualification_covered: sanitizeQualificationCovered(graderParsed.qualification_covered),
      transcript_stored:   { turns: normalized.turns, highlights: normalized.highlights },
      speaker_closer_name: normalized.closer_name,
      // PROSPECT NAMES 3a — resolve WHO this call was with, at write time.
      // Governing principle: a wrong name is worse than no name, so this stores
      // NULL rather than a plausible guess (renders "Unknown prospect").
      // Precedence grader → diarized → title; source + confidence recorded but
      // not surfaced until 3d's merge review (ruling 4).
      prospect_name:            resolvedProspect.name,
      prospect_name_source:     resolvedProspect.source,
      prospect_name_confidence: resolvedProspect.confidence,
      analyzed_at:         new Date().toISOString(),
      prompt_version:      ANALYSIS_PROMPT_VERSION,
      status:              'done',
    };
    var upsert = await admin
      .from('call_analyses')
      .upsert(analysisPayload, { onConflict: 'fathom_call_id' });
    if (upsert.error) throw new Error('call_analyses upsert: ' + upsert.error.message);

    // Highlights: insert the new set FIRST, then delete the prior rows — so a
    // failed/empty extraction (or a failed insert) never wipes a call's existing
    // highlights. Non-fatal: grades are already saved.
    var sanitizedHighlights = sanitizeHighlights(highlightParsed, callRow.duration_seconds);

    // ─── 6a: verify each highlight's speaker against the transcript ──────
    // On a matched call the model is READING labelled turns rather than
    // inferring, which is far stronger — but it is still the model copying a
    // label, not proof. So attribute each quote independently: reconstruct it
    // from consecutive turns and take the speaker who opened it.
    //
    // speaker_verified (migration 034) is deliberately three-valued:
    //   true  — reconstructed from the transcript, proven
    //   false — could not be reconstructed (or two speakers could have said
    //           it); the label stands but is the model's guess
    //   null  — never assessed (no closer identity available at all)
    // Closer-side features must require true. Corrections are logged, because
    // a silent correction hides how often the extractor mis-attributes.
    if (normalized.speaker_confidence === 'matched') {
      var vStats = { proven: 0, unproven: 0, corrected: 0 };
      sanitizedHighlights.forEach(function (h) {
        var label = labelForQuote(normalized.turns, h.quote);
        if (!label) { h.speaker_verified = false; vStats.unproven++; return; }
        if (label !== h.speaker) { h.speaker = label; vStats.corrected++; }
        h.speaker_verified = true;
        vStats.proven++;
      });
      console.log('[analysis] speaker verify call=%s proven=%d unproven=%d corrected=%d',
        fathomCallId, vStats.proven, vStats.unproven, vStats.corrected);
    } else {
      // No deterministic identity → every label is an inference. Say so.
      sanitizedHighlights.forEach(function (h) { h.speaker_verified = false; });
    }
    await persistHighlights(admin, fathomCallId, userId, sanitizedHighlights);

    // ─── Phase 7b: auto-populate the rep's KB from a CLOSED call ─────────
    // KB Part 2, sub-stage 2d. Gated on effectiveOutcome — the manual-override-
    // aware value, so a human-tagged outcome drives this exactly as it drives
    // close_score and payment_structure. Ruling 4: outcome alone, never cash
    // (a payment-plan close legitimately records zero at signing).
    //
    // NOT awaited, on purpose. The analysis drain is fire-and-forget and dies on
    // a Railway redeploy; this adds ~2-10 Voyage round-trips per closed call and
    // must not lengthen the window where a deploy can kill a call mid-analysis.
    // Zero new Claude calls — it files moments the extractor already produced.
    //
    // Fully swallowed: a KB failure can never fail or stall an analysis (the same
    // degrade rule fetchSellingContext follows). Idempotent with the manual
    // Add-to-KB button by construction — identical dedupe key, so whichever runs
    // second is a no-op.
    if (shouldHarvest(effectiveOutcome)) {
      harvestClosedCall(admin, {
        fathomCallId: fathomCallId,
        userId:       userId,
        outcome:      effectiveOutcome,
        highlights:   sanitizedHighlights,
        speakerConfidence: normalized.speaker_confidence,
      }).then(function (s) {
        console.log('[kb-harvest] call=%s added=%d duplicate=%d failed=%d unembedded=%d%s',
          fathomCallId, s.added, s.duplicate, s.failed, s.unembedded, s.skipped_reason ? ' skipped=' + s.skipped_reason : '');
      }).catch(function (e) {
        console.error('[kb-harvest] unexpected: ' + ((e && e.message) || 'unknown'));
      });
    }

    // ─── Phase 7c: attach the call to its PROSPECT (3d-1) ───────────────
    // EXACT-match attach only. Fuzzy joins are PROPOSALS for human review
    // (3d-2), never automatic — a wrong merge silently fabricates close-rate
    // numbers and is invisible in the aggregate.
    //
    // A call with no resolved name gets NO prospect. It must not join an
    // "Unknown" bucket: that would merge every unidentified prospect into one
    // row and wreck both the numerator and the denominator.
    //
    // Non-fatal throughout — grades are already saved and a grouping failure
    // must never fail an analysis.
    try {
      var pKey = nameKey(resolvedProspect.name);
      if (pKey) {
        var found = await admin.from('prospects').select('id')
          .eq('user_id', userId).eq('name_key', pKey).maybeSingle();
        var prospectId = found.data ? found.data.id : null;
        if (!prospectId) {
          var ins = await admin.from('prospects')
            .insert({ user_id: userId, display_name: resolvedProspect.name, name_key: pKey })
            .select('id').maybeSingle();
          if (ins.error && ins.error.code === '23505') {
            // Lost a race with a concurrent analysis of the same prospect —
            // the unique index arbitrated; just read the winner.
            var again = await admin.from('prospects').select('id')
              .eq('user_id', userId).eq('name_key', pKey).maybeSingle();
            prospectId = again.data ? again.data.id : null;
          } else if (!ins.error) {
            prospectId = ins.data ? ins.data.id : null;
          }
        }
        if (prospectId) {
          await admin.from('fathom_calls').update({ prospect_id: prospectId })
            .eq('id', fathomCallId).eq('user_id', userId);
        }
      }
    } catch (pErr) {
      console.warn('[analysis] prospect attach failed for ' + fathomCallId + ': ' + ((pErr && pErr.message) || 'unknown'));
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
  // Current grader prompt version — the dashboard uses this to surface calls
  // analyzed under an older version ("Update analyses (N outdated)").
  ANALYSIS_PROMPT_VERSION: ANALYSIS_PROMPT_VERSION,
  // Source-switch predicate (sub-stage 2) — 'zoom' | 'fathom'. Exported so the
  // branch decision is unit-testable without exercising the full analyzeCall.
  transcriptSourceFor: transcriptSourceFor,
  // Exported for tests / future internal callers — same precedent as me.js
  // (_computeCoachingPatterns, etc.).
  _extractFirstJsonObject:     extractFirstJsonObject,
  _extractFirstJsonArray:      extractFirstJsonArray,
  _sanitizeSection:            sanitizeSection,
  _sanitizeHighlights:         sanitizeHighlights,
  _persistHighlights:          persistHighlights,
  _findMeeting:                findMeeting,
  _formatTurnsForPrompt:       formatTurnsForPrompt,
  _formatSeconds:              formatSeconds,
  _buildSectionGraderPrompt:   buildSectionGraderPrompt,
  _sanitizeQualificationCovered: sanitizeQualificationCovered,
  _buildHighlightExtractorPrompt: buildHighlightExtractorPrompt,
  _markFathomCallErrored:      markFathomCallErrored,
  _sanitizeCashCollected:      sanitizeCashCollected,
  _sanitizePaymentStructure:   sanitizePaymentStructure,
  _sanitizeEodSummary:         sanitizeEodSummary,
  _claimAnalysisRun:           claimAnalysisRun,
  _CLAIM_STALE_MS:             CLAIM_STALE_MS,
};
