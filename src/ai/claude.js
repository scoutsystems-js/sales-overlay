var Anthropic = require('@anthropic-ai/sdk');
var prompts = require('./prompts');
var objections = require('./objections');

// Short acknowledgment words the closer says while the prospect is talking ("Yeah", "Right", "Okay").
// These are backchannels — they should NOT reset the closer-active timer, count as turns toward
// auto-advance, or accumulate in delivery detection. Without this filter, saying "Yeah" every few
// seconds permanently blocks the closer-active guard and prevents new prompts from firing.
var BACKCHANNEL_WORDS = [
  'yeah', 'yes', 'yep', 'yup', 'okay', 'ok', 'right', 'sure', 'mhm', 'mhmm',
  'uh', 'uhh', 'um', 'hmm', 'hm', 'gotcha', 'cool', 'nice', 'great', 'good',
  'absolutely', 'totally', 'exactly', 'definitely', 'agreed', 'true', 'fair',
  'wow', 'oh', 'ah', 'interesting', 'seriously', 'alright',
];

// Returns true if text is a short backchannel — 3 words or fewer, all acknowledgment/stop words.
function isBackchannel(text) {
  var words = text.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(function(w) { return w.length > 0; });
  if (words.length === 0 || words.length > 3) return false;
  return words.every(function(w) {
    return BACKCHANNEL_WORDS.indexOf(w) !== -1 || STOP_WORDS.indexOf(w) !== -1 || w.length <= 2;
  });
}

// Common filler words that appear in almost any sentence — don't count these toward delivery
var STOP_WORDS = [
  'the', 'that', 'this', 'what', 'when', 'where', 'which', 'who', 'how',
  'you', 'your', 'they', 'them', 'their', 'she', 'her', 'him', 'his',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having',
  'does', 'did', 'doing', 'will', 'would', 'could', 'should', 'might',
  'can', 'may', 'shall', 'must', 'need',
  'for', 'and', 'but', 'not', 'with', 'from', 'about', 'into', 'just',
  'also', 'than', 'then', 'very', 'really', 'like', 'right', 'here',
  'there', 'now', 'out', 'get', 'got', 'let', 'make', 'made', 'know',
  'think', 'say', 'said', 'tell', 'told', 'going', 'come', 'came',
  'want', 'see', 'look', 'take', 'give', 'well', 'still', 'back',
  'even', 'way', 'own', 'same', 'any', 'some', 'all', 'most', 'more',
  'other', 'much', 'sure', 'okay', 'yeah', 'yes', 'mean', 'thing',
  'things', 'thats', "that's", 'its', "it's",
];

// Extract the question portion from a suggestion like "Statement here. Question here?"
// Returns the question sentence if found, or the full text if no question detected.
function extractQuestionPart(text) {
  if (!text) return text;

  // Split into sentences (on . ! or ?)
  // We want to find the question sentence(s) — anything ending in ?
  var sentences = text.split(/(?<=[.!?])\s+/);
  var questions = [];
  var statements = [];

  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i].trim();
    if (!s) continue;
    if (s.indexOf('?') !== -1) {
      questions.push(s);
    } else {
      statements.push(s);
    }
  }

  return {
    question: questions.length > 0 ? questions.join(' ') : null,
    statement: statements.length > 0 ? statements.join(' ') : null,
    full: text,
  };
}

// Count meaningful word matches between spoken text and a target string
function countMeaningfulMatches(spoken, target) {
  var targetNorm = target.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  var targetWords = targetNorm.split(/\s+/).filter(function(w) {
    return w.length >= 4 && STOP_WORDS.indexOf(w) === -1;
  });

  if (targetWords.length < 2) return { matchCount: 0, totalWords: 0, ratio: 0 };

  var matchCount = 0;
  for (var i = 0; i < targetWords.length; i++) {
    if (spoken.indexOf(targetWords[i]) !== -1) {
      matchCount++;
    }
  }

  return {
    matchCount: matchCount,
    totalWords: targetWords.length,
    ratio: targetWords.length > 0 ? matchCount / targetWords.length : 0,
  };
}

