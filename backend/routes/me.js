const express = require('express');
const { normalizeName } = require('../lib/display-name');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');
const { CLAUDE_MODEL } = require('../config');
const { computeCallAnalytics, computeObjectionIntel } = require('../lib/session-analytics');
const { gradingBacklog } = require('../lib/grading-backlog');
const { generateCandidates } = require('../lib/prospect-merge');
const { buildSectionBreakdown, sectionScoreOf, SECTIONS } = require('../lib/section-breakdown');
// ⚠ TWO FUNCTIONS CALLED rankSections EXISTED, MEANING OPPOSITE THINGS:
// section-breakdown's ranked 1 = STRONGEST; section-ranking's ranks 1 = WEAKEST
// (worst first, which is the coaching frame). The card and the drilldown it
// opens would have shown "1 of 5" and "5 of 5" for the SAME section, both
// labelled "rank". One definition now, and the copy says which end it means.
const SR = require('../lib/section-ranking');
const { computeWhyFacts } = require('../lib/why-prose');
/* const { quoteHash } = require('../lib/kb-entry'); */ // only reader was the
// saved-to-KB badge, removed 2026-08-18 with the Add-to-KB buttons
const { nameKey } = require('../lib/prospect-entity');
const { computePersonalNeedsWork, loadBucketEvidence } = require('../lib/team-needs-work');
const { VALID_OUTCOMES, effectiveCloseScore, canTagOutcome,
        canMarkNotSalesCall, markRoleFor } = require('../lib/outcome-tag');
const { computeObjectionSynthesis } = require('../lib/objection-synthesis');
const { computePerformanceSynthesis } = require('../lib/performance-synthesis');

var router = express.Router();

// Service-role client: bypasses RLS so the route can read the caller's
// sessions without the RLS scoped policy round-trip. Ownership is enforced
// explicitly below (user_id match from the JWT).
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[me] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 100;
var LOG_HARD_CAP = 10000;

// Duplicated from routes/admin.js — two tiny pure helpers. If a third
// consumer appears, extract to backend/lib/session-helpers.js.
function computeCountsBySession(rows) {
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !r.session_id) continue;
    if (!out[r.session_id]) out[r.session_id] = { log_count: 0, error_count: 0 };
    out[r.session_id].log_count += 1;
    if (r.level === 'error') out[r.session_id].error_count += 1;
  }
  return out;
}

function computeDurationSeconds(startedAt, endedAt) {
  if (!endedAt) return null;
  var start = new Date(startedAt).getTime();
  var end = new Date(endedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

// ── GET /me/sessions ────────────────────────────────────────────────────────
// Caller's own sessions. Same payload shape as /admin/sessions but
// auto-filtered to req.user.id — no email enrichment needed.

// ── GET /me/sessions/:session_id/logs ───────────────────────────────────────
// Caller's own session logs. Ownership check: 404 if the session doesn't
// belong to req.user.id — prevents an authenticated user from iterating
// UUIDs to snoop on other users' logs. 404 rather than 403 to avoid
// leaking session-id validity.

// ────────────────────────────────────────────────────────────────────────────
// Analytics extraction (Milestone 1 for v1.1.10 /dashboard)
//
// Two manual endpoints, both /me-scoped + ownership-checked. Manual on
// purpose — lets us backfill historical sessions before wiring auto-trigger
// into desktop stop-session in Milestone 2.
// ────────────────────────────────────────────────────────────────────────────

// Lazy Anthropic client (same pattern as proxy.js). Created on first call.
var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  }
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Strip ```json / ``` fences from Claude responses. Same pattern as
// call-memory.js — Claude sometimes ignores "no fences" prompt instructions.
function stripCodeFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Extract the first balanced JSON object from a string. Tolerates Claude
// wrapping JSON in prose ("Here's my analysis: {...}"), markdown fences,
// or trailing commentary. Returns the parsed object or null on failure.
// Switched in v1.1.10 backfill after Money Objection classifications were
// failing JSON.parse 100% of the time — Claude returned valid JSON inside
// a sentence-wrapped narrative the strict parser couldn't see past.
function extractFirstJsonObject(text) {
  if (!text) return null;
  var cleaned = stripCodeFences(text);
  // Try strict parse first — cheap when Claude obeyed the prompt.
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }
  // Find first '{' and parse forward, tracking depth + string state to find
  // the matching close brace.
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

// Map from objection label (as it appears in '[claude] Local objection match: <label>')
// to objection_id + framework + framework_rebuttal. Source of truth:
// src/ai/objections.js. Hardcoded here to avoid cross-folder import — keep
// in sync manually if objections.js changes (rebuttal text is denormalized
// onto session_objections at extraction time so historical rows preserve
// what Scout would have suggested at that moment).
var OBJECTION_LABEL_MAP = {
  'Money Objection': {
    id: 'money', framework: 'money',
    rebuttal: 'Money aside, would you do it?',
  },
  'Talk to My Wife': {
    id: 'talk-to-spouse', framework: 'spouse',
    rebuttal: "How do you know that respecting your wife means you can't make a change today to make more money for your family?",
  },
  'I Need to Think About It': {
    id: 'think-about-it', framework: 'think',
    rebuttal: 'How do you know that thinking about it longer will lead you to making a better decision?',
  },
  'No Time': {
    id: 'no-time', framework: 'time',
    rebuttal: "When you say you don't have time, what are you really saying? Are you saying you don't have time, or that this isn't a priority?",
  },
  'Tried Programs Before': {
    id: 'tried-before', framework: null,
    rebuttal: 'I appreciate you being upfront about that. Most people who invest at this level have tried things that did not pan out. What do you think was missing from those experiences that kept them from working?',
  },
  'Send Me Information': {
    id: 'send-info', framework: null,
    rebuttal: 'Happy to. But honestly, most of the important stuff is what we are covering right now. What specific question do you have that, if I answered it here, would help you make a decision today?',
  },
  'What is the Guarantee': {
    id: 'guarantee', framework: null,
    rebuttal: 'Great question. We guarantee the process, the support, and the framework. What we cannot guarantee is effort. But you do not strike me as someone who has a problem with that.',
  },
  'Need to Do More Research': {
    id: 'more-research', framework: null,
    rebuttal: 'Makes sense. What would you be comparing us against, specifically? I want to make sure you are looking at the right things so you do not waste time.',
  },
  'Not the Right Time': {
    id: 'not-right-time', framework: null,
    rebuttal: 'What would have to change in the next few months for this to become the right time?',
  },
  'How Do I Know It Will Work': {
    id: 'proof-it-works', framework: null,
    rebuttal: 'The people who get results have one thing in common: they show up and do the work. Based on what you have told me today, do you see yourself as someone who would actually follow through?',
  },
};

// Helper: enforce ownership on a session_id, returning the row or null.
// Returns null for both "session does not exist" and "session belongs to
// another user" — same opacity pattern used by /me/sessions/:id/logs above.
async function loadOwnedSession(admin, sessionId, userId, columns) {
  var result = await admin
    .from('call_sessions')
    .select(columns)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.user_id !== userId) return null;
  return result.data;
}

