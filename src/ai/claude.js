var prompts = require('./prompts');
var objections = require('./objections');

// v1.0.7-alpha: timing instrumentation — toggle with SCOUT_TIMING=1 env var.
// Guard is inside the helper so callsites are just timingLog(msg). Removing
// this block + all timingLog() calls is the Phase B cleanup.
var TIMING_ENABLED = process.env.SCOUT_TIMING === '1';
function timingLog(msg) { if (TIMING_ENABLED) console.log(msg); }
function makeCycleId() {
  return Math.random().toString(36).slice(2, 8);
}
// Diagnostic one-time startup log — fires unconditionally so we can tell
// whether SCOUT_TIMING reached this module at all, independent of the guard.
console.log('[timing-check] SCOUT_TIMING=' + process.env.SCOUT_TIMING + ' TIMING_ENABLED=' + TIMING_ENABLED);

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
  constructor(proxyClient, knowledgeBase, callMemory) {
    this.proxy = proxyClient;
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
    // v1.0.8: timestamp of the FIRST non-backchannel closer turn after the current
    // suggestion was set. Used by Check 2 auto-advance (elapsed-time floor) —
    // total elapsed time since this stamp beats "gap between last two turns"
    // on fluid conversations where turns arrive in rapid bursts (<2s apart).
    // Resets to 0 every time a new suggestion replaces currentSuggestion.
    this.firstCloserSpeechAfterSuggestion = 0;

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
    // v1.0.8: minimum elapsed time (ms) since first closer turn post-suggestion
    // before the turn-count auto-advance (Check 2) is allowed to fire. Prevents
    // one continuous sentence split by Deepgram into 4 rapid sub-second chunks
    // from tripping the auto-advance — those chunks would arrive within ~1-2s
    // total, well under this 4000ms threshold. Previous v1.0.7 logic used a
    // per-pair 2000ms gap between consecutive turns, which false-negatived on
    // fluid conversations where the closer speaks in rapid real bursts.
    this.turnAutoAdvanceMinElapsedMs = 4000;

    // Track when the closer last spoke — timeouts should NOT fire while closer is actively talking
    this.lastCloserSpeechTime = 0;
    this.closerActiveThreshold = 5000; // If closer spoke within 5 seconds, they're still going

    // Track when prospect last spoke — prevents next prompt from firing mid-answer
    this.lastProspectSpeechTime = 0;
    // v1.0.7: "prospect finished speaking" silence window. Must be > Deepgram's
    // endpointing=500ms so a normal pause doesn't fire a premature prompt.
    // 800ms total (ours) + Deepgram's ~500ms = ~1300ms effective silence window,
    // down from v1.0.6's 1500ms-plus-endpointing ~2000ms. Saves ~700ms per cycle.
    this.prospectSilenceMs = 800;
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

        // v1.0.8: stamp the first non-backchannel closer turn post-suggestion,
        // used by Check 2's elapsed-time floor below. Only stamps on turn 1;
        // later turns leave it alone so Check 2 measures total elapsed time
        // from the FIRST turn to the CURRENT turn.
        if (this.turnsSinceSuggestion === 1) {
          this.firstCloserSpeechAfterSuggestion = this.lastCloserSpeechTime;
        }

        if (!this.suggestionDelivered) {
          // Check 1: Did closer say enough of the QUESTION words from the suggestion?
          if (hasDeliveredLine(this.closerSpeechSinceSuggestion, this.currentSuggestion)) {
            this.suggestionDelivered = true;
            this.waitingForProspectResponse = true;
            this.prospectRespondedSinceDelivery = false;
            console.log('[claude] Closer delivered the line — waiting for prospect to respond before next prompt');
          }
          // Check 2: Auto-advance after N closer turns (they moved on without saying it verbatim)
          // v1.0.8: fires only if total elapsed time since the FIRST post-suggestion
          // closer turn exceeds turnAutoAdvanceMinElapsedMs (4s). A continuous
          // sentence that Deepgram split into 4+ rapid chunks would all arrive
          // within ~1-2s total — well under 4s — so it still can't trip this.
          // Replaces v1.0.7's per-pair 2s gap check, which false-negatived on
          // fluid conversations where real closer bursts arrive <2s apart.
          else if (this.turnsSinceSuggestion >= this.maxTurnsBeforeAutoAdvance) {
            var elapsedSinceFirstTurn = this.firstCloserSpeechAfterSuggestion > 0 ? (this.lastCloserSpeechTime - this.firstCloserSpeechAfterSuggestion) : 9999;
            if (elapsedSinceFirstTurn > this.turnAutoAdvanceMinElapsedMs) {
              this.suggestionDelivered = true;
              this.waitingForProspectResponse = true;
              this.prospectRespondedSinceDelivery = false;
              console.log('[claude] Auto-advancing — closer spoke ' + this.turnsSinceSuggestion + ' turns over ' + elapsedSinceFirstTurn + 'ms without delivering. Waiting for prospect response.');
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
    var self = this;
    // v1.0.7-alpha helper: log gate_blocked and bump the per-t0 counter.
    // Captures Date.now() at call time rather than closing over the outer
    // `now` — protects against future awaits being added before gates.
    function gateBlocked(reason) {
      var tNow = Date.now();
      if (self._lastProspectT0) self._gatesBlockedSinceT0 = (self._gatesBlockedSinceT0 || 0) + 1;
      var since = self._lastProspectT0 ? (tNow - self._lastProspectT0) : -1;
      timingLog('[TIMING] cycle=none stage=gate_blocked reason=' + reason + ' abs_ms=' + since);
    }

    // Rate limiting: time-based AND turn-based
    if (now - this.lastCallTime < this.minInterval) { gateBlocked('rate_limit'); return; }
    if (this.callBuffer.length < 2) { gateBlocked('buffer_too_small'); return; }

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
        this.firstCloserSpeechAfterSuggestion = 0; // v1.0.8: reset with turnsSinceSuggestion

        onSuggestion(objSuggestion);
        this.lastCallTime = now;
        this.turnsSinceLastCall = 0;
        return;
      }
    }

    // Is the closer actively speaking right now? Three conditions, ALL required:
    //   (1) closer has spoken at least once this session                (> 0 guard)
    //   (2) their last non-backchannel turn was within closerActiveThreshold (5s)
    //   (3) they spoke MORE RECENTLY than the prospect — i.e. they still hold the
    //       floor. If the prospect has already responded and gone silent, the
    //       closer has handed off even if they spoke 1s ago. Without (3), the
    //       trailing 5s window blocks new prompts for up to 4s after the prospect
    //       is done — the exact thrash observed in v1.0.7-alpha cycle jo6buv.
    //
    // Backchannels ("yeah", "right") deliberately don't stamp lastCloserSpeechTime
    // (see addTurn), so a closer saying "mhm" after the prospect answers doesn't
    // re-activate the guard.
    //
    // This boolean feeds THREE downstream checks, all preserved:
    //   - line ~310: !closerIsActive in the delivery auto-advance — broadened by
    //     condition (3) so auto-advance can fire once prospect has spoken, which
    //     is the intended "closer moved on" semantics.
    //   - line ~326: closerIsActive in the prospect-response-gate interlock —
    //     still blocks if closer is mid-sentence before prospect has answered.
    //   - line ~346: closerIsActive in the final safety check — still blocks
    //     mid-sentence, clears immediately on floor handoff.
    var closerIsActive = (
      this.lastCloserSpeechTime > 0 &&
      now - this.lastCloserSpeechTime < this.closerActiveThreshold &&
      this.lastCloserSpeechTime > this.lastProspectSpeechTime
    );

    // DELIVERY GATE + TURN GATE: Only applies to Claude API suggestions (not objections)
    if (this.turnsSinceLastCall < this.minTurnsBetweenCalls) { gateBlocked('turn_count'); return; }
    if (!this.suggestionDelivered) {
      // Time-based auto-advance — but ONLY if the closer has stopped talking
      if (!closerIsActive && this.suggestionTimestamp && now - this.suggestionTimestamp > this.maxSecondsBeforeAutoAdvance * 1000) {
        this.suggestionDelivered = true;
        this.waitingForProspectResponse = true;
        this.prospectRespondedSinceDelivery = false;
        console.log('[claude] Auto-advancing in getSuggestion — timeout reached + closer silent. Waiting for prospect response.');
      } else {
        gateBlocked('delivery');
        return;
      }
    }

    // PROSPECT RESPONSE GATE: After closer delivers, wait for prospect to respond.
    // This prevents new prompts from popping up while the closer is still talking
    // or before the prospect has had a chance to answer the question.
    if (!this.prospectRespondedSinceDelivery) {
      // Never fire while closer is actively speaking
      if (closerIsActive) { gateBlocked('prospect_response_closer_active'); return; }

      // Safety valve: if closer stopped talking AND 45+ seconds since prompt, advance anyway
      if (this.suggestionTimestamp && now - this.suggestionTimestamp > 45000) {
        this.prospectRespondedSinceDelivery = true;
        console.log('[claude] Prospect response timeout (45s + closer silent) — advancing anyway');
      } else {
        gateBlocked('prospect_response');
        return;
      }
    }

    // Prospect-finished-speaking check: wait 1.5s after prospect's last speech before firing.
    // This prevents the next prompt from appearing while the prospect is still mid-sentence.
    // The prospect response gate already confirmed they spoke — this just waits for their pause.
    if (this.lastProspectSpeechTime > 0 && now - this.lastProspectSpeechTime < this.prospectSilenceMs) { gateBlocked('prospect_silence'); return; }
    // v1.0.7-alpha: t1 — prospect-silence gate cleared
    timingLog('[TIMING] cycle=none stage=t1_silence_ok abs_ms=' + (this._lastProspectT0 ? (now - this._lastProspectT0) : -1));

    // Final safety check: never generate a new prompt while the closer is mid-sentence
    if (closerIsActive) { gateBlocked('closer_active_final'); return; }
    // v1.0.7-alpha: t2 — delivery + prospect-response gates passed earlier; closer-active also clean
    timingLog('[TIMING] cycle=none stage=t2_gates_passed abs_ms=' + (this._lastProspectT0 ? (now - this._lastProspectT0) : -1));

    this.lastCallTime = now;
    this.turnsSinceLastCall = 0;

    // v1.0.7-alpha: t3 — committed to this cycle. Assign cycleId now.
    var cycleId = makeCycleId();
    var cycleT0 = this._lastProspectT0 || now;
    var cycleGatesBefore = this._gatesBlockedSinceT0 || 0;
    var cycleT4 = 0;
    var cycleT5 = 0;
    var cycleKbMs = 0;
    this._activeCycleId = cycleId;
    timingLog('[TIMING] cycle=' + cycleId + ' stage=t3_committed abs_ms=' + (now - cycleT0) + ' dt_prev=0 detail=gates_blocked_before=' + cycleGatesBefore);

    try {
      // 2. Search knowledge base for relevant context
      var kbContext = '';
      if (this.kb) {
        console.log('[claude] Searching knowledge base...');
        // v1.0.7-alpha: measure KB search duration
        var kbStart = Date.now();
        var kbResults = await this.kb.search(lastTurn.text, 3);
        cycleKbMs = Date.now() - kbStart;
        if (kbResults && kbResults.length > 0) {
          kbContext = this.kb.buildContext(kbResults);
          console.log('[claude] Found ' + kbResults.length + ' KB matches');
        }
        timingLog('[TIMING] cycle=' + cycleId + ' stage=kb_done abs_ms=' + (Date.now() - cycleT0) + ' detail=kb_ms=' + cycleKbMs + ',kb_hits=' + (kbResults ? kbResults.length : 0));
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

      // 5. Call Claude via backend proxy (keys live server-side)
      console.log('[claude] Calling Claude via proxy...');
      var userPrompt = prompts.buildSuggestionPrompt(transcript, null, kbContext, memoryContext, suggestionHistory);

      // v1.0.7-alpha: t4 — Claude API request dispatched
      cycleT4 = Date.now();
      timingLog('[TIMING] cycle=' + cycleId + ' stage=t4_api_send abs_ms=' + (cycleT4 - cycleT0) + ' detail=prompt_chars=' + userPrompt.length + ',system_chars=' + prompts.SYSTEM_PROMPT.length);

      var response;
      try {
        response = await this.proxy.suggest({
          systemPrompt: prompts.SYSTEM_PROMPT,
          userPrompt: userPrompt,
          maxTokens: 300,
        });
      } catch (err) {
        console.error('[claude] Proxy suggest failed:', err.message);
        timingLog('[TIMING] cycle=' + cycleId + ' stage=t5_api_recv_error abs_ms=' + (Date.now() - cycleT0) + ' detail=err=' + String(err.message).slice(0, 80));
        this._activeCycleId = null; // v1.0.7-alpha: clear cycle on error so invariant holds
        return;
      }
      // v1.0.7-alpha: t5 — Claude API response received
      cycleT5 = Date.now();
      var cycleInputTokens = (response && response.usage && typeof response.usage.input_tokens === 'number') ? response.usage.input_tokens : null;
      var cycleOutputTokens = (response && response.usage && typeof response.usage.output_tokens === 'number') ? response.usage.output_tokens : null;
      timingLog('[TIMING] cycle=' + cycleId + ' stage=t5_api_recv abs_ms=' + (cycleT5 - cycleT0) + ' dt_prev=' + (cycleT5 - cycleT4) + ' detail=api_ms=' + (cycleT5 - cycleT4) + ',in_tok=' + cycleInputTokens + ',out_tok=' + cycleOutputTokens);

      var content = response && response.content ? response.content : null;
      if (!content) { this._activeCycleId = null; return; }

      // Strip markdown code fences if Claude wraps the JSON
      var jsonStr = content.trim();
      if (jsonStr.indexOf('```') === 0) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
      }

      var parsed = JSON.parse(jsonStr);
      // Always send the suggestion — this is a live teleprompter, not a selective coach
      if (parsed.suggestion) {
        console.log('[claude] Next line: ' + parsed.headline);
        console.log('[claude] Suggestion: ' + parsed.suggestion);

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
        this.firstCloserSpeechAfterSuggestion = 0; // v1.0.8: reset with turnsSinceSuggestion

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

        // v1.0.7-alpha: t6 — IPC dispatch to overlay. Attach cycleId + t0
        // as hidden payload so renderer can log t7 against the same baseline.
        newSuggestion._cycleId = cycleId;
        newSuggestion._t0 = cycleT0;
        var cycleT6 = Date.now();
        timingLog('[TIMING] cycle=' + cycleId + ' stage=t6_ipc_send abs_ms=' + (cycleT6 - cycleT0) + ' dt_prev=' + (cycleT6 - cycleT5));
        // v1.0.7-alpha: one-row-per-cycle summary. total_ms uses t6-t0 by design
        // (renderer t7 arrives shortly after via a separate detail line).
        // Model name deliberately omitted — recoverable from git SHA / backend
        // deployment at analysis time, and hardcoding here would silently drift
        // if backend/config.js CLAUDE_MODEL is bumped. Phase B can add model
        // back by having the proxy return response.model alongside usage.
        timingLog('[TIMING_SUMMARY] cycle=' + cycleId + ' total_ms=' + (cycleT6 - cycleT0) + ' api_ms=' + (cycleT5 - cycleT4) + ' kb_ms=' + cycleKbMs + ' gates_blocked_before=' + cycleGatesBefore + ' input_tokens=' + cycleInputTokens + ' output_tokens=' + cycleOutputTokens);
        this._activeCycleId = null;

        onSuggestion(newSuggestion);
      }
    } catch (err) {
      console.error('[claude] Error:', err.message);
      this._activeCycleId = null; // v1.0.7-alpha: clear cycle on error so invariant holds
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
    this.firstCloserSpeechAfterSuggestion = 0; // v1.0.8: reset with turnsSinceSuggestion
    this.waitingForProspectResponse = false;
    this.prospectRespondedSinceDelivery = true;
    this.lastCloserSpeechTime = 0;
    this.lastProspectSpeechTime = 0;
    this.recentSuggestions = [];
    this.recentAngles = [];
    // v1.0.7-alpha: clear timing state so a stop/restart doesn't carry stale
    // baselines into the next session's logs.
    this._lastProspectT0 = 0;
    this._gatesBlockedSinceT0 = 0;
    this._activeCycleId = null;
    if (this.memory) {
      this.memory.reset();
    }
  }
}

module.exports = ClaudeCoach;
