const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, requireSubscription } = require('../middleware/auth');
const { CLAUDE_MODEL, CLAUDE_SUGGESTION_MODEL } = require('../config');
const { formatUpstreamError } = require('../lib/format-error');

var router = express.Router();

// formatProxyError was inlined here in v1.0.5; moved to backend/lib/format-error.js
// in v1.0.6 so /log/* can reuse it. Aliased as formatProxyError for diff clarity
// in this file — behavior is identical.
var formatProxyError = formatUpstreamError;

// Throws a helpful error if any required Railway env vars are missing. Lists
// exactly which ones by name so operators don't have to guess which variable
// they forgot to set. Keeps the phrase "not configured" so handleConfigError
// below can match on it and return 503.
function requireEnvVars(serviceName, requiredVars) {
  var missing = requiredVars.filter(function(name) { return !process.env[name]; });
  if (missing.length > 0) {
    throw new Error(serviceName + ' not configured — missing: ' + missing.join(', ') + ' (set in Railway Variables).');
  }
}

// Lazy Anthropic client — only created on first /suggest or /memory request.
// Prevents crash on startup when ANTHROPIC_API_KEY is not yet set.
var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  requireEnvVars('Anthropic', ['ANTHROPIC_API_KEY']);
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Validates Deepgram env vars just before use — same lazy pattern but there's
// no client instance to cache, we just need the env values present.
function getDeepgramConfig() {
  requireEnvVars('Deepgram', ['DEEPGRAM_API_KEY', 'DEEPGRAM_PROJECT_ID']);
  return {
    apiKey: process.env.DEEPGRAM_API_KEY,
    projectId: process.env.DEEPGRAM_PROJECT_ID,
  };
}

// Wraps a route handler so a getAnthropic()/getDeepgramConfig() throw becomes 503.
function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[proxy] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

// Both routes require a valid login AND an active subscription
var protect = [requireAuth, requireSubscription];

// Claude suggestion proxy — Electron app sends transcript + context,
// backend calls Claude with server-side API key, returns suggestion.
router.post('/suggest', protect, async function(req, res) {
  var { systemPrompt, userPrompt, maxTokens } = req.body;

  if (!systemPrompt || !userPrompt) {
    return res.status(400).json({ error: 'systemPrompt and userPrompt required' });
  }

  try {
    console.log('[proxy] Claude request for user:', req.user.id);

    var anthropic = getAnthropic();
    var response = await anthropic.messages.create({
      // v1.0.7: Haiku for live teleprompter — see backend/config.js for rationale.
      // Memory summaries still use CLAUDE_MODEL (Sonnet) for nuance.
      model: CLAUDE_SUGGESTION_MODEL,
      max_tokens: maxTokens || 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    var content = response.content[0] ? response.content[0].text : null;
    if (!content) {
      return res.status(500).json({ error: 'No response from Claude' });
    }

    // v1.0.7-alpha: expose usage (input_tokens/output_tokens) for timing
    // instrumentation. Strictly additive — existing clients ignore unknown fields.
    res.json({ content: content, usage: response.usage || null });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    var f = formatProxyError(err, 'Claude');
    console.error('[proxy] Claude error:', f.status, f.body.error);
    res.status(f.status).json(f.body);
  }
});

// Memory summary proxy — same pattern as suggest but for call memory updates
router.post('/memory', protect, async function(req, res) {
  var { userPrompt, maxTokens } = req.body;

  if (!userPrompt) {
    return res.status(400).json({ error: 'userPrompt required' });
  }

  try {
    var anthropic = getAnthropic();
    var response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens || 500,
      messages: [{ role: 'user', content: userPrompt }],
    });

    var content = response.content[0] ? response.content[0].text : null;
    if (!content) {
      return res.status(500).json({ error: 'No response from Claude' });
    }

    res.json({ content: content });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    var f = formatProxyError(err, 'Memory');
    console.error('[proxy] Memory error:', f.status, f.body.error);
    res.status(f.status).json(f.body);
  }
});

// Deepgram temporary key — Electron app requests a short-lived key,
// connects directly to Deepgram WebSocket with it (no proxying of audio needed).
router.post('/deepgram-key', protect, async function(req, res) {
  try {
    console.log('[proxy] Deepgram key request for user:', req.user.id);

    var dg = getDeepgramConfig();

    // Create a temporary Deepgram API key that expires in 10 minutes
    var response = await fetch('https://api.deepgram.com/v1/projects/' + dg.projectId + '/keys', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + dg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'Temp key for user ' + req.user.id,
        scopes: ['usage:write'],
        time_to_live_in_seconds: 600, // 10 minutes
      }),
    });

    if (!response.ok) {
      throw new Error('Deepgram key creation failed: ' + response.status);
    }

    var data = await response.json();
    res.json({ key: data.key });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    var f = formatProxyError(err, 'Deepgram key');
    console.error('[proxy] Deepgram key error:', f.status, f.body.error);
    res.status(f.status).json(f.body);
  }
});

module.exports = router;