// ── POST /me/sessions/:session_id/extract-outcome ───────────────────────────
// Infer win/loss/follow_up from the session's post_call_summary text via
// Claude. Writes outcome + outcome_source='inferred' to call_sessions, ONLY
// when outcome_source is currently null (never overwrites a manual mark).
router.post('/sessions/:session_id/extract-outcome', requireAuth, async function(req, res) {
  var sessionId = req.params.session_id;
  try {
    var admin = getAdminClient();
    var session = await loadOwnedSession(
      admin, sessionId, req.user.id,
      'session_id, user_id, outcome, outcome_source, post_call_summary'
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.post_call_summary || !session.post_call_summary.trim()) {
      return res.status(400).json({ error: 'Session has no post_call_summary to infer from' });
    }
    if (session.outcome_source === 'manual') {
      return res.status(409).json({
        error: 'Outcome already marked manually',
        outcome: session.outcome,
        outcome_source: 'manual',
      });
    }

    var prompt =
      'Given this post-call coaching summary, classify the call outcome.\n\n' +
      'Outcome definitions:\n' +
      '- "win": prospect committed, agreed to terms, or signed up\n' +
      '- "loss": prospect explicitly declined, said no, or ended without commitment\n' +
      '- "follow_up": prospect deferred decision, asked to think, or wanted more time\n\n' +
      'Confidence levels:\n' +
      '- "high": summary explicitly states the outcome\n' +
      '- "medium": outcome is clearly implied but not explicit\n' +
      '- "low": summary is ambiguous — default to follow_up in this case\n\n' +
      'Respond with ONLY a JSON object on a single line, no markdown, no code fences:\n' +
      '{"outcome":"win|loss|follow_up","confidence":"high|medium|low"}\n\n' +
      'SUMMARY:\n' + session.post_call_summary;

    var anthropic = getAnthropic();
    var response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    var rawText = response.content[0] ? response.content[0].text : '';
    var parsed = extractFirstJsonObject(rawText);
    if (!parsed) {
      console.error('[me] extract-outcome JSON extraction failed:', rawText.slice(0, 200));
      return res.status(502).json({ error: 'Claude returned non-JSON: ' + rawText.slice(0, 100) });
    }

    var outcome = parsed && parsed.outcome;
    var confidence = parsed && parsed.confidence;
    if (['win', 'loss', 'follow_up'].indexOf(outcome) === -1) {
      return res.status(502).json({ error: 'Claude returned invalid outcome: ' + outcome });
    }

    var update = await admin
      .from('call_sessions')
      .update({ outcome: outcome, outcome_source: 'inferred' })
      .eq('session_id', sessionId)
      .eq('user_id', req.user.id)
      .is('outcome_source', null)  // belt-and-suspenders — don't overwrite manual mark
      .select('session_id')
      .maybeSingle();
    if (update.error) {
      console.error('[me] extract-outcome update failed:', update.error.message);
      return res.status(500).json({ error: 'Could not save inferred outcome' });
    }

    res.json({ outcome: outcome, confidence: confidence, outcome_source: 'inferred' });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] extract-outcome error:', err.message);
    res.status(500).json({ error: 'Failed to extract outcome: ' + (err.message || 'unknown') });
  }
});

// ── POST /me/sessions/:session_id/extract-objections ────────────────────────
// Mine session_logs for '[claude] Local objection match: <label>' lines, ask
// Claude whether each was overcome based on the ±90s window of transcript
// around it, persist to session_objections. Idempotent: deletes any existing
// rows for the session first so re-runs are clean.
router.post('/sessions/:session_id/extract-objections', requireAuth, async function(req, res) {
  var sessionId = req.params.session_id;
  try {
    var admin = getAdminClient();
    var session = await loadOwnedSession(
      admin, sessionId, req.user.id,
      'session_id, user_id, prospect_name, started_at'
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Pull all detector matches for this session.
    var matchesResult = await admin
      .from('session_logs')
      .select('logged_at, message')
      .eq('session_id', sessionId)
      .like('message', '%Local objection match:%')
      .order('logged_at', { ascending: true });
    if (matchesResult.error) {
      console.error('[me] objection-match query failed:', matchesResult.error.message);
      return res.status(500).json({ error: 'Could not load objection events' });
    }
    var matches = matchesResult.data || [];
    if (matches.length === 0) {
      return res.json({ extracted: 0, message: 'No objections detected in this session' });
    }

    // Idempotent re-run: delete existing rows for this session, re-insert below.
    var del = await admin
      .from('session_objections')
      .delete()
      .eq('session_id', sessionId);
    if (del.error) {
      console.error('[me] objection delete-before-reinsert failed:', del.error.message);
      return res.status(500).json({ error: 'Could not clear previous objection rows' });
    }

    // Per-objection time-windowed query. Replaces an earlier "fetch all logs
    // once and slice in JS" approach that silently truncated to 1000 rows
    // (supabase-js default) on long sessions — sessions over ~45min have
    // 3000-7000 log lines, so any objection in the second half landed outside
    // the slice. Filtering by timestamp in the WHERE clause avoids that
    // entirely and only fetches what each objection's window actually needs.
    var anthropic = getAnthropic();
    var rowsToInsert = [];
    var WINDOW_MS = 90 * 1000;

    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      var label = extractLabelFromMatchMessage(match.message);
      if (!label) continue;
      var typeInfo = OBJECTION_LABEL_MAP[label];
      if (!typeInfo) {
        // Unknown label — log and skip rather than fail the whole batch.
        console.warn('[me] Unknown objection label, skipping: ' + label);
        continue;
      }

      var detectedAt = new Date(match.logged_at).getTime();
      var windowStart = new Date(detectedAt - WINDOW_MS).toISOString();
      var windowEnd = new Date(detectedAt + WINDOW_MS).toISOString();
      var windowQ = await admin
        .from('session_logs')
        .select('logged_at, tag, message')
        .eq('session_id', sessionId)
        .gte('logged_at', windowStart)
        .lte('logged_at', windowEnd)
        .order('logged_at', { ascending: true })
        .limit(500);
      if (windowQ.error) {
        console.warn('[me] window query failed for ' + label + ': ' + windowQ.error.message);
      }
      var windowRows = windowQ.data || [];
      // Transcript turns live under '[deepgram]' tag with shape
      // '[deepgram] Transcript (final) [PROSPECT|CLOSER]: <text>'.
      var transcriptRows = windowRows.filter(function(l) {
        return l.tag === '[deepgram]' && l.message && l.message.indexOf('Transcript (final)') !== -1;
      });
      var sourceRows = transcriptRows.length >= 3 ? transcriptRows : windowRows;
      var windowTurns = sourceRows.map(function(l) { return l.message; }).join('\n').slice(0, 8000);

      // Closer's actual response: filter to CLOSER transcript turns in the
      // 0–60s AFTER the objection fired. These are the words we'll show
      // side-by-side with the framework rebuttal on the /coaching page.
      var afterWindow = transcriptRows.filter(function(l) {
        var t = new Date(l.logged_at).getTime();
        if (t < detectedAt || t > detectedAt + 60000) return false;
        return l.message.indexOf('[CLOSER]') !== -1;
      });
      var closerResponseRaw = afterWindow.map(function(l) {
        // Strip the '[deepgram] Transcript (final) [CLOSER]: ' prefix
        var idx = l.message.indexOf('[CLOSER]:');
        return idx !== -1 ? l.message.slice(idx + 9).trim() : l.message;
      }).join(' ').slice(0, 800);  // cap so we don't oversize the table

      // Build prompt with all context the coaching narrative needs.
      var dateForNarrative = session.started_at
        ? new Date(session.started_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
        : 'an unknown date';
      var prospectRef = session.prospect_name && session.prospect_name.trim()
        ? session.prospect_name.trim()
        : 'the prospect';

      var classifyPrompt =
        'A "' + label + '" was detected in a sales call. Below is the ±90 seconds of ' +
        'call activity around it.\n\n' +
        'The framework\'s recommended rebuttal for this objection is:\n' +
        '"' + typeInfo.rebuttal + '"\n\n' +
        'Based on what actually happened, generate a coaching analysis in JSON.\n\n' +
        '"overcome" means the prospect moved past the objection (committed, asked the next ' +
        'question, agreed to continue). "Not overcome" means the objection ended the ' +
        'conversation or the prospect doubled down. Use null when the window is ambiguous ' +
        'or transcript quality is too poor to tell.\n\n' +
        '"coaching_note" must follow this exact narrative format (2-3 sentences):\n' +
        '  "On the call with ' + prospectRef + ' on ' + dateForNarrative + ', ' +
        '[describe what the prospect said/did]. You [describe what the closer did] ' +
        'instead of [what the framework rebuttal recommends]. Try: \\"[suggested specific ' +
        'phrasing — quote the framework rebuttal or a close variant]\\""\n' +
        '  Be specific about what the closer actually did wrong (e.g., "let it walk by ' +
        'agreeing to follow up later", "rushed past it with a new pitch", "agreed to ' +
        'send info instead of isolating the real concern"). Use the prospect\'s actual ' +
        'words where possible.\n' +
        '  If the closer DID overcome the objection well, the coaching_note should ' +
        'still follow the format but praise specifically (e.g., "On the call with ' +
        prospectRef + ' on ' + dateForNarrative + ', [prospect said X]. You [did Y, ' +
        'matching the framework]. Keep doing this — the prospect [reacted Z].")\n\n' +
        'Respond with ONLY this JSON, no markdown, no fences:\n' +
        '{"overcome": true|false|null, "confidence":"high|medium|low", ' +
        '"notes":"<short classifier rationale, max 150 chars>", ' +
        '"closer_response_summary":"<1-2 sentence summary of what closer actually said>", ' +
        '"coaching_note":"<2-3 sentence narrative following the format above>"}\n\n' +
        'CALL WINDOW:\n' + windowTurns;

      try {
        var resp = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 800,
          messages: [{ role: 'user', content: classifyPrompt }],
        });
        var rawText = resp.content[0] ? resp.content[0].text : '';
        var parsed = extractFirstJsonObject(rawText);
        if (!parsed) {
          console.warn('[me] classify parse failed for ' + label + ' — recording as null:', rawText.slice(0, 100));
          parsed = {
            overcome: null, confidence: 'low',
            notes: 'classifier output unparseable',
            closer_response_summary: null, coaching_note: null,
          };
        }
        rowsToInsert.push({
          session_id: sessionId,
          user_id: req.user.id,
          detected_at: match.logged_at,
          objection_id: typeInfo.id,
          objection_label: label,
          framework: typeInfo.framework,
          framework_rebuttal: typeInfo.rebuttal,
          overcome: typeof parsed.overcome === 'boolean' ? parsed.overcome : null,
          overcome_confidence: ['high', 'medium', 'low'].indexOf(parsed.confidence) !== -1 ? parsed.confidence : null,
          notes: parsed.notes ? String(parsed.notes).slice(0, 200) : null,
          // Two related fields: closer_response is the raw quoted text from
          // the transcript (so the UI can show their actual words);
          // closer_response_summary (in notes/coaching_note context) is
          // Claude's paraphrase. We surface the raw quote on the page.
          closer_response: closerResponseRaw || (parsed.closer_response_summary ? String(parsed.closer_response_summary).slice(0, 800) : null),
          coaching_note: parsed.coaching_note ? String(parsed.coaching_note).slice(0, 1200) : null,
        });
      } catch (classifyErr) {
        console.warn('[me] classify call failed for ' + label + ':', classifyErr.message);
        rowsToInsert.push({
          session_id: sessionId,
          user_id: req.user.id,
          detected_at: match.logged_at,
          objection_id: typeInfo.id,
          objection_label: label,
          framework: typeInfo.framework,
          framework_rebuttal: typeInfo.rebuttal,
          overcome: null,
          overcome_confidence: null,
          notes: 'classifier error: ' + (classifyErr.message || 'unknown').slice(0, 150),
          closer_response: closerResponseRaw || null,
          coaching_note: null,
        });
      }
    }

    if (rowsToInsert.length === 0) {
      return res.json({ extracted: 0, message: 'No matchable objections' });
    }

    var insert = await admin.from('session_objections').insert(rowsToInsert);
    if (insert.error) {
      console.error('[me] objection insert failed:', insert.error.message);
      return res.status(500).json({ error: 'Could not save objection rows' });
    }

    res.json({ extracted: rowsToInsert.length });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] extract-objections error:', err.message);
    res.status(500).json({ error: 'Failed to extract objections: ' + (err.message || 'unknown') });
  }
});