// Fuzzy match — checks if the closer has delivered the suggestion.
// Priority: detect the QUESTION part first (that's what moves the call forward).
// The statement/mirror part is optional — some closers use it, some skip it.
function hasDeliveredLine(spokenText, suggestedText) {
  if (!suggestedText) return true; // No active suggestion = free to advance

  var spoken = spokenText.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  var parts = extractQuestionPart(suggestedText);

  // If there's a question portion, that's the primary delivery target
  if (parts.question) {
    var qMatch = countMeaningfulMatches(spoken, parts.question);

    // Question detected: require 35%+ of question words AND at least 2 matches
    // (questions are shorter so we lower the minimum match count to 2)
    if (qMatch.totalWords >= 2 && qMatch.ratio >= 0.35 && qMatch.matchCount >= 2) {
      return true;
    }

    // If question has very few meaningful words (e.g., "What do you do for work?")
    // fall through to full-text matching as backup
    if (qMatch.totalWords < 2) {
      // Fall through
    } else {
      return false; // Question exists with enough words but closer hasn't said it yet
    }
  }

  // Fallback: no question found, or question too short — match on full text
  var fullMatch = countMeaningfulMatches(spoken, parts.full);
  return fullMatch.totalWords >= 3 && fullMatch.ratio >= 0.35 && fullMatch.matchCount >= 3;
}

class ClaudeCoach {
  constructor(apiKey, knowledgeBase, callMemory) {
    this.client = new Anthropic({ apiKey: apiKey });
    this.kb = knowledgeBase || null;
    this.memory = callMemory || null;
    this.callBuffer = [];
    this.lastCallTime = 0;
    this.minInterval = 5000; // 5 seconds minimum between API calls
    this.turnsSinceLastCall = 0;
    this.minTurnsBetweenCalls = 2;

    // Delivery tracking
    this.currentSuggestion = null;   // The suggestion text currently displayed
    this.suggestionDelivered = true; // Start true so first call can fire
    this.closerSpeechSinceSuggestion = ''; // Accumulates closer speech since last suggestion
    this.suggestionTimestamp = 0;    // When the current suggestion was set
    this.turnsSinceSuggestion = 0;   // How many closer turns since current suggestion

    // Prospect response gate — after closer delivers, wait for prospect to respond
    // before generating next suggestion (so the next prompt is based on prospect's answer)
    this.waitingForProspectResponse = false;
    this.prospectRespondedSinceDelivery = true; // Start true so first call can fire

    // Suggestion history — prevents Claude from repeating itself
    this.recentSuggestions = [];     // Last N suggestions sent to overlay
    this.maxSuggestionHistory = 8;   // Track last 8 suggestions
    this.recentAngles = [];          // Track themes/angles to prevent hammering same topic
    this.maxAngleHistory = 5;        // Last 5 angles

    // Delivery gate fallback — if closer hasn't delivered after this many turns or seconds, advance anyway
    this.maxTurnsBeforeAutoAdvance = 4;   // 4 closer turns = they moved on
    this.maxSecondsBeforeAutoAdvance = 30; // 30 seconds of SILENCE = they moved on

    // Track when the closer last spoke — timeouts should NOT fire while closer is actively talking
    this.lastCloserSpeechTime = 0;
    this.closerActiveThreshold = 5000; // If closer spoke within 5 seconds, they're still going

    // Track when prospect last spoke — prevents next prompt from firing mid-answer
    this.lastProspectSpeechTime = 0;
  }

