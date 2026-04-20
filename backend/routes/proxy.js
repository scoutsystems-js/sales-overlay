const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, requireSubscription } = require('../middleware/auth');

var router = express.Router();

// Lazy Anthropic client — only created on first /suggest or /memory request.
// Prevents crash on startup when ANTHROPIC_API_KEY is not yet set.
var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic not configured — set ANTHROPIC_API_KEY in Railway Variables.');
  }
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Validates Deepgram env vars just before use — same lazy pattern but there's
// no client instance to cache, we just need the env values present.
function getDeepgramConfig() {
  if (!process.env.DEEPGRAM_API_KEY || !process.env.DEEPGRAM_PROJECT_ID) {
    throw new Error('Deepgram not configured — set DEEPGRAM_API_KEY and DEEPGRAM_PROJECT_ID in Railway Variables.');
  }
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    var content = response.content[0] ? response.content[0].text : null;
    if (!content) {
      return res.status(500).json({ error: 'No response from Claude' });
    }

    res.json({ content: content });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[proxy] Claude error:', err.message);
    res.status(500).json({ error: 'Claude API call failed' });
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
      model: 'claude-sonnet-4-20250514',
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
    console.error('[proxy] Memory error:', err.message);
    res.status(500).json({ error: 'Memory API call failed' });
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
    console.error('[proxy] Deepgram key error:', err.message);
    res.status(500).json({ error: 'Failed to create Deepgram key' });
  }
});

module.exports = router;