// Parse '[claude] Local objection match: Money Objection' → 'Money Objection'.
// Returns null if the format doesn't match (defensive — older sessions may
// have used slightly different phrasing).
function extractLabelFromMatchMessage(message) {
  if (!message) return null;
  var marker = 'Local objection match:';
  var idx = message.indexOf(marker);
  if (idx === -1) return null;
  return message.slice(idx + marker.length).trim();
}

// ── GET /me/analytics?from=<iso>&to=<iso> ───────────────────────────────────
// Caller-scoped dashboard aggregates. Defaults to last 30 days. Wraps the
// shared computeAnalytics() helper (also used by /admin/analytics/:user_id).

// ── GET /me/analytics2?from=&to= ────────────────────────────────────────────
// Fathom-era Coaching Dashboard analytics (call_analyses + call_highlights).
// One round trip; feeds all overview widgets (Calls / Avg Score / Objections
// donuts + computed coach summary). Admin pivot equivalent: /admin/analytics2/:user_id.
/* ── GET /me/grading-backlog ────────────────────────────────────────────────
   How many of the caller's calls are graded, and how many are still waiting.

   ⚠⚠ ITS OWN ROUTE, NOT A FIELD ON A PROVIDER STATUS — that was the bug. These
   counts were computed inside GET /fathom/status, which returns
   `{connected:false}` and nothing else when there is no fathom_connections row.
   A Zoom-only user therefore had NO count and NO grading control anywhere on
   the dashboard, while the Calls page went on printing "102 not graded yet"
   from its own source-agnostic query. Nothing about this question belongs to a
   provider: fathom_calls holds Zoom rows too.

   ⚠ SELF-SCOPED. Grading dispatches against req.user.id, so the control that
   reads this must never render on an admin pivot — the frontend gates on
   isSelf() for exactly that reason. */
router.get('/grading-backlog', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var currentVersion = require('../lib/analysis-worker').ANALYSIS_PROMPT_VERSION;
    res.json(await gradingBacklog(admin, req.user.id, currentVersion));
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] grading-backlog failed for user ' + req.user.id + ':', err.stack || err.message);
    res.status(500).json({ error: 'Failed to load grading backlog' });
  }
});

router.get('/analytics2', requireAuth, async function(req, res) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var result = await computeCallAnalytics(getAdminClient(), req.user.id, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] analytics2 error:', err.message);
    res.status(500).json({ error: 'Failed to load analytics: ' + (err.message || 'unknown') });
  }
});

// ── GET /me/needs-work?from=&to= ────────────────────────────────────────────
// Personal "What needs work" (A-2.1): the closer's own weakest objection bucket
// with team-borrowed money economics. Default window 90d (objections are sparse
// per-person). Cached; a cache hit spends no Claude.
router.get('/needs-work', requireAuth, async function(req, res) {
  // Range-responsive: computes on the SELECTED window (default 90d). Objections
  // are sparse per-person, so a short range may degrade to "not enough volume".
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  try {
    var result = await computePersonalNeedsWork(getAdminClient(), req.user.id, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] needs-work error:', err.message);
    res.status(500).json({ error: 'Failed to load needs-work: ' + (err.message || 'unknown') });
  }
});

