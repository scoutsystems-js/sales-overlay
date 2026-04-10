var Anthropic = require('@anthropic-ai/sdk');

// Valid stage progression order — stages can only advance forward (except objection_handling)
var STAGE_ORDER = ['introduction', 'set', 'discovery', 'transition', 'pitch', 'close', 'objection_handling'];

class CallMemory {
  constructor(anthropicKey) {
    this.client = new Anthropic({ apiKey: anthropicKey });
    this.fullTranscript = [];       // Every turn of the call
    this.summary = '';               // Rolling compressed summary
    this.turnsSinceLastSummary = 0;
    this.summaryInterval = 8;        // Summarize every 8 final turns
    this.isSummarizing = false;
    this.detectedStage = 'introduction';   // Current call stage
    this.keyFacts = [];              // Important facts extracted from the call
  }

  // Returns whether newStage is a valid progression from currentStage
  isValidStageProgression(currentStage, newStage) {
    // objection_handling can be entered from any stage
    if (newStage === 'objection_handling') return true;
    // Can return from objection_handling to any stage
    if (currentStage === 'objection_handling') return true;
    // Same stage is always valid
    if (currentStage === newStage) return true;

    var currentIdx = STAGE_ORDER.indexOf(currentStage);
    var newIdx = STAGE_ORDER.indexOf(newStage);

    // Never go backwards (e.g., discovery → introduction)
    if (newIdx < currentIdx) return false;

    // Allow skipping at most 2 stages forward
    // Real calls don't always have a clean "set" phase — closer may flow
    // from introduction straight into discovery, or from discovery into pitch
    var stepsForward = newIdx - currentIdx;
    if (stepsForward <= 2) return true;

    // For bigger jumps (3+), only allow after enough turns have passed
    // (e.g., after 40 turns we shouldn't still be in "introduction")
    var turnCount = this.fullTranscript.length;
    if (turnCount >= 30 && stepsForward <= 3) return true;
    if (turnCount >= 50) return true; // After 50 turns, any forward movement is fine

    return false;
  }

  addTurn(text, speaker) {
    this.fullTranscript.push({
      text: text,
      speaker: speaker,
      timestamp: Date.now(),
    });
    this.turnsSinceLastSummary++;

    // Trigger summary update periodically
    if (this.turnsSinceLastSummary >= this.summaryInterval && !this.isSummarizing) {
      this.updateSummary();
    }
  }

  async updateSummary() {
    if (this.isSummarizing) return;
    this.isSummarizing = true;

    try {
      // Get the turns since last summary
      var recentTurns = this.fullTranscript.slice(-this.summaryInterval * 2);
      var recentText = recentTurns.map(function(t) {
        return t.speaker + ': ' + t.text;
      }).join('\n');

      var prompt = 'You are summarizing a live sales call for a real-time coaching system.\n\n';

      if (this.summary) {
        prompt += 'PREVIOUS SUMMARY:\n' + this.summary + '\n\n';
      }

      prompt += 'NEW TRANSCRIPT TURNS:\n' + recentText + '\n\n';
      prompt += 'Update the summary to include the new turns. Keep it concise (max 150 words). Include:\n';
      prompt += '- What the prospect wants / their situation\n';
      prompt += '- Key objections raised and how they were handled (including which identity-shifting phases were used)\n';
      prompt += '- Current call stage - must be one of: introduction / set / discovery / transition / pitch / close / objection_handling\n';
      prompt += '  * introduction = first 60-120 seconds, rapport building, name/location/profession/family\n';
      prompt += '  * set = frame control, establishing agenda, pre-handling objections with humor\n';
      prompt += '  * discovery = pain excavation, V-L-F-A-R dialogue, fear/challenge/consequence questions\n';
      prompt += '  * transition = bridging from discovery to pitch, "I have heard enough", restating their WHY\n';
      prompt += '  * pitch = presenting the offer/program, three pillars, no-oriented check-ins\n';
      prompt += '  * close = summarizing, temp check, investment anchor, silence after price. ONLY after the pitch has been fully delivered and price stated.\n';
      prompt += '  * objection_handling = identity shifting phases after prospect raises an objection\n';
      prompt += '\n  CURRENT STAGE: ' + this.detectedStage + '\n';
      prompt += '  IMPORTANT: Stages progress sequentially. From "' + this.detectedStage + '" you can ONLY move to the next stage in order, or to objection_handling. Do NOT skip stages.\n';
      prompt += '- Any commitments or next steps mentioned\n';
      prompt += '- Important facts (name, location, profession, family, income, goal, WHY, budget, timeline, pain points)\n';
      prompt += '- Which discovery techniques have been used (labels, frames, DCQs, fear-based, challenge, consequence)\n\n';
      prompt += 'Respond in raw JSON only. No markdown, no code fences, no explanation.\n';
      prompt += 'Exact format: {"summary": "...", "stage": "introduction|set|discovery|transition|pitch|close|objection_handling", "keyFacts": ["fact1", "fact2"]}';

      console.log('[memory] Updating call summary...');

      var response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      var content = response.content[0] ? response.content[0].text : null;
      if (content) {
        // Strip markdown code fences if Claude wraps the JSON
        var jsonStr = content.trim();
        if (jsonStr.indexOf('```') === 0) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
        }
        var parsed = JSON.parse(jsonStr);
        this.summary = parsed.summary || this.summary;

        // Enforce stage progression — don't let Claude skip stages
        var proposedStage = parsed.stage || this.detectedStage;
        if (this.isValidStageProgression(this.detectedStage, proposedStage)) {
          if (this.detectedStage !== proposedStage) {
            console.log('[memory] Stage advanced: ' + this.detectedStage + ' → ' + proposedStage);
          }
          this.detectedStage = proposedStage;
        } else {
          console.log('[memory] Blocked invalid stage jump: ' + this.detectedStage + ' → ' + proposedStage + ' (skipping ahead not allowed)');
        }
        if (parsed.keyFacts && parsed.keyFacts.length > 0) {
          // Merge new facts, avoid duplicates
          for (var i = 0; i < parsed.keyFacts.length; i++) {
            if (this.keyFacts.indexOf(parsed.keyFacts[i]) === -1) {
              this.keyFacts.push(parsed.keyFacts[i]);
            }
          }
          // Keep only last 10 facts
          if (this.keyFacts.length > 10) {
            this.keyFacts = this.keyFacts.slice(-10);
          }
        }
        console.log('[memory] Summary updated. Stage: ' + this.detectedStage);
        console.log('[memory] Key facts: ' + this.keyFacts.length);
      }

      this.turnsSinceLastSummary = 0;
    } catch (err) {
      console.error('[memory] Summary update failed:', err.message);
    }

    this.isSummarizing = false;
  }

  // Build context string for the suggestion engine
  getContext() {
    var parts = [];

    if (this.summary) {
      parts.push('CALL SUMMARY SO FAR:\n' + this.summary);
    }

    if (this.detectedStage) {
      parts.push('CURRENT CALL STAGE: ' + this.detectedStage);
    }

    if (this.keyFacts.length > 0) {
      parts.push('KEY FACTS:\n- ' + this.keyFacts.join('\n- '));
    }

    return parts.join('\n\n');
  }

  getTurnCount() {
    return this.fullTranscript.length;
  }

  reset() {
    this.fullTranscript = [];
    this.summary = '';
    this.turnsSinceLastSummary = 0;
    this.isSummarizing = false;
    this.detectedStage = 'introduction';
    this.keyFacts = [];
  }
}

module.exports = CallMemory;
