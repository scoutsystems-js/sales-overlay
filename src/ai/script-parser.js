// Parses uploaded sales scripts into structured knowledge base entries.
// Handles a variety of formats: phase headers, numbered sections, dialogue blocks.

var Anthropic = require('@anthropic-ai/sdk');

class ScriptParser {
  constructor(anthropicKey) {
    this.client = new Anthropic({ apiKey: anthropicKey });
  }

  // Use Claude to parse a raw script into structured KB entries
  async parseScript(scriptText, clientName) {
    console.log('[parser] Parsing script for client: ' + clientName);
    console.log('[parser] Script length: ' + scriptText.length + ' chars');

    try {
      var response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: 'You are a sales script parser. Parse this sales script into structured entries for a coaching knowledge base.\n\n'
            + 'For each distinct section (phase, track, objection, technique, story, etc.), create an entry with:\n'
            + '- category: one of "client_stage", "client_discovery", "client_pitch", "client_objection", "client_followup", "client_proof", "member_story", "discovery_technique"\n'
            + '- label: short descriptive label (include client name prefix)\n'
            + '- content: the actual script/coaching content (what to SAY, condensed to key phrases and flow)\n'
            + '- triggers: array of 3-6 short trigger phrases that would indicate this section is relevant during a live call\n'
            + '- stage: which call stage this belongs to (introduction, set, discovery, transition, pitch, close, objection_handling, follow_up)\n'
            + '- phase: phase number if part of a sequence\n'
            + '- phaseLabel: phase name if applicable\n\n'
            + 'IMPORTANT: Condense verbose scripts into actionable coaching prompts. The closer is reading this MID-CALL, so each entry\'s content should be max 200 words of what to actually SAY or DO.\n\n'
            + 'Respond with a JSON array of entries. No explanation outside the JSON.\n\n'
            + 'SCRIPT:\n' + scriptText.substring(0, 12000), // Limit to ~12k chars per API call
        }],
      });

      var content = response.content[0] ? response.content[0].text : null;
      if (!content) {
        console.error('[parser] No content in response');
        return [];
      }

      // Extract JSON from response (handle markdown code blocks)
      var jsonStr = content;
      var jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      var entries = JSON.parse(jsonStr);
      console.log('[parser] Parsed ' + entries.length + ' entries');

      // Tag all entries with the client
      var clientId = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].metadata) entries[i].metadata = {};
        entries[i].metadata.client = clientId;
        if (entries[i].stage) entries[i].metadata.stage = entries[i].stage;
        if (entries[i].phase) entries[i].metadata.phase = entries[i].phase;
        if (entries[i].phaseLabel) entries[i].metadata.phaseLabel = entries[i].phaseLabel;

        // Ensure triggers is an array
        if (!entries[i].triggers) entries[i].triggers = [];
        if (typeof entries[i].triggers === 'string') entries[i].triggers = [entries[i].triggers];
      }

      return entries;
    } catch (err) {
      console.error('[parser] Parse failed:', err.message);

      // Fallback: simple section-based parsing
      return this.fallbackParse(scriptText, clientName);
    }
  }

  // Simple regex-based parser as fallback
  fallbackParse(scriptText, clientName) {
    console.log('[parser] Using fallback parser');
    var clientId = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    var entries = [];

    // Split by common section headers (PHASE, Phase, ##, ---, ===)
    var sections = scriptText.split(/(?=^(?:PHASE|Phase|#{1,3}\s|={3,}|---+|\*{3,}).+)/m);

    for (var i = 0; i < sections.length; i++) {
      var section = sections[i].trim();
      if (section.length < 50) continue; // Skip tiny fragments

      // Extract header
      var headerMatch = section.match(/^(.+?)[\n\r]/);
      var header = headerMatch ? headerMatch[1].replace(/[#=\-*]/g, '').trim() : 'Section ' + (i + 1);

      // Extract key phrases for triggers
      var triggerWords = [];
      var youSayMatches = section.match(/(?:say|ask|tell)[:\s]+"([^"]+)"/gi);
      if (youSayMatches) {
        for (var j = 0; j < Math.min(youSayMatches.length, 4); j++) {
          var phrase = youSayMatches[j].replace(/^(?:say|ask|tell)[:\s]+"/i, '').replace(/"$/, '');
          if (phrase.length > 5 && phrase.length < 60) {
            triggerWords.push(phrase.toLowerCase().substring(0, 50));
          }
        }
      }

      // Detect stage from header
      var stage = 'discovery'; // default
      var headerLower = header.toLowerCase();
      if (headerLower.indexOf('intro') !== -1) stage = 'introduction';
      else if (headerLower.indexOf('set') !== -1 && headerLower.indexOf('asset') === -1) stage = 'set';
      else if (headerLower.indexOf('discover') !== -1 || headerLower.indexOf('spain') !== -1 || headerLower.indexOf('pain') !== -1) stage = 'discovery';
      else if (headerLower.indexOf('transition') !== -1) stage = 'transition';
      else if (headerLower.indexOf('pitch') !== -1 || headerLower.indexOf('pillar') !== -1 || headerLower.indexOf('offer') !== -1) stage = 'pitch';
      else if (headerLower.indexOf('close') !== -1 || headerLower.indexOf('invest') !== -1 || headerLower.indexOf('price') !== -1) stage = 'close';
      else if (headerLower.indexOf('objection') !== -1 || headerLower.indexOf('identity') !== -1) stage = 'objection_handling';
      else if (headerLower.indexOf('follow') !== -1 || headerLower.indexOf('referral') !== -1) stage = 'follow_up';

      // Detect category
      var category = 'client_stage';
      if (headerLower.indexOf('objection') !== -1 || headerLower.indexOf('money') !== -1 || headerLower.indexOf('spouse') !== -1 || headerLower.indexOf('think') !== -1) {
        category = 'client_objection';
      } else if (headerLower.indexOf('story') !== -1 || headerLower.indexOf('member') !== -1 || headerLower.indexOf('testimonial') !== -1) {
        category = 'member_story';
      } else if (headerLower.indexOf('pitch') !== -1 || headerLower.indexOf('pillar') !== -1) {
        category = 'client_pitch';
      } else if (headerLower.indexOf('discover') !== -1 || headerLower.indexOf('question') !== -1 || headerLower.indexOf('spain') !== -1) {
        category = 'client_discovery';
      }

      // Truncate content to key actionable parts
      var content = section.substring(0, 800);

      entries.push({
        category: category,
        label: clientId.toUpperCase() + ' - ' + header.substring(0, 80),
        content: content,
        triggers: triggerWords,
        metadata: {
          client: clientId,
          stage: stage,
          source: 'uploaded',
        },
      });
    }

    console.log('[parser] Fallback parsed ' + entries.length + ' entries');
    return entries;
  }
}

module.exports = ScriptParser;