// ── PATCH /me/calls/:call_id/outcome — manual outcome tag (Thread 1) ─────────
// One permission-aware endpoint (canTagOutcome): owner → any call; manager →
// own + managed reps; UNMANAGED user → own calls; MANAGED rep → NOT their own.
// Writes the canonical call_analyses.outcome (source=manual) so it flows into
// close rate / team analytics / needs-work / EOD, and recomputes the displayed
// Close score (100 when closed, else the earned score). Re-analysis can't
// overwrite this (analyzeCall freezes manual outcomes).
router.patch('/calls/:call_id/outcome', requireAuth, async function(req, res) {
  var callId = req.params.call_id;
  var outcome = req.body && req.body.outcome;
  if (VALID_OUTCOMES.indexOf(outcome) === -1) return res.status(400).json({ error: 'outcome must be one of: ' + VALID_OUTCOMES.join(', ') });
  try {
    var admin = getAdminClient();
    var a = await admin.from('call_analyses').select('fathom_call_id, user_id, close_score, close_score_earned').eq('fathom_call_id', callId).maybeSingle();
    if (a.error) throw new Error('call lookup: ' + a.error.message);
    if (!a.data) return res.status(404).json({ error: 'Call analysis not found' });
    var ownerId = a.data.user_id;
    var profs = await admin.from('user_profiles').select('user_id, role, managed_by').in('user_id', [ownerId, req.user.id]);
    var rows = (profs.data || []);
    var ownerProfile = rows.filter(function (p) { return p.user_id === ownerId; })[0] || { user_id: ownerId, managed_by: null };
    var actorRow = rows.filter(function (p) { return p.user_id === req.user.id; })[0];
    var actorRole = (actorRow && actorRow.role) || req.userProfileRole || 'user';
    if (!canTagOutcome({ id: req.user.id, role: actorRole }, ownerProfile)) {
      console.warn('[me] outcome-tag denied: actor=%s call=%s owner=%s', req.user.id, callId, ownerId);
      return res.status(403).json({ error: 'You are not allowed to tag this call' });
    }
    var closeScore = effectiveCloseScore(outcome, a.data.close_score_earned, a.data.close_score);
    var up = await admin.from('call_analyses').update({
      outcome: outcome, outcome_source: 'manual', outcome_set_at: new Date().toISOString(),
      outcome_set_by: req.user.id, close_score: closeScore,
    }).eq('fathom_call_id', callId).select('fathom_call_id').single();
    if (up.error) throw new Error('update: ' + up.error.message);
    console.log('[me] outcome tagged: actor=%s call=%s owner=%s -> %s (close_score %s)', req.user.id, callId, ownerId, outcome, closeScore);
    res.json({ call_id: callId, outcome: outcome, outcome_source: 'manual', close_score: closeScore });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] outcome tag error:', err.message);
    res.status(500).json({ error: 'Failed to tag outcome' });
  }
});

// ── POST /me/needs-work/bucket — per-call evidence for one bucket (item #3) ──
// Body: { surfaces:[...], from, to }. The client sends the bucket's surfaces
// (from the needs-work result's mapping) so we don't re-run the Claude bucketing.
router.post('/needs-work/bucket', requireAuth, async function(req, res) {
  var b = req.body || {};
  var surfaces = Array.isArray(b.surfaces) ? b.surfaces.slice(0, 200) : null;
  if (!surfaces || !surfaces.length) return res.status(400).json({ error: 'surfaces[] required' });
  var to = b.to || new Date().toISOString();
  var from = b.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    var rows = await loadBucketEvidence(getAdminClient(), [req.user.id], surfaces, from, to);
    res.json({ calls: rows });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] needs-work bucket error:', err.message);
    res.status(500).json({ error: 'Failed to load bucket evidence' });
  }
});

// ── GET /me/objections-intel?from=&to= ──────────────────────────────────────
// Objection intelligence for the Objections view: metrics + per-category
// breakdown + a feed of objection moments with Fathom clip links. Admin pivot
// equivalent: /admin/objections-intel/:user_id.
router.get('/objections-intel', requireAuth, async function(req, res) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var result = await computeObjectionIntel(getAdminClient(), req.user.id, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] objections-intel error:', err.message);
    res.status(500).json({ error: 'Failed to load objection intelligence: ' + (err.message || 'unknown') });
  }
});

// ── GET /me/objections-synthesis?from=&to= ──────────────────────────────────
// Grounded ISOLATE→REFRAME→OVERCOME coaching per objection category. One Claude
// call, cached per (user, range, analysis-set). Credit-tolerant: returns
// { available:false, reason } (HTTP 200) on Anthropic failure so the view can
// degrade gracefully rather than 500 the whole dashboard.
router.get('/objections-synthesis', requireAuth, async function(req, res) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var result = await computeObjectionSynthesis(getAdminClient(), req.user.id, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] objections-synthesis error:', err.message);
    res.status(500).json({ error: 'Failed to load synthesis: ' + (err.message || 'unknown') });
  }
});

// ── GET /me/performance-synthesis?from=&to= ─────────────────────────────────
// Evidence-linked Performance Summary (WHAT'S WORKING / WHAT TO IMPROVE),
// comparing win-class vs loss-class calls. One cached Claude call per
// (user, range). Credit-tolerant: { available:false } (HTTP 200) on failure.
router.get('/performance-synthesis', requireAuth, async function(req, res) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var result = await computePerformanceSynthesis(getAdminClient(), req.user.id, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] performance-synthesis error:', err.message);
    res.status(500).json({ error: 'Failed to load performance summary: ' + (err.message || 'unknown') });
  }
});

// ── GET /me/objections?objection_id=<id>&from=&to= ──────────────────────────
// Per-type drill: every event of one objection type across the caller's
// sessions in the date window. Used by the dashboard's third-level drill
// when the user clicks a type row inside the Objections drill. Joins each
// event with the call's prospect_name + outcome so the per-event card can
// show "On the call with X on Y...".

// ── GET /me/sessions/:session_id/objections ─────────────────────────────────
// Per-session objection drill — for the dashboard's expanded card view.
// Ownership-checked (404 on cross-user). Admin equivalent lives in admin.js.

// ── POST /me/sessions/:session_id/extract-prospect-name ─────────────────────
// Claude extracts the prospect's first name from the first ~10 minutes of
// the call. Stored on call_sessions.prospect_name. Used by extract-objections
// to populate the coaching_note narrative ("On the call with John on…").
//
// Idempotent — overwrites any existing name. Caller decides when to re-run.
router.post('/sessions/:session_id/extract-prospect-name', requireAuth, async function(req, res) {
  var sessionId = req.params.session_id;
  try {
    var admin = getAdminClient();
    var session = await loadOwnedSession(admin, sessionId, req.user.id, 'session_id, user_id, started_at');
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Pull the first 10 minutes of transcript. Names usually surface in the
    // intro. Filter to PROSPECT turns and the closer's opening (which often
    // contains "Hi, am I speaking with X?" — also useful signal).
    var startedAt = new Date(session.started_at).getTime();
    var windowEnd = new Date(startedAt + 10 * 60 * 1000).toISOString();
    var q = await admin
      .from('session_logs')
      .select('logged_at, tag, message')
      .eq('session_id', sessionId)
      .gte('logged_at', session.started_at)
      .lte('logged_at', windowEnd)
      .eq('tag', '[deepgram]')
      .like('message', '%Transcript (final)%')
      .order('logged_at', { ascending: true })
      .limit(500);
    if (q.error) {
      console.error('[me] extract-prospect-name window query failed:', q.error.message);
      return res.status(500).json({ error: 'Could not load intro transcript' });
    }
    var introText = (q.data || []).map(function(l) { return l.message; }).join('\n').slice(0, 5000);
    if (!introText.trim()) {
      return res.json({ prospect_name: null, reason: 'no transcript content in first 10 minutes' });
    }

    var prompt =
      'Below is the first ~10 minutes of a sales call transcript. Extract the ' +
      'prospect\'s FIRST NAME only. (The prospect is the person being sold to, ' +
      'not the closer.) Return ONLY this JSON, no markdown:\n' +
      '{"prospect_name":"<first name>"|null,"confidence":"high|medium|low"}\n' +
      'Return null when no name is clearly stated. Don\'t guess.\n\n' +
      'TRANSCRIPT:\n' + introText;

    var anthropic = getAnthropic();
    var resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });
    var rawText = resp.content[0] ? resp.content[0].text : '';
    var parsed = extractFirstJsonObject(rawText);
    if (!parsed) {
      return res.status(502).json({ error: 'Claude returned non-JSON: ' + rawText.slice(0, 100) });
    }
    var name = (parsed.prospect_name && typeof parsed.prospect_name === 'string') ? parsed.prospect_name.trim() : null;

    var update = await admin
      .from('call_sessions')
      .update({ prospect_name: name })
      .eq('session_id', sessionId)
      .eq('user_id', req.user.id)
      .select('session_id')
      .maybeSingle();
    if (update.error) {
      console.error('[me] extract-prospect-name update failed:', update.error.message);
      return res.status(500).json({ error: 'Could not save prospect name' });
    }

    res.json({ prospect_name: name, confidence: parsed.confidence || null });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] extract-prospect-name error:', err.message);
    res.status(500).json({ error: 'Failed to extract prospect name' });
  }
});

