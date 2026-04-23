// Valid stage progression order — stages can only advance forward (except objection_handling)
var STAGE_ORDER = ['introduction', 'set', 'discovery', 'transition', 'pitch', 'close', 'objection_handling'];

class CallMemory {
  constructor(proxyClient, onUpdate) {
    this.proxy = proxyClient;
    this.fullTranscript = [];       // Every turn of the call
    this.summary = '';               // Rolling compressed summary
    this.turnsSinceLastSummary = 0;
    this.summaryInterval = 8;        // Summarize every 8 final turns
    this.isSummarizing = false;
    this.detectedStage = 'introduction';   // Current call stage
    this.keyFacts = [];              // Important facts extracted from the call
    this.onUpdate = onUpdate || null; // Called after each summary update with discovery state
    this.discovery = {              // Discovery tracker — once true, never goes back to false
      finances: false,        // Budget / income / investment ability discussed
      willingness: false,     // Commitment / readiness to do the work confirmed
      pain: false,            // Specific challenge or pain point identified
      goals: false,           // Specific goal or desired outcome stated
      timeline: false,        // When they want to start or achieve it
      decisionMaker: false,   // Whether they decide alone or need spouse/partner
      whyNow: false,          // Why they're looking for a solution now
      financeDetails: [],     // Array of short strings with specific financial details extracted
                              // from the prospect (e.g., "Income: $180k/yr", "Savings: ~$20k",
                              // "AmEx balance: $15k", "Monthly cashflow: $3k"). Accumulates
                              // during the call, deduped and capped at 8 entries.
    };
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
      prompt += '- Which discovery techniques have been used (labels, frames, DCQs, fear-based, challenge, consequence)\n';
      prompt += '- Discovery items gathered — set to true ONLY if clearly discussed. Once true it stays true:\n';
      prompt += '  * finances: budget/income/investment ability has been discussed\n';
      prompt += '  * willingness: their readiness/commitment to do the work has been confirmed\n';
      prompt += '  * pain: a specific challenge or pain point has been identified\n';
      prompt += '  * goals: a specific goal or desired outcome has been stated\n';
      prompt += '  * timeline: when they want to start or achieve their goal has been discussed\n';
      prompt += '  * decisionMaker: whether they can decide alone (or need spouse/partner) has been established\n';
      prompt += '  * whyNow: why they are looking for a solution right now has been uncovered\n';
      prompt += '- financeDetails: Array of short strings capturing SPECIFIC financial values the prospect has shared.\n';
      prompt += '  ONLY include items actually stated by the prospect. Keep each item under 40 characters. Examples:\n';
      prompt += '    "Income: $180k/yr"\n';
      prompt += '    "Savings: ~$20k"\n';
      prompt += '    "Monthly cashflow: $3k"\n';
      prompt += '    "AmEx available: $15k"\n';
      prompt += '    "Credit score: 760"\n';
      prompt += '    "Spouse income: $90k"\n';
      prompt += '    "Budget: under $10k"\n';
      prompt += '    "Debt: $40k student loans"\n';
      prompt += '  Rules:\n';
      prompt += '    - Only include details EXPLICITLY stated by the prospect (not the closer, not inferences).\n';
      prompt += '    - Prefer numeric values. If the prospect gives a range or approximation, capture it ("Savings: $15-20k").\n';
      prompt += '    - If no new financial details have been shared in this batch, return an empty array [].\n';
      prompt += '    - Do NOT repeat details already in previous summary unless the prospect updated the number.\n\n';
      prompt += 'Respond in raw JSON only. No markdown, no code fences, no explanation.\n';
      prompt += 'Exact format: {"summary": "...", "stage": "introduction|set|discovery|transition|pitch|close|objection_handling", "keyFacts": ["fact1", "fact2"], "discovery": {"finances": false, "willingness": false, "pain": false, "goals": false, "timeline": false, "decisionMaker": false, "whyNow": false, "financeDetails": ["Income: $180k/yr", "Savings: ~$20k"]}}';

      console.log('[memory] Updating call summary via proxy...');

      var response;
      try {
        response = await this.proxy.memory({
          userPrompt: prompt,
          maxTokens: 500,
        });
      } catch (err) {
        console.error('[memory] Proxy memory failed:', err.message);
        this.isSummarizing = false;
        return;
      }

      var content = response && response.content ? response.content : null;
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
        // Merge discovery state — once a boolean is true it never goes back to false
        // financeDetails is an accumulating array: append new items, dedupe, cap at 8
        if (parsed.discovery && typeof parsed.discovery === 'object') {
          var keys = Object.keys(this.discovery);
          for (var d = 0; d < keys.length; d++) {
            var key = keys[d];
            if (key === 'financeDetails') {
              if (Array.isArray(parsed.discovery.financeDetails)) {
                for (var f = 0; f < parsed.discovery.financeDetails.length; f++) {
                  var detail = parsed.discovery.financeDetails[f];
                  if (typeof detail === 'string') {
                    var trimmed = detail.trim();
                    if (trimmed && this.discovery.financeDetails.indexOf(trimmed) === -1) {
                      this.discovery.financeDetails.push(trimmed);
                    }
                  }
                }
                // Cap at 8 most recent details so the sidebar never overflows
                if (this.discovery.financeDetails.length > 8) {
                  this.discovery.financeDetails = this.discovery.financeDetails.slice(-8);
                }
                // If any finance detail was captured, the finances boolean is true too
                if (this.discovery.financeDetails.length > 0) {
                  this.discovery.finances = true;
                }
              }
            } else if (parsed.discovery[key] === true) {
              this.discovery[key] = true;
            }
          }
        }
        console.log('[memory] Summary updated. Stage: ' + this.detectedStage);
        console.log('[memory] Key facts: ' + this.keyFacts.length);
        console.log('[memory] Discovery: ' + JSON.stringify(this.discovery));
        // Notify listener (e.g. main process → discovery window)
        if (this.onUpdate) {
          this.onUpdate(this.discovery);
        }
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

    // v1.0.9: Discovery state — explicit checklist for the suggestion engine.
    // Before this, the 7 discovery booleans (pain, goals, finances, etc.) were
    // tracked in this.discovery but never surfaced to the prompt, so Claude had
    // to infer coverage from the summary text and often re-asked covered topics.
    // Now the engine sees a scannable DONE/NEEDED list every call.
    var done = [];
    var needed = [];
    var discoveryLabels = {
      pain: 'pain point',
      goals: 'goals/desired outcome',
      finances: 'finances/budget',
      willingness: 'willingness/commitment',
      timeline: 'timeline',
      decisionMaker: 'decision maker',
      whyNow: 'why now',
    };
    var dKeys = Object.keys(discoveryLabels);
    for (var di = 0; di < dKeys.length; di++) {
      var dk = dKeys[di];
      if (this.discovery[dk]) {
        done.push(discoveryLabels[dk]);
      } else {
        needed.push(discoveryLabels[dk]);
      }
    }
    var discoveryLines = ['DISCOVERY STATUS:'];
    if (done.length > 0) {
      discoveryLines.push('[DONE] Already covered (do NOT re-ask): ' + done.join(', '));
    }
    if (needed.length > 0) {
      discoveryLines.push('[NEEDED] Still needed: ' + needed.join(', '));
    }
    parts.push(discoveryLines.join('\n'));

    if (this.keyFacts.length > 0) {
      parts.push('KEY FACTS:\n- ' + this.keyFacts.join('\n- '));
    }

    if (this.discovery.financeDetails && this.discovery.financeDetails.length > 0) {
      parts.push('PROSPECT FINANCIAL DETAILS (explicitly shared by prospect):\n- ' +
        this.discovery.financeDetails.join('\n- '));
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
    this.discovery = {
      finances: false,
      willingness: false,
      pain: false,
      goals: false,
      timeline: false,
      decisionMaker: false,
      whyNow: false,
      financeDetails: [],
    };
  }
}

module.exports = CallMemory;
