'use strict';

// Each stage has its own factual conversation shape. This is deliberately not
// a free-form coaching summary; it is the verified source material a later
// coaching surface may summarize.
const SHAPES = {
  discovery: [['prospect_context', 'PROSPECT'], ['closer_probe', 'CLOSER'], ['prospect_detail', 'PROSPECT']],
  pitch: [['prospect_question', 'PROSPECT'], ['closer_explanation', 'CLOSER'], ['prospect_confirmation', 'PROSPECT']],
  close: [['closer_ask', 'CLOSER'], ['prospect_response', 'PROSPECT'], ['closer_next_move', 'CLOSER']],
};

function sanitize(raw, section) {
  const shape = SHAPES[section];
  if (!shape || !raw || typeof raw !== 'object') return null;
  const out = { stage: section };
  for (const [key] of shape) {
    if (!raw[key] || typeof raw[key].quote !== 'string' || !raw[key].quote.trim()) return null;
    out[key] = { quote: raw[key].quote.trim().slice(0, 1000) };
  }
  return out;
}

function verify(raw, section, turns, locate) {
  const value = sanitize(raw, section);
  const shape = SHAPES[section];
  if (!value || !shape) return null;
  const hits = [];
  for (const [key, speaker] of shape) {
    const hit = locate(turns, value[key].quote);
    if (!hit || hit.speaker !== speaker) return null;
    hits.push(hit);
  }
  if (hits.some((hit, index) => index && hits[index - 1].index >= hit.index)) return null;
  shape.forEach(([key], index) => { value[key].turn = hits[index].index; });
  return value;
}

function promptBlock() {
  return [
    'FOR a moment in Discovery, Pitch, or Close, include at most ONE coaching_evidence exchange per stage per call, and only when its complete stage-specific exchange is present. Copy every quote verbatim from one transcript line; omit the field if a step is absent, unclear, wrong-speaker or out of order.',
    '  - Discovery: {"prospect_context":{"quote":"..."},"closer_probe":{"quote":"..."},"prospect_detail":{"quote":"..."}} — prospect context → closer digs → prospect gives usable detail.',
    '  - Pitch: {"prospect_question":{"quote":"..."},"closer_explanation":{"quote":"..."},"prospect_confirmation":{"quote":"..."}} — prospect question → clearer explanation → prospect confirms understanding.',
    '  - Close: {"closer_ask":{"quote":"..."},"prospect_response":{"quote":"..."},"closer_next_move":{"quote":"..."}} — closer asks → prospect responds → closer takes the next move. The call outcome is stored separately; never claim this exchange caused it.',
    '  - Objection handling uses its separate coaching_sequence contract below; do not emit coaching_evidence for objections.',
  ].join('\n');
}

module.exports = { SHAPES, sanitize, verify, promptBlock };