// ── GET /me/coaching/patterns?from=&to= ─────────────────────────────────────
// Cross-session pattern-level coaching. Pulls the user's session_objections
// + call_sessions in the date window, asks Claude to surface 3-5 recurring
// behaviors with specific recommendations. Distinct from /me/analytics
// (numbers) — this returns prose recommendations grounded in the data.
//
// Honest caveat: with <30 sessions of data, patterns will be directional
// not definitive. The prompt is calibrated to be cautious in low-data
// regimes — it will state confidence and skip patterns that aren't backed
// by enough evidence.

/* Shared with GET /admin/needs-work-sections/:user_id — a manager viewing a rep
   must get THAT REP's section ranking. Same precedent as _computeSectionBreakdown. */
router._computeNeedsWorkSections = computeNeedsWorkSections;
router._computeCountsBySession = computeCountsBySession;
router._computeDurationSeconds = computeDurationSeconds;
router._extractLabelFromMatchMessage = extractLabelFromMatchMessage;
router._OBJECTION_LABEL_MAP = OBJECTION_LABEL_MAP;

// ─── Account page (Stage 5) ──────────────────────────────────────────────────
// Self-serve account surface. The managed lock (user_profiles.managed_by IS
// NOT NULL — the platform's single source of truth, same as kb.js) applies to
// name edits here; password changes live in routes/auth.js and are EXEMPT
// from the lock by ruling (personal security, not business config).

function validateNameField(v) {
  if (typeof v !== 'string') return null;
  var t = v.trim();
  return (t.length >= 1 && t.length <= 60) ? t : null;
}

function buildAccountPayload(prof, email) {
  prof = prof || {};
  return {
    // (j) the seller's own price — the price-drop lookup reads this.
    price_pif: (prof.price_pif != null) ? Number(prof.price_pif) : null,
    email: email,
    first_name: prof.first_name || null,
    last_name: prof.last_name || null,
    role: prof.role || 'user',
    is_managed: !!prof.managed_by,
    billing: {
      status: prof.billing_status || 'trial',
      plan: prof.billing_plan || null,
      provider: prof.billing_provider || null,
    },
  };
}

// GET /me/account — everything the account page renders.
router.get('/account', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var q = await admin.from('user_profiles')
      .select('first_name, last_name, role, managed_by, billing_status, billing_plan, billing_provider, price_pif')
      .eq('user_id', req.user.id).maybeSingle();
    if (q.error) throw new Error('user_profiles: ' + q.error.message);
    res.json(buildAccountPayload(q.data, req.user.email));
  } catch (err) {
    console.error('[me] account:', err.message);
    res.status(500).json({ error: 'Failed to load account' });
  }
});

