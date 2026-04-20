const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, requireSubscription } = require('../middleware/auth');

var router = express.Router();
var anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    console.error('[proxy] Memory error:', err.message);
    res.status(500).json({ error: 'Memory API call failed' });
  }
});

// Deepgram temporary key — Electron app requests a short-lived key,
// connects directly to Deepgram WebSocket with it (no proxying of audio needed).
router.post('/deepgram-key', protect, async function(req, res) {
  try {
    console.log('[proxy] Deepgram key request for user:', req.user.id);

    // Create a temporary Deepgram API key that expires in 10 minutes
    var response = await fetch('https://api.deepgram.com/v1/projects/' + process.env.DEEPGRAM_PROJECT_ID + '/keys', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + process.env.DEEPGRAM_API_KEY,
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
    console.error('[proxy] Deepgram key error:', err.message);
    res.status(500).json({ error: 'Failed to create Deepgram key' });
  }
});

module.exports = router;