  addTurn(text, speaker) {
    this.callBuffer.push({ text: text, speaker: speaker, timestamp: Date.now() });
    if (this.callBuffer.length > 16) {
      this.callBuffer = this.callBuffer.slice(-16);
    }
    this.turnsSinceLastCall++;

    // Track closer speech for delivery detection
    if (speaker === 'CLOSER') {
      // Backchannels ("Yeah", "Right", "Okay") are acknowledgment cues, not real speech.
      // Don't let them reset the closer-active timer, accumulate in delivery detection,
      // or count toward the 4-turn auto-advance.
      var backchannel = isBackchannel(text);

      var prevCloserSpeechTime = this.lastCloserSpeechTime;
      if (!backchannel) {
        this.lastCloserSpeechTime = Date.now();
      }

      if (this.currentSuggestion && !backchannel) {
        this.closerSpeechSinceSuggestion += ' ' + text;
        this.turnsSinceSuggestion++;

        if (!this.suggestionDelivered) {
          // Check 1: Did closer say enough of the QUESTION words from the suggestion?
          if (hasDeliveredLine(this.closerSpeechSinceSuggestion, this.currentSuggestion)) {
            this.suggestionDelivered = true;
            this.waitingForProspectResponse = true;
            this.prospectRespondedSinceDelivery = false;
            console.log('[claude] Closer delivered the line — waiting for prospect to respond before next prompt');
          }
          // Check 2: Auto-advance after N closer turns (they moved on without saying it verbatim)
          // ONLY fire if there was a real gap before this turn (> 2s) — prevents Deepgram
          // splitting one continuous sentence into 4+ rapid chunks from triggering this
          else if (this.turnsSinceSuggestion >= this.maxTurnsBeforeAutoAdvance) {
            var gapSinceLastTurn = prevCloserSpeechTime > 0 ? (this.lastCloserSpeechTime - prevCloserSpeechTime) : 9999;
            if (gapSinceLastTurn > 2000) {
              this.suggestionDelivered = true;
              this.waitingForProspectResponse = true;
              this.prospectRespondedSinceDelivery = false;
              console.log('[claude] Auto-advancing — closer spoke ' + this.turnsSinceSuggestion + ' turns without delivering. Waiting for prospect response.');
            }
          }
          // NOTE: Time-based auto-advance (Check 3) is now ONLY in getSuggestion()
          // so it can check if closer is still actively speaking before firing
        }
      }
    }

    // Track prospect speech — used for response gate and "prospect finished speaking" delay
    if (speaker === 'PROSPECT') {
      this.lastProspectSpeechTime = Date.now();
      if (this.waitingForProspectResponse) {
        this.prospectRespondedSinceDelivery = true;
        this.waitingForProspectResponse = false;
        console.log('[claude] Prospect responded — ready for next prompt');
      }
    }

    // Also feed to call memory for long-term context
    if (this.memory) {
      this.memory.addTurn(text, speaker);
    }
  }

  getTranscriptString() {
    return this.callBuffer.map(function(turn) {
      return turn.speaker + ': ' + turn.text;
    }).join('\n');
  }