// PATCH /me/account — allowlisted self-edits (first_name, last_name).
// FRESH managed_by check per mutation: the lock's source of truth is the
// column, not a stale UI flag. Managed users → 403.
router.patch('/account', requireAuth, async function(req, res) {
  try {
    var admin = getAdminClient();
    var lock = await admin.from('user_profiles').select('managed_by').eq('user_id', req.user.id).maybeSingle();
    if (lock.error) throw new Error('lock check: ' + lock.error.message);
    if (lock.data && lock.data.managed_by) {
      return res.status(403).json({ error: 'Your account is managed by your admin — ask them to make changes.' });
    }
    var body = req.body || {};
    var updates = {};
    if (body.first_name !== undefined) {
      var fn = validateNameField(body.first_name);
      if (!fn) return res.status(400).json({ error: 'first_name must be 1-60 characters' });
      updates.first_name = normalizeName(fn);   // capitalise on the way in

    }
    if (body.last_name !== undefined) {
      var ln = validateNameField(body.last_name);
      if (!ln) return res.status(400).json({ error: 'last_name must be 1-60 characters' });
      updates.last_name = normalizeName(ln);

    }
    /**
     * ⚠ PRICE — item (j). The price-drop metric is a LOOKUP on the seller's own
     * price, so a rep with no stored price gets no measurement at all. It was
     * only ever captured by the ELECTRON onboarding wizard
     * (src/renderer/onboarding/onboarding.html), which is dormant — which is
     * exactly why 1 of 8 profiles had it. This is the web home for it.
     *
     * ⚠ price_pif ONLY. price_2pay (the plan figure) must NOT drive the metric:
     * it is a decoy generator — Josh's is 400 and these calls are full of
     * "a couple hundred bucks", "$300 to $500 a month", "about $400 max".
     * It is accepted here for completeness of the profile, and lib/price-moment
     * never reads it.
     */
    ['price_pif', 'price_2pay'].forEach(function (k) {
      if (body[k] === undefined) return;
      if (body[k] === null || body[k] === '') { updates[k] = null; return; }
      var n = Number(body[k]);
      if (!isFinite(n) || n <= 0 || n > 10000000 || Math.round(n) !== n) {
        throw Object.assign(new Error(k + ' must be a whole number of dollars'), { status: 400 });
      }
      updates[k] = n;
    });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update (editable: first_name, last_name, price_pif, price_2pay)' });
    updates.updated_at = new Date().toISOString();
    var up = await admin.from('user_profiles').update(updates).eq('user_id', req.user.id);
    if (up.error) throw new Error('update: ' + up.error.message);
    console.log('[me] account updated: user=%s fields=%s', req.user.id, Object.keys(updates).filter(function(k){return k!=='updated_at';}).join(','));
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[me] account update:', err.message);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// ── PROSPECT MERGE REVIEW (3d-2) ─────────────────────────────────────────
// Close rate is closed PROSPECTS / TOTAL prospects, so every unmerged duplicate
// moves the headline number — and a WRONG merge silently fuses two people and is
// invisible in the aggregate. These routes therefore PROPOSE and APPLY, but a
// human always decides. Proven necessary on live data: the title generator
// proposed "Mark-Anthony ~ Forb" and that call's summary said Forb "got routed
// into the wrong Zoom meeting".

// GET /me/prospects/merge-candidates — proposals with the evidence a reviewer
// needs: both names, per-call source/confidence/date/title/outcome, the prose
// opening, and what the merge would do to the close rate.
router.get('/prospects/merge-candidates', requireAuth, async function (req, res) {
  try {
    var admin = getAdminClient();
    // Caller-scoped only. A manager reviewing a rep's prospects would need the
    // /admin pivot's scope check; deliberately out of scope for 3d-2 rather than
    // hand-rolling a second authorization path here.
    var userId = req.user.id;

    var pq = await admin.from('prospects')
      .select('id, display_name, merged_into').eq('user_id', userId);
    if (pq.error) throw new Error('prospects: ' + pq.error.message);
    var prospects = (pq.data || []).map(function (p) { return { id: p.id, display_name: p.display_name, merged_into: p.merged_into, calls: [] }; });
    if (!prospects.length) return res.json({ candidates: [] });

    var byId = {}; prospects.forEach(function (p) { byId[p.id] = p; });

    var cq = await admin.from('fathom_calls')
      .select('id, prospect_id, title, call_date, recording_url')
      .eq('user_id', userId).not('prospect_id', 'is', null)
      // ⚠ not-a-sales-call excluded (aggregate). `.not(col,'is',true)`, never
      // `.eq(col,false)` — nullable column; see test/not-a-sales-call.test.js.
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var callIds = (cq.data || []).map(function (c) { return c.id; });

    var aq = callIds.length ? await admin.from('call_analyses')
      .select('fathom_call_id, outcome, prospect_name, prospect_name_source, prospect_name_confidence, eod_summary, overall_summary')
      .in('fathom_call_id', callIds) : { data: [] };
    var anBy = {}; ((aq && aq.data) || []).forEach(function (a) { anBy[a.fathom_call_id] = a; });

    (cq.data || []).forEach(function (c) {
      var p = byId[c.prospect_id];
      if (!p) return;
      var a = anBy[c.id] || {};
      var prose = (a.eod_summary || a.overall_summary || '');
      p.calls.push({
        call_id: c.id,
        title: c.title || null,
        call_date: c.call_date || null,
        recording_url: c.recording_url || null,
        outcome: a.outcome || null,
        observed_name: a.prospect_name || null,
        name_source: a.prospect_name_source || null,       // 3a stored these;
        name_confidence: a.prospect_name_confidence || null, // this is where they finally matter
        prose_opening: prose ? String(prose).slice(0, 160) : null,
      });
    });
    prospects.forEach(function (p) {
      p.calls.sort(function (x, y) { return String(x.call_date || '').localeCompare(String(y.call_date || '')); });
    });

    return res.json({ candidates: generateCandidates(prospects) });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] merge-candidates error:', err.message);
    return res.status(500).json({ error: 'Could not load merge candidates' });
  }
});

// POST /me/prospects/merge {from_id, into_id} — apply a confirmed merge.
// Reversible and audited: the losing row is POINTED via merged_into, never
// rewritten or deleted, so an incorrect merge can always be undone.
/**
 * ⚠⚠ MARK / UN-MARK A CALL AS "NOT A SALES CALL" (Justin's ruling 2026-08-20).
 *
 * ⚠ THE PERMISSION IS ENFORCED HERE, SERVER-SIDE. Hiding a button is not a
 * permission check — a closer must be REFUSED BY THE API when they attempt a
 * call that is not theirs, not merely unable to find the control.
 *
 * ⚠ canMarkNotSalesCall, NOT canTagOutcome. The latter refuses a MANAGED REP on
 * their own call because setting an outcome is inflatable; marking a call
 * not-a-sales-call REMOVES it from the rep's own numbers and cannot flatter
 * them, and Justin ruled a closer may mark their own. Reusing canTagOutcome
 * would have blocked the exact case this feature exists for.
 *
 * ⚠ THE BODY CARRIES true OR false, NEVER null-to-unset. Un-marking writes
 * FALSE ("assessed, and it IS a sales call"), which is a different state from
 * NULL ("never assessed"). Collapsing them would lose the record that a human
 * looked at this call and said it counts.
 */
router.post('/calls/:id/not-a-sales-call', requireAuth, async function (req, res) {
  var callId = req.params.id;
  var marked = req.body && req.body.not_a_sales_call;
  if (marked !== true && marked !== false) {
    return res.status(400).json({ error: 'not_a_sales_call must be true or false' });
  }
  try {
    var admin = getAdminClient();
    var cq = await admin.from('fathom_calls')
      .select('id, user_id, not_a_sales_call')
      .eq('id', callId).maybeSingle();
    if (cq.error) throw new Error('call lookup: ' + cq.error.message);
    if (!cq.data) return res.status(404).json({ error: 'Call not found' });

    var ownerId = cq.data.user_id;
    var profs = await admin.from('user_profiles')
      .select('user_id, role, managed_by').in('user_id', [ownerId, req.user.id]);
    var rows = (profs.data || []);
    var ownerProfile = rows.filter(function (p) { return p.user_id === ownerId; })[0]
      || { user_id: ownerId, managed_by: null };
    var actorRow = rows.filter(function (p) { return p.user_id === req.user.id; })[0];
    var actorRole = (actorRow && actorRow.role) || req.userProfileRole || 'user';
    var actor = { id: req.user.id, role: actorRole };

    if (!canMarkNotSalesCall(actor, ownerProfile)) {
      console.warn('[me] not-a-sales-call denied: actor=%s call=%s owner=%s', req.user.id, callId, ownerId);
      return res.status(403).json({ error: 'You are not allowed to mark this call' });
    }

    /* exclusion_reason IS CLEARED ON EVERY HUMAN MARK, in both directions.
       Un-marking a COMPROMISED FILE has to remove the reason or the call comes
       back into the numbers still wearing the "compromised file" badge — the
       flag and the label would disagree on screen. And a person marking a call
       not-a-sales-call is a different reason from the automatic one, so leaving
       a stale 'compromised_file' there would mislabel their decision too.
       Writing the human's id into not_sales_marked_by is what makes the
       override durable: the worker reads exactly that to know a person has
       spoken, and skips re-detecting the call on the re-analysis below. */
    var up = await admin.from('fathom_calls').update({
      not_a_sales_call:      marked,
      exclusion_reason:      null,
      not_sales_marked_by:   req.user.id,
      not_sales_marked_at:   new Date().toISOString(),
      not_sales_marked_role: markRoleFor(actor, ownerProfile),
    }).eq('id', callId).select('id, not_a_sales_call, not_sales_marked_role').single();
    if (up.error) throw new Error('update: ' + up.error.message);

    /* ⚠ RE-ANALYSIS ON TOGGLE is fire-and-forget and MUST NOT gate the response.
       The mark itself is already durable; making the user wait on a Claude run
       would make a working button look dead, and a failed re-analysis must never
       roll back a successful mark. */
    try {
      var worker = require('../lib/analysis-worker');
      if (worker && typeof worker.analyzeCall === 'function') {
        Promise.resolve(worker.analyzeCall(callId, ownerId)).catch(function (e) {
          console.warn('[me] not-a-sales-call re-analysis failed (non-fatal):', e && e.message);
        });
      }
    } catch (e) { /* never block the mark */ }

    return res.json({ ok: true, not_a_sales_call: up.data.not_a_sales_call,
                      marked_role: up.data.not_sales_marked_role });
  } catch (err) {
    console.error('[me] not-a-sales-call error:', err && err.message);
    return res.status(500).json({ error: 'Could not update the call' });
  }
});

router.post('/prospects/merge', requireAuth, async function (req, res) {
  var fromId = req.body && req.body.from_id;
  var intoId = req.body && req.body.into_id;
  if (!fromId || !intoId || fromId === intoId) {
    return res.status(400).json({ error: 'from_id and into_id required and must differ' });
  }
  try {
    var admin = getAdminClient();
    var rows = await admin.from('prospects').select('id, user_id, merged_into').in('id', [fromId, intoId]);
    if (rows.error) throw new Error(rows.error.message);
    if (!rows.data || rows.data.length !== 2) return res.status(404).json({ error: 'Prospect not found' });
    // Ownership: both must belong to the caller (or a rep they may act for).
    for (var i = 0; i < rows.data.length; i++) {
      if (rows.data[i].user_id !== req.user.id) return res.status(403).json({ error: 'Not your prospect' });
    }
    var target = rows.data.filter(function (r) { return r.id === intoId; })[0];
    if (target && target.merged_into) {
      return res.status(400).json({ error: 'Target prospect is itself merged — merge into the survivor instead' });
    }

    await admin.from('fathom_calls').update({ prospect_id: intoId }).eq('prospect_id', fromId);
    var up = await admin.from('prospects').update({
      merged_into: intoId, merged_at: new Date().toISOString(), merged_by: req.user.id,
    }).eq('id', fromId);
    if (up.error) throw new Error(up.error.message);

    console.log('[me] prospect merged: actor=%s from=%s into=%s', req.user.email, fromId, intoId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[me] prospect merge error:', err.message);
    return res.status(500).json({ error: 'Merge failed' });
  }
});

// POST /me/prospects/unmerge {id} — undo. The reason merges are safe to make.
router.post('/prospects/unmerge', requireAuth, async function (req, res) {
  var id = req.body && req.body.id;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    var admin = getAdminClient();
    var row = await admin.from('prospects').select('id, user_id, merged_into').eq('id', id).maybeSingle();
    if (row.error || !row.data) return res.status(404).json({ error: 'Prospect not found' });
    if (row.data.user_id !== req.user.id) return res.status(403).json({ error: 'Not your prospect' });
    if (!row.data.merged_into) return res.status(400).json({ error: 'Prospect is not merged' });

    // Re-point only the calls whose OBSERVED name still keys to this prospect,
    // so undoing one merge cannot steal calls that belonged to the survivor.
    var back = await admin.from('prospects').select('name_key').eq('id', id).maybeSingle();
    var key = back.data ? back.data.name_key : null;
    if (key) {
      var cand = await admin.from('fathom_calls').select('id').eq('prospect_id', row.data.merged_into);
      var ids = (cand.data || []).map(function (c) { return c.id; });
      if (ids.length) {
        var ans = await admin.from('call_analyses').select('fathom_call_id, prospect_name').in('fathom_call_id', ids);
        var moveBack = ((ans && ans.data) || []).filter(function (a) { return nameKey(a.prospect_name) === key; })
          .map(function (a) { return a.fathom_call_id; });
        if (moveBack.length) await admin.from('fathom_calls').update({ prospect_id: id }).in('id', moveBack);
      }
    }
    await admin.from('prospects').update({ merged_into: null, merged_at: null, merged_by: null }).eq('id', id);
    console.log('[me] prospect unmerged: actor=%s id=%s', req.user.email, id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[me] prospect unmerge error:', err.message);
    return res.status(500).json({ error: 'Unmerge failed' });
  }
});


// ── SECTION DRILLDOWN (stage 4a/4b) ──────────────────────────────────────
// Clicking a Coach-summary bar opens ONE section across the selected period:
// the moments that earned the score, plus how to improve, drawn from calls that
// went well. Shared by /me/sections/:section and the /admin pivot mirror.
//
// Close reads close_score_earned throughout — see lib/section-breakdown.js.
async function computeSectionBreakdown(admin, userId, section, from, to) {
  var calls = await admin.from('fathom_calls')
    .select('id, title, call_date, recording_url, prospect_id, source')
    .eq('user_id', userId).gte('call_date', from).lte('call_date', to)
    .not('not_a_sales_call', 'is', true)
    .is('duplicate_of', null);
  if (calls.error) throw new Error('fathom_calls: ' + calls.error.message);
  var callIds = (calls.data || []).map(function (c) { return c.id; });
  if (!callIds.length) return buildSectionBreakdown(section, { analyses: [], highlights: [], callMeta: {} });

  var cols = 'fathom_call_id, prospect_name, intro_score, discovery_score, pitch_score, objection_score, close_score, close_score_earned, '
    + 'intro_notes, discovery_notes, pitch_notes, objection_notes, close_notes';
  var an = await admin.from('call_analyses').select(cols).in('fathom_call_id', callIds).eq('status', 'done');
  if (an.error) throw new Error('call_analyses: ' + an.error.message);

  var hl = await admin.from('call_highlights')
    .select('id, fathom_call_id, section, type, resolution, speaker, quote, observation, timestamp_seconds, speaker_verified, closer_response, closer_response_verified')
    .in('fathom_call_id', callIds).eq('section', section);
  if (hl.error) throw new Error('call_highlights: ' + hl.error.message);

  // Prospect name comes from the analysis row (3a); fall back to nothing rather
  // than the meeting title, which is the booked name and often the wrong person.
  var nameBy = {};
  (an.data || []).forEach(function (a) { if (a.prospect_name) nameBy[a.fathom_call_id] = a.prospect_name; });
  var meta = {};
  (calls.data || []).forEach(function (c) {
    meta[c.id] = { prospect_name: nameBy[c.id] || null, recording_url: c.recording_url || null, call_date: c.call_date || null };
  });

  var out = buildSectionBreakdown(section, { analyses: an.data || [], highlights: hl.data || [], callMeta: meta });

  // Rank among the five, computed on the SAME earned-close basis.
  var averages = {};
  SECTIONS.forEach(function (sec) {
    var vals = (an.data || []).map(function (a) { return sectionScoreOf(a, sec); }).filter(function (v) { return typeof v === 'number'; });
    averages[sec] = vals.length ? Math.round(vals.reduce(function (x, y) { return x + y; }, 0) / vals.length) : null;
  });
  // Worst-first, matching the needs-work card that links here. `rank_label` is
  // rendered instead of a bare number because "ranked 3 of 5" never said which
  // end was good.
  var ranked = SR.rankSections(SR.sectionStatsFromAnalyses(an.data || []));
  var mine = ranked.filter(function (x) { return x.section === section; })[0] || {};
  out.rank = mine.rank || null;
  out.rank_label = mine.rank ? SR.rankLabel(mine.rank, ranked.filter(function (x) { return x.enough; }).length) : null;
  out.section_count = SECTIONS.length;

  // Prior-window delta, reusing the team view's window machinery so the trend
  // means the same thing here as it does on the glance tiles.
  try {
    var span = new Date(to).getTime() - new Date(from).getTime();
    var prevFrom = new Date(new Date(from).getTime() - span).toISOString();
    var prev = await admin.from('fathom_calls').select('id').eq('user_id', userId).gte('call_date', prevFrom).lt('call_date', from)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null);
    var prevIds = (prev.data || []).map(function (c) { return c.id; });
    if (prevIds.length) {
      var pa = await admin.from('call_analyses').select(cols).in('fathom_call_id', prevIds).eq('status', 'done');
      var pv = (pa.data || []).map(function (a) { return sectionScoreOf(a, section); }).filter(function (v) { return typeof v === 'number'; });
      out.prior_average = pv.length ? Math.round(pv.reduce(function (x, y) { return x + y; }, 0) / pv.length) : null;
    } else out.prior_average = null;
  } catch (e) { out.prior_average = null; }

  /* REMOVED 2026-08-18 — the saved-to-KB badge went with the Add-to-KB buttons
   * (Justin's ruling; see dashboard.html addSectionMomentToKb for the reasoning,
   * the 313-manual-vs-0 measurement, and the manager→team consequence).
   * Nothing renders saved_to_kb any more, so this is a per-request query whose
   * answer has no consumer — a row a rep auto-harvested still gets harvested,
   * they just don't see a badge saying so.
   *
   * // 4b: mark moments already saved to the closer's KB. Exact match on
   * // source_section + quote hash — NO similarity search, which is why the
   * // queued /kb/upload embedding issue is not load-bearing here.
   * try {
   *   var saved = await admin.from('knowledge_base')
   *     .select('source_quote_hash').eq('uploaded_by', userId).eq('source_section', section)
   *     .not('source_quote_hash', 'is', null);
   *   var have = {};
   *   ((saved && saved.data) || []).forEach(function (r) { have[r.source_quote_hash] = true; });
   *   var mark = function (m) { m.saved_to_kb = !!have[quoteHash(m.quote)]; };
   *   out.good.forEach(mark); out.bad.forEach(mark);
   * } catch (e) { }
   */

  return out;
}


// GET /me/sections/:section?from=&to= — the caller's own section drilldown.
/**
 * 12b — "which part of the sales process needs work", for the REP PAGE.
 *
 * Five section cards, worst first. Reuses buildSectionBreakdown per section
 * rather than introducing a second moment-selection rule — the evidence a card
 * shows must be the same evidence the drilldown shows when you click it.
 *
 * ⚠ THE WHY LINE ONLY EXISTS WHERE A COUNTED CAUSE DOES. Today that is discovery
 * alone, via what_mattered. Justin's ruling: never manufacture a thinner reason
 * to fill the slot. Card 1 being richer than cards 2-5 is BY DESIGN.
 */
async function computeNeedsWorkSections(admin, userId, from, to) {
  var calls = await admin.from('fathom_calls')
    // `source` rides along so the clip button can be labelled per provider:
    // Fathom's ?t= seeks, Zoom's does not. See lib/clip-link.js.
    .select('id, title, call_date, recording_url, source').eq('user_id', userId)
    .gte('call_date', from).lte('call_date', to)
    // ⚠ not-a-sales-call excluded. RECLASSIFIED: this is computeNeedsWorkSections,
    // a window AGGREGATE -- an earlier pass listed it as a call LIST and would have
    // left it unfiltered.
    .not('not_a_sales_call', 'is', true)
    .is('duplicate_of', null);
  if (calls.error) throw new Error('fathom_calls: ' + calls.error.message);
  var callIds = (calls.data || []).map(function (c) { return c.id; });
  if (!callIds.length) return { sections: SR.rankSections({}), why: null };

  var cols = 'fathom_call_id, prospect_name, what_mattered, intro_score, discovery_score, pitch_score, '
    + 'objection_score, close_score_earned, intro_notes, discovery_notes, pitch_notes, objection_notes, close_notes';
  var analyses = [], highlights = [];
  for (var i = 0; i < callIds.length; i += 100) {
    var slice = callIds.slice(i, i + 100);
    var an = await admin.from('call_analyses').select(cols).in('fathom_call_id', slice).eq('status', 'done');
    if (an.error) throw new Error('call_analyses: ' + an.error.message);
    analyses = analyses.concat(an.data || []);
    var hl = await admin.from('call_highlights')
      .select('id, fathom_call_id, section, type, resolution, speaker, quote, observation, timestamp_seconds, speaker_verified, closer_response, closer_response_verified')
      .in('fathom_call_id', slice).not('section', 'is', null);
    if (hl.error) throw new Error('call_highlights: ' + hl.error.message);
    highlights = highlights.concat(hl.data || []);
  }

  var nameBy = {};
  analyses.forEach(function (a) { if (a.prospect_name) nameBy[a.fathom_call_id] = a.prospect_name; });
  var meta = {};
  (calls.data || []).forEach(function (c) {
    meta[c.id] = { prospect_name: nameBy[c.id] || null, recording_url: c.recording_url || null,
                   call_date: c.call_date || null, source: c.source || null };
  });

  var ranked = SR.rankSections(SR.sectionStatsFromAnalyses(analyses));
  var rankedCount = ranked.filter(function (x) { return x.enough; }).length;

  ranked.forEach(function (entry) {
    entry.rank_label = entry.rank ? SR.rankLabel(entry.rank, rankedCount) : null;
    entry.moments = [];
    if (!entry.enough) return;
    var secHl = highlights.filter(function (h) { return h && h.section === entry.section; });
    var bd = buildSectionBreakdown(entry.section, { analyses: analyses, highlights: secHl, callMeta: meta });
    // "What to fix" moments — the card is about what needs work. Newest first,
    // capped at three, and only rows carrying an actual quote.
    entry.moments = (bd.bad || []).filter(function (m) { return m && m.quote; }).slice(0, 3)
      .map(function (m) {
        return { quote: m.quote, observation: m.observation || null, call_id: m.fathom_call_id,
          call_date: m.call_date || null, prospect_name: m.prospect_name || null,
          clip_url: m.clip_url || null, speaker_verified: m.speaker_verified === true,
          // ⚠ The LABEL depends on the provider, not just on having a link.
          source: (meta[m.fathom_call_id] || {}).source || null };
      });
  });

  // ⚠ The WHY line is COUNTED, never inferred — the same rule as the manager
  // card. computeWhyFacts returns tier 2 only when one area dominates with
  // volume; on every other section it returns nothing and the line disappears.
  var wm = analyses.map(function (a) { return a.what_mattered; }).filter(Boolean);
  var discovery = ranked.filter(function (x) { return x.section === 'discovery'; })[0];
  var why = null;
  if (discovery && discovery.enough) {
    var facts = computeWhyFacts({ display_name: '', weakest_section: { section: 'discovery', score: discovery.score } }, wm);
    if (facts && facts.tier === 2 && facts.cause) {
      why = { section: 'discovery', area: facts.cause.area, count: facts.cause.count,
              denominator: facts.cause.denominator, share: facts.cause.share };
    }
  }
  return { from: from, to: to, sections: ranked, why: why };
}

router.get('/needs-work-sections', requireAuth, async function (req, res) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  try {
    return res.json(await computeNeedsWorkSections(getAdminClient(), req.user.id, from, to));
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] needs-work sections error:', err.message);
    return res.status(500).json({ error: 'Could not load the section ranking' });
  }
});

