'use strict';

// The factual spine Personal Coaching needs. It is captured once while the
// extractor reads the full call, then mechanically checked before storage.
// It is not a causal claim and it drives neither scores nor outcomes.
const RESPONSE_KINDS = ['reframed', 'offered_path', 'addressed', 'continued_isolation', 'did_not_address'];

function line(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.quote !== 'string' || !raw.quote.trim()) return null;
  return { quote: raw.quote.trim().slice(0, 1000) };
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const concern = line(raw.concern), check = line(raw.check), confirmation = line(raw.confirmation), response = line(raw.response);
  if (!concern || !check || !confirmation || !response) return null;
  const kind = typeof raw.response_kind === 'string' ? raw.response_kind.trim().toLowerCase() : null;
  return { concern, check, confirmation, response, response_kind: RESPONSE_KINDS.includes(kind) ? kind : null };
}

function isIsolation(text) { return /\b(only|else|everything|100\s*%|hundred percent|anything else|sole)\b/i.test(text || ''); }
function isConfirmation(text) { return /\b(yes|yeah|yep|absolutely|correct|exactly|for sure|it is|that's it|that is it|only thing)\b/i.test(text || ''); }

function verify(raw, turns, locate) {
  const value = sanitize(raw);
  if (!value) return null;
  const fields = [['concern', 'PROSPECT'], ['check', 'CLOSER'], ['confirmation', 'PROSPECT'], ['response', 'CLOSER']];
  const found = [];
  for (const [key, speaker] of fields) {
    const hit = locate(turns, value[key].quote);
    if (!hit || hit.speaker !== speaker) return null;
    found.push(hit);
  }
  if (found.some((hit, index) => index && found[index - 1].index >= hit.index)) return null;
  if (!isIsolation(value.check.quote) || !isConfirmation(value.confirmation.quote)) return null;
  return Object.assign({}, value, {
    concern: { quote: value.concern.quote, turn: found[0].index },
    check: { quote: value.check.quote, turn: found[1].index },
    confirmation: { quote: value.confirmation.quote, turn: found[2].index },
    response: { quote: value.response.quote, turn: found[3].index },
  });
}

function promptBlock() {
  return [
    'FOR type="objection" MOMENTS, include at most ONE coaching_sequence per call, and only when the transcript proves this exact four-step order: prospect concern → closer isolation question → prospect directly confirms it is the only blocker → closer response.',
    '  - Each field is an object {quote:"..."}, copied verbatim from one transcript line. The confirmation must directly answer the isolation question; a new question or different concern is not confirmation.',
    '  - response_kind is exactly one of "reframed", "offered_path", "addressed", "continued_isolation", or "did_not_address". It describes only the recorded closer response, not whether it caused the outcome.',
    '  - Omit coaching_sequence when any one step is absent, unclear, speaker-wrong, or out of order. Never invent a sequence.',
  ].join('\n');
}

module.exports = { RESPONSE_KINDS, sanitize, verify, promptBlock };