  async getSuggestion(onSuggestion) {
    var now = Date.now();

    // Rate limiting: time-based AND turn-based
    if (now - this.lastCallTime < this.minInterval) return;
    if (this.callBuffer.length < 2) return;

    var lastTurn = this.callBuffer[this.callBuffer.length - 1];
    var transcript = this.getTranscriptString();

    // 1. Check hardcoded objections FIRST — BEFORE the delivery gate
    //    Objections bypass everything (they're urgent and time-sensitive)
    if (lastTurn.speaker === 'PROSPECT') {
      var localMatch = objections.detectObjection(lastTurn.text);
      if (localMatch) {
        console.log('[claude] Local objection match: ' + localMatch.label);
        var objSuggestion = {
          stage: 'objection_handling',
          headline: localMatch.label + ' — Phase 1',
          suggestion: localMatch.rebuttal,
          followUp: localMatch.followUp,
          urgency: 'high',
          source: 'local',
        };

        // Track this as the new current suggestion
        this.currentSuggestion = localMatch.rebuttal;
        this.suggestionDelivered = false;
        this.closerSpeechSinceSuggestion = '';
        this.suggestionTimestamp = Date.now();
        this.turnsSinceSuggestion = 0;

        onSuggestion(objSuggestion);
        this.lastCallTime = now;
        this.turnsSinceLastCall = 0;
        return;
      }
    }

    // Is the closer actively speaking right now? If so, NEVER interrupt with a new prompt.
    var closerIsActive = (this.lastCloserSpeechTime > 0 && now - this.lastCloserSpeechTime < this.closerActiveThreshold);

    // DELIVERY GATE + TURN GATE: Only applies to Claude API suggestions (not objections)
    if (this.turnsSinceLastCall < this.minTurnsBetweenCalls) return;
    if (!this.suggestionDelivered) {
      // Time-based auto-advance — but ONLY if the closer has stopped talking
      if (!closerIsActive && this.suggestionTimestamp && now - this.suggestionTimestamp > this.maxSecondsBeforeAutoAdvance * 1000) {
        this.suggestionDelivered = true;
        this.waitingForProspectResponse = true;
        this.prospectRespondedSinceDelivery = false;
        console.log('[claude] Auto-advancing in getSuggestion — timeout reached + closer silent. Waiting for prospect response.');
      } else {
        return;
      }
    }

    // PROSPECT RESPONSE GATE: After closer delivers, wait for prospect to respond.
    // This prevents new prompts from popping up while the closer is still talking
    // or before the prospect has had a chance to answer the question.
    if (!this.prospectRespondedSinceDelivery) {
      // Never fire while closer is actively speaking
      if (closerIsActive) return;

      // Safety valve: if closer stopped talking AND 45+ seconds since prompt, advance anyway
      if (this.suggestionTimestamp && now - this.suggestionTimestamp > 45000) {
        this.prospectRespondedSinceDelivery = true;
        console.log('[claude] Prospect response timeout (45s + closer silent) — advancing anyway');
      } else {
        return;
      }
    }

    // Prospect-finished-speaking check: wait 1.5s after prospect's last speech before firing.
    // This prevents the next prompt from appearing while the prospect is still mid-sentence.
    // The prospect response gate already confirmed they spoke — this just waits for their pause.
    if (this.lastProspectSpeechTime > 0 && now - this.lastProspectSpeechTime < 1500) return;

    // Final safety check: never generate a new prompt while the closer is mid-sentence
    if (closerIsActive) return;

    this.lastCallTime = now;
    this.turnsSinceLastCall = 0;

    try {
      // 2. Search knowledge base for relevant context
      var kbContext = '';
      if (this.kb) {
        console.log('[claude] Searching knowledge base...');
        var kbResults = await this.kb.searchByText(lastTurn.text, 3);
        if (kbResults && kbResults.length > 0) {
          kbContext = this.kb.buildContext(kbResults);
          console.log('[claude] Found ' + kbResults.length + ' KB matches');
        }
      }

      // 3. Get call memory context
      var memoryContext = '';
      if (this.memory) {
        memoryContext = this.memory.getContext();
        if (memoryContext) {
          console.log('[claude] Call stage: ' + this.memory.detectedStage + ' | Turns: ' + this.memory.getTurnCount());
        }
      }

      // 4. Build suggestion history context (anti-repetition — both exact lines AND themes/angles)
      var suggestionHistory = '';
      if (this.recentSuggestions.length > 0) {
        var historyLines = this.recentSuggestions.map(function(s) {
          return '- ' + s.headline + ': "' + s.suggestion + '"';
        });
        suggestionHistory = 'ALREADY SUGGESTED (DO NOT REPEAT THESE — move the conversation FORWARD):\n' + historyLines.join('\n');
      }
      if (this.recentAngles.length > 0) {
        var angleLines = this.recentAngles.map(function(a) {
          return '- ' + a;
        });
        suggestionHistory += '\n\nANGLES/THEMES ALREADY EXPLORED (DO NOT revisit these topics — find a NEW angle or move to the next stage):\n' + angleLines.join('\n');
        suggestionHistory += '\nIf you\'ve asked about a topic 2+ times and the prospect answered, MOVE ON. Do not rephrase the same question.';
      }

      // 5. Call Claude with full context
      console.log('[claude] Calling Claude API...');
      var userPrompt = prompts.buildSuggestionPrompt(transcript, null, kbContext, memoryContext, suggestionHistory);

      var response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: prompts.SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      var content = response.content[0] ? response.content[0].text : null;
      if (!content) return;

      // Strip markdown code fences if Claude wraps the JSON
      var jsonStr = content.trim();
      if (jsonStr.indexOf('```') === 0) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
      }

      var parsed = JSON.parse(jsonStr);
      // Always send the suggestion — this is a live teleprompter, not a selective coach
      if (parsed.suggestion) {
        console.log('[claude] Next line: ' + parsed.headline);

        var newSuggestion = {
          stage: parsed.stage || (this.memory ? this.memory.detectedStage : 'discovery'),
          headline: parsed.headline || '',
          suggestion: parsed.suggestion,
          followUp: parsed.followUp || '',
          urgency: parsed.urgency || 'medium',
          source: kbContext ? 'kb+claude' : 'claude',
        };

        // Track this as the new current suggestion
        this.currentSuggestion = parsed.suggestion;
        this.suggestionDelivered = false;
        this.closerSpeechSinceSuggestion = '';
        this.suggestionTimestamp = Date.now();
        this.turnsSinceSuggestion = 0;

        // Log what the delivery detector is listening for
        var listenParts = extractQuestionPart(parsed.suggestion);
        if (listenParts.question) {
          console.log('[claude] Listening for QUESTION: "' + listenParts.question + '"');
        } else {
          console.log('[claude] Listening for full line (no question detected)');
        }

        // Add to suggestion history (for anti-repetition)
        this.recentSuggestions.push({
          headline: parsed.headline || '',
          suggestion: parsed.suggestion,
        });
        if (this.recentSuggestions.length > this.maxSuggestionHistory) {
          this.recentSuggestions = this.recentSuggestions.slice(-this.maxSuggestionHistory);
        }

        // Extract and track the theme/angle (headline is usually a good proxy)
        var angle = (parsed.headline || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (angle) {
          // Check if this angle is similar to one we already tracked
          var isDuplicateAngle = false;
          for (var ai = 0; ai < this.recentAngles.length; ai++) {
            var existing = this.recentAngles[ai].toLowerCase();
            // If the new angle shares 50%+ words with an existing one, it's the same theme
            var newWords = angle.split(/\s+/);
            var existingWords = existing.split(/\s+/);
            var overlap = 0;
            for (var wi = 0; wi < newWords.length; wi++) {
              if (newWords[wi].length >= 4 && existingWords.indexOf(newWords[wi]) !== -1) overlap++;
            }
            if (newWords.length > 0 && overlap / newWords.length >= 0.5) {
              isDuplicateAngle = true;
              break;
            }
          }
          if (!isDuplicateAngle) {
            this.recentAngles.push(parsed.headline || angle);
            if (this.recentAngles.length > this.maxAngleHistory) {
              this.recentAngles = this.recentAngles.slice(-this.maxAngleHistory);
            }
          }
        }

        onSuggestion(newSuggestion);
      }
    } catch (err) {
      console.error('[claude] Error:', err.message);
    }
  }

  reset() {
    this.callBuffer = [];
    this.lastCallTime = 0;
    this.turnsSinceLastCall = 0;
    this.currentSuggestion = null;
    this.suggestionDelivered = true;
    this.closerSpeechSinceSuggestion = '';
    this.suggestionTimestamp = 0;
    this.turnsSinceSuggestion = 0;
    this.waitingForProspectResponse = false;
    this.prospectRespondedSinceDelivery = true;
    this.lastCloserSpeechTime = 0;
    this.lastProspectSpeechTime = 0;
    this.recentSuggestions = [];
    this.recentAngles = [];
    if (this.memory) {
      this.memory.reset();
    }
  }
}

module.exports = ClaudeCoach;
