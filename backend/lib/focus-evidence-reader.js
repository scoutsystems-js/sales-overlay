'use strict';

// A narrow reader for Personal Coaching proof. The model never copies
// transcript text: it may cite only numbered turns. Scout then reconstructs
// the exact words and verifies speaker/order before anything can be used.
const objectionSequence = require('./objection-coaching-sequence');
const stageEvidence = require('./stage-coaching-evidence');

const STAGES = ['objection', 'discovery', 'pitch', 'close'];
const OBJECTION_CATEGORIES = require('./objection-categories').STORED_OBJECTION_CATEGORIES;

function normalizeFocus(raw) {
  const stage = String(raw && raw.stage || '').trim().toLowerCase();
  if (!STAGES.includes(stage)) return null;
  const category = String(raw && raw.category || '').trim().toLowerCase() || null;
  if (stage === 'objection' && !OBJECTION_CATEGORIES.includes(category)) return null;
  return { stage, category: stage === 'objection' ? category : null };
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function turnAt(turns, number) {
  const index = positiveInteger(number);
  const turn = index && Array.isArray(turns) ? turns[index - 1] : null;
  if (!turn || typeof turn.text !== 'string' || !turn.text.trim()) return null;
  return { index, speaker: turn.speaker, text: turn.text.trim() };
}

function comparableText(value) {
  return String(value || '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/(?:…|\.\.\.)\s*$/, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// A saved objection surface may be a verbatim excerpt of a longer prospect
// turn. It is useful only when it locates exactly one prospect-spoken line;
// choosing a convenient duplicate would turn evidence into a guess.
function findUniqueProspectConcern(turns, savedQuote) {
  const needle = comparableText(savedQuote);
  if (needle.length < 12 || !Array.isArray(turns)) return null;
  const matches = turns.map((turn, index) => ({ turn, index: index + 1 }))
    .filter(({ turn }) => turn && turn.speaker === 'PROSPECT' && comparableText(turn.text).includes(needle));
  return matches.length === 1 ? matches[0].index : null;
}

function locateAtCandidateIndex(candidateIndex) {
  return function (turns, quote) {
    const hit = turnAt(turns, candidateIndex);
    return hit && hit.text === String(quote || '').trim() ? { index: hit.index, speaker: hit.speaker } : null;
  };
}

function objectionRaw(candidate, turns) {
  const fields = [
    ['concern', 'concern_turn'],
    ['check', 'check_turn'],
    ['confirmation', 'confirmation_turn'],
    ['response', 'response_turn'],
  ];
  const raw = { response_kind: candidate && candidate.response_kind };
  const cited = {};
  for (const [field, key] of fields) {
    const hit = turnAt(turns, candidate && candidate[key]);
    if (!hit) return null;
    raw[field] = { quote: hit.text };
    cited[field] = hit.index;
  }
  return { raw, cited };
}

function stageRaw(candidate, stage, turns) {
  const shape = stageEvidence.SHAPES[stage];
  if (!shape) return null;
  const raw = {};
  const cited = {};
  for (const [field] of shape) {
    const hit = turnAt(turns, candidate && candidate[field + '_turn']);
    if (!hit) return null;
    raw[field] = { quote: hit.text };
    cited[field] = hit.index;
  }
  return { raw, cited };
}

function verifyCandidate(candidate, rawFocus, turns) {
  const focus = normalizeFocus(rawFocus);
  if (!focus || !candidate || typeof candidate !== 'object') return null;
  if (focus.stage === 'objection') {
    const built = objectionRaw(candidate, turns);
    if (!built) return null;
    const locate = function (allTurns, quote) {
      const fields = ['concern', 'check', 'confirmation', 'response'];
      const key = fields.find((field) => built.raw[field].quote === String(quote || '').trim());
      return key ? locateAtCandidateIndex(built.cited[key])(allTurns, quote) : null;
    };
    return objectionSequence.verify(built.raw, turns, locate);
  }
  const built = stageRaw(candidate, focus.stage, turns);
  if (!built) return null;
  const keys = stageEvidence.SHAPES[focus.stage].map(([field]) => field);
  const locate = function (allTurns, quote) {
    const key = keys.find((field) => built.raw[field].quote === String(quote || '').trim());
    return key ? locateAtCandidateIndex(built.cited[key])(allTurns, quote) : null;
  };
  return stageEvidence.verify(built.raw, focus.stage, turns, locate);
}

// Broader objection evidence: the concern is already a saved, exact focus
// moment. The reader only locates the reply that followed and the prospect's
// next recorded line. It makes no claim that the reply caused an outcome.
function verifyObjectionResponseArc(candidate, concernTurn, turns) {
  if (!candidate || typeof candidate !== 'object') return null;
  const concern = turnAt(turns, concernTurn);
  const actionNumbers = Array.isArray(candidate.action_turns) ? candidate.action_turns : [];
  const prospectNext = turnAt(turns, candidate.prospect_next_turn);
  if (!concern || concern.speaker !== 'PROSPECT' || !prospectNext || prospectNext.speaker !== 'PROSPECT') return null;
  if (actionNumbers.length < 1 || actionNumbers.length > 3) return null;
  const actions = actionNumbers.map((number) => turnAt(turns, number));
  if (actions.some((action) => !action || action.speaker !== 'CLOSER')) return null;
  if (new Set(actions.map((action) => action.index)).size !== actions.length) return null;
  if (actions.some((action, index) => action.index <= concern.index || (index && actions[index - 1].index >= action.index))) return null;
  if (prospectNext.index <= actions[actions.length - 1].index) return null;
  return {
    concern: { quote: concern.text, turn: concern.index },
    actions: actions.map((action) => ({ quote: action.text, turn: action.index })),
    prospect_next: { quote: prospectNext.text, turn: prospectNext.index },
  };
}

function schemaFor(focus) {
  if (focus.stage === 'objection') {
    return '{"concern_turn":number,"check_turn":number,"confirmation_turn":number,"response_turn":number,"response_kind":"reframed|offered_path|addressed|continued_isolation|did_not_address"}';
  }
  return '{' + stageEvidence.SHAPES[focus.stage].map(([field]) => '"' + field + '_turn":number').join(',') + '}';
}

function taskFor(focus) {
  if (focus.stage === 'objection') {
    return 'Find one ' + focus.category.charAt(0).toUpperCase() + focus.category.slice(1) + ' objection sequence only if the call proves this order: prospect concern, closer isolation question, prospect directly confirms the concern is the only blocker, then closer response.';
  }
  const descriptions = {
    discovery: 'Find one Discovery sequence only if the call proves this order: prospect context, closer digs, prospect gives usable detail.',
    pitch: 'Find one Pitch sequence only if the call proves this order: prospect question, closer explains, prospect confirms understanding.',
    close: 'Find one Close sequence only if the call proves this order: closer asks, prospect responds, closer makes the next move.',
  };
  return descriptions[focus.stage];
}

function buildPrompt(rawFocus, turns) {
  const focus = normalizeFocus(rawFocus);
  if (!focus) throw new Error('A valid Personal Coaching focus is required.');
  if (!Array.isArray(turns) || !turns.length) throw new Error('A numbered transcript is required.');
  const transcript = turns.map((turn, index) => {
    const speaker = turn && turn.speaker;
    const text = turn && typeof turn.text === 'string' ? turn.text.trim() : '';
    return '[' + (index + 1) + '] ' + speaker + ': ' + text;
  }).join('\n');
  return [
    'You are a factual evidence locator. You do not coach, grade, summarize, explain, or infer outcomes.',
    taskFor(focus),
    'Return JSON only. Return the exact turn numbers only — never copy, shorten, paraphrase, or combine transcript wording.',
    'If any required step is absent, unclear, speaker-wrong, or out of order, return null. Do not choose a near match.',
    'Required JSON shape: ' + schemaFor(focus),
    'Transcript:',
    transcript,
  ].join('\n\n');
}

function buildObjectionResponseArcPrompt(turns, concernTurn) {
  const concern = turnAt(turns, concernTurn);
  if (!concern || concern.speaker !== 'PROSPECT') throw new Error('A prospect-spoken objection turn is required.');
  const start = Math.max(0, concern.index - 3);
  const end = Math.min(turns.length, concern.index + 60);
  const transcript = turns.slice(start, end).map((turn, offset) => {
    const index = start + offset + 1;
    return '[' + index + '] ' + turn.speaker + ': ' + String(turn.text || '').trim();
  }).join('\n');
  return [
    'You are a factual evidence locator. You do not coach, grade, summarize, explain, or infer outcomes.',
    'The known objection is the PROSPECT line at turn [' + concern.index + ']. Do not choose another concern.',
    'Return the one to three CLOSER turns that directly respond to that objection, followed by the next PROSPECT turn after those selected actions.',
    'Return JSON only, using turn numbers only. Never copy, shorten, paraphrase, combine wording, infer intent, or claim the response worked.',
    'If there is no direct response followed by a prospect line, return null. Do not choose a later unrelated topic.',
    'Required JSON shape: {"action_turns":[number],"prospect_next_turn":number}',
    'Transcript window:',
    transcript,
  ].join('\n\n');
}

function extractFirstJsonObject(text) {
  const source = String(text || '').trim();
  const start = source.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (!depth) {
        try { return JSON.parse(source.slice(start, index + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function parseResponse(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return cleaned === 'null' ? null : extractFirstJsonObject(cleaned);
}

module.exports = { normalizeFocus, verifyCandidate, verifyObjectionResponseArc, findUniqueProspectConcern, buildPrompt, buildObjectionResponseArcPrompt, extractFirstJsonObject, parseResponse };
