const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');
const { CLAUDE_MODEL } = require('../config');
const { computeAnalytics, loadSessionObjections } = require('../lib/session-analytics');

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
router.get('/sessions', requireAuth, async function(req, res) {
  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  var before = req.query.before;

  try {
    var admin = getAdminClient();
    var q = admin
      .from('call_sessions')
      .select('session_id, user_id, started_at, ended_at, outcome, client_version, platform')
      .eq('user_id', req.user.id)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('started_at', before);

    var sessionsResult = await q;
    if (sessionsResult.error) {
      console.error('[me] sessions query failed:', sessionsResult.error.message);
      return res.status(500).json({ error: 'Could not fetch sessions' });
    }
    var sessions = sessionsResult.data || [];
    if (sessions.length === 0) return res.json({ sessions: [] });

    var sessionIds = sessions.map(function(s) { return s.session_id; });
    var logsResult = await admin
      .from('session_logs')
      .select('session_id, level')
      .in('session_id', sessionIds);
    if (logsResult.error) {
      // Non-fatal — render with zero counts.
      console.error('[me] counts query failed:', logsResult.error.message);
    }
    var countsMap = computeCountsBySession(logsResult.data || []);

    var enriched = sessions.map(function(s) {
      var c = countsMap[s.session_id] || { log_count: 0, error_count: 0 };
      return {
        session_id: s.session_id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        duration_seconds: computeDurationSeconds(s.started_at, s.ended_at),
        client_version: s.client_version,
        platform: s.platform,
        outcome: s.outcome,
        log_count: c.log_count,
        error_count: c.error_count,
      };
    });

    res.json({ sessions: enriched });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] sessions error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// ── GET /me/sessions/:session_id/logs ───────────────────────────────────────
// Caller's own session logs. Ownership check: 404 if the session doesn't
// belong to req.user.id — prevents an authenticated user from iterating
// UUIDs to snoop on other users' logs. 404 rather than 403 to avoid
// leaking session-id validity.
router.get('/sessions/:session_id/logs', requireAuth, async function(req, res) {
  var sessionId = req.params.session_id;
  var limit = parseInt(req.query.limit, 10);
  if (!limit || limit < 1) limit = LOG_HARD_CAP;
  if (limit > LOG_HARD_CAP) limit = LOG_HARD_CAP;

  try {
    var admin = getAdminClient();
    var sessionResult = await admin
      .from('call_sessions')
      .select('session_id, user_id, started_at, ended_at, outcome, client_version, platform')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (sessionResult.error) {
      console.error('[me] session fetch failed:', sessionResult.error.message);
      return res.status(500).json({ error: 'Could not load session' });
    }
    if (!sessionResult.data) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (sessionResult.data.user_id !== req.user.id) {
      console.warn('[me] Scope violation: actor=%s attempted_session=%s owner=%s',
        req.user.id, sessionId, sessionResult.data.user_id);
      return res.status(404).json({ error: 'Session not found' });
    }
    var session = sessionResult.data;

    var logsResult = await admin
      .from('session_logs')
      .select('logged_at, level, tag, message', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('logged_at', { ascending: true })
      .limit(limit);
    if (logsResult.error) {
      console.error('[me] logs fetch failed:', logsResult.error.message);
      return res.status(500).json({ error: 'Could not load logs' });
    }

    res.json({
      session: {
        session_id: session.session_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        duration_seconds: computeDurationSeconds(session.started_at, session.ended_at),
        outcome: session.outcome,
        client_version: session.client_version,
        platform: session.platform,
      },
      logs: logsResult.data || [],
      total_count: typeof logsResult.count === 'number' ? logsResult.count : (logsResult.data || []).length,
      limit: limit,
    });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] logs error:', err.message);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

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
// to objection_id + framework. Source of truth: src/ai/objections.js. Hardcoded
// here to avoid cross-folder import — keep in sync manually if objections.js changes.
var OBJECTION_LABEL_MAP = {
  'Money Objection':              { id: 'money',          framework: 'money'  },
  'Talk to My Wife':              { id: 'talk-to-spouse', framework: 'spouse' },
  'I Need to Think About It':     { id: 'think-about-it', framework: 'think'  },
  'No Time':                      { id: 'no-time',        framework: 'time'   },
  'Tried Programs Before':        { id: 'tried-before',   framework: null     },
  'Send Me Information':          { id: 'send-info',      framework: null     },
  'What is the Guarantee':        { id: 'guarantee',      framework: null     },
  'Need to Do More Research':     { id: 'more-research',  framework: null     },
  'Not the Right Time':           { id: 'not-right-time', framework: null     },
  'How Do I Know It Will Work':   { id: 'proof-it-works', framework: null     },
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
    var session = await loadOwnedSession(admin, sessionId, req.user.id, 'session_id, user_id');
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
      // The actual transcript turns are under tag '[deepgram]' with the
      // shape '[deepgram] Transcript (final) [PROSPECT|CLOSER]: <text>'.
      // The '[memory]' tag (which I initially thought held the transcript)
      // is actually CallMemory's internal logs — useless for classification.
      // Empty windows in the first backfill pass were ALL due to this tag
      // confusion plus a separate 1000-row pagination bug, both now fixed.
      var transcriptRows = windowRows.filter(function(l) {
        return l.tag === '[deepgram]' && l.message && l.message.indexOf('Transcript (final)') !== -1;
      });
      // Fall back to all window rows ONLY if Deepgram is genuinely sparse
      // — better to give Claude noisy context than nothing at all.
      var sourceRows = transcriptRows.length >= 3 ? transcriptRows : windowRows;
      var windowTurns = sourceRows.map(function(l) { return l.message; }).join('\n').slice(0, 8000);  // cap context length

      var classifyPrompt =
        'A "' + label + '" was detected in a sales call. Below is the ±90 seconds of ' +
        'call activity around it. Did the closer overcome this objection?\n\n' +
        '"Overcome" means the prospect moved past the objection — committed, asked the ' +
        'next question, or agreed to continue. "Not overcome" means the objection ended ' +
        'the conversation or the prospect doubled down on it.\n\n' +
        'Respond with ONLY a JSON object on a single line:\n' +
        '{"overcome":true|false|null,"confidence":"high|medium|low","notes":"<short rationale, max 150 chars>"}\n\n' +
        'Use null for overcome when the window is ambiguous or too short to tell.\n\n' +
        'CALL WINDOW:\n' + windowTurns;

      try {
        var resp = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 200,
          messages: [{ role: 'user', content: classifyPrompt }],
        });
        var rawText = resp.content[0] ? resp.content[0].text : '';
        var parsed = extractFirstJsonObject(rawText);
        if (!parsed) {
          console.warn('[me] classify parse failed for ' + label + ' — recording as null:', rawText.slice(0, 100));
          parsed = { overcome: null, confidence: 'low', notes: 'classifier output unparseable' };
        }
        rowsToInsert.push({
          session_id: sessionId,
          user_id: req.user.id,
          detected_at: match.logged_at,
          objection_id: typeInfo.id,
          objection_label: label,
          framework: typeInfo.framework,
          overcome: typeof parsed.overcome === 'boolean' ? parsed.overcome : null,
          overcome_confidence: ['high', 'medium', 'low'].indexOf(parsed.confidence) !== -1 ? parsed.confidence : null,
          notes: parsed.notes ? String(parsed.notes).slice(0, 200) : null,
        });
      } catch (classifyErr) {
        console.warn('[me] classify call failed for ' + label + ':', classifyErr.message);
        // Record the objection event even if classification failed — better
        // to have the event with null overcome than to silently drop it.
        rowsToInsert.push({
          session_id: sessionId,
          user_id: req.user.id,
          detected_at: match.logged_at,
          objection_id: typeInfo.id,
          objection_label: label,
          framework: typeInfo.framework,
          overcome: null,
          overcome_confidence: null,
          notes: 'classifier error: ' + (classifyErr.message || 'unknown').slice(0, 150),
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
router.get('/analytics', requireAuth, async function(req, res) {
  var to = req.query.to || new Date().toISOString();
  var from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO 8601 dates' });
  }
  try {
    var result = await computeAnalytics(getAdminClient(), req.user.id, from, to);
    res.json(result);
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] analytics error:', err.message);
    res.status(500).json({ error: 'Failed to load analytics: ' + (err.message || 'unknown') });
  }
});

// ── GET /me/sessions/:session_id/objections ─────────────────────────────────
// Per-session objection drill — for the dashboard's expanded card view.
// Ownership-checked (404 on cross-user). Admin equivalent lives in admin.js.
router.get('/sessions/:session_id/objections', requireAuth, async function(req, res) {
  var sessionId = req.params.session_id;
  try {
    var admin = getAdminClient();
    var session = await loadOwnedSession(admin, sessionId, req.user.id, 'session_id, user_id');
    if (!session) return res.status(404).json({ error: 'Session not found' });
    var rows = await loadSessionObjections(admin, sessionId);
    res.json({ session_id: sessionId, objections: rows });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[me] session-objections error:', err.message);
    res.status(500).json({ error: 'Failed to load objections' });
  }
});

router._computeCountsBySession = computeCountsBySession;
router._computeDurationSeconds = computeDurationSeconds;
router._extractLabelFromMatchMessage = extractLabelFromMatchMessage;
router._OBJECTION_LABEL_MAP = OBJECTION_LABEL_MAP;

module.exports = router;