router.get('/sections/:section', requireAuth, async function (req, res) {
  var section = req.params.section;
  if (SECTIONS.indexOf(section) === -1) return res.status(400).json({ error: 'unknown section' });
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  try {
    var admin = getAdminClient();
    return res.json(await computeSectionBreakdown(admin, req.user.id, section, from, to));
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] section drilldown error:', err.message);
    return res.status(500).json({ error: 'Could not load section' });
  }
});

module.exports = router;
// pure helpers exported for tests (log.js:_validateLogBatch pattern)
module.exports._validateNameField = validateNameField;
module.exports._computeSectionBreakdown = computeSectionBreakdown;
module.exports._computeNeedsWorkSections = computeNeedsWorkSections;
module.exports._buildAccountPayload = buildAccountPayload;
/* ⚠ TEST-ONLY INJECTION POINT. The permission boundary has to be exercised
   OVER HTTP through the real handler -- a predicate proven in isolation is not
   an API boundary -- and every session available to this project belongs to an
   owner, so a plain-user token cannot be obtained without entering a password.
   Forging req.user ahead of the router plus swapping the admin client is the
   correct substitute: it exercises every line of the handler except the token
   decode, which is requireAuth's job and is covered elsewhere.
   ⚠ Sets the module-local _admin, so production behaviour is untouched. */
module.exports._setAdminClientForTests = function (factory) { _admin = factory(); };

