'use strict';

// Enrich only the three already-selected strengths. No new analysis/model call,
// no outcome inferred from a highlight, and no transcript from outside the team window.
function normalized(text) {
  return String(text || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}
function turnsOf(analysis) {
  const stored = analysis && analysis.transcript_stored;
  return (Array.isArray(stored) ? stored : stored && Array.isArray(stored.turns) ? stored.turns : [])
    .filter(t => t && ['CLOSER', 'PROSPECT'].includes(t.speaker) && typeof t.text === 'string' && Number.isFinite(t.start_seconds))
    .slice().sort((a, b) => a.start_seconds - b.start_seconds);
}
function buildEvidence(item, analysis, recordingUrl) {
  const turns = turnsOf(analysis);
  const quote = normalized(item.quote).replace(/(?:…|\.\.\.)$/, '').trim();
  if (quote.length < 20) return null;
  const role = item.spoke === 'closer' ? 'CLOSER' : item.spoke === 'prospect' ? 'PROSPECT' : null;
  if (!role) return null;
  const matches = turns.map((t, index) => ({ t, index })).filter(x => x.t.speaker === role && normalized(x.t.text).includes(quote));
  // A verbatim excerpt may start inside a turn. Match the stated speaker and
  // require one turn across the whole call; never choose a convenient occurrence.
  if (matches.length !== 1) return null;
  const match = matches[0];
  const excerpt = t => ({ speaker: t.speaker, quote: t.text, timestamp_seconds: t.start_seconds });
  const following = turns.slice(match.index + 1).filter(t => t.start_seconds <= match.t.start_seconds + 90).slice(0, 20);
  const response = following.find(t => t.speaker !== role);
  if (!response) return null;
  const responseIndex = following.indexOf(response);
  const responseTurns = [];
  for (let index = responseIndex; index < following.length && following[index].speaker === response.speaker; index++) responseTurns.push(following[index]);
  const responseExcerpt = Object.assign(excerpt(response), { quote: responseTurns.map(t => t.text).join(' ') });
  const explanation = typeof analysis.why_outcome === 'string' ? analysis.why_outcome : '';
  // A direct contradiction is a reason to withhold the card, not repair the data.
  if (analysis.outcome === 'closed' && /(?:did not|didn't|failed to|not|never) close|from closing|remained (?:open|unresolved)|no sale/i.test(explanation)) return null;
  if (analysis.outcome !== 'closed' && /(?:the deal|the sale|this call) closed|completed (?:a |the )?close/i.test(explanation)) return null;
  const names = [...new Set(turns.filter(t => t.speaker === 'PROSPECT').map(t => t.display_name).filter(Boolean))];
  let safeExplanation = explanation.replace(/\bBNPL\b/g, 'financing');
  names.forEach(name => { safeExplanation = safeExplanation.split(name).join('the prospect'); });
  const outcomes = new Set(['closed', 'lost', 'follow_up', 'follow-up', 'open', 'disqualified', 'no_show']);
  return {
    outcome: outcomes.has(analysis.outcome) ? analysis.outcome : null,
    // Preserve the call-level explanation as analysis, never infer it from the moment.
    result_explanation: safeExplanation && !/[$£€]|doctrine|knowledge base|manager note|\bKB\b/i.test(safeExplanation) ? safeExplanation : null,
    recording_url: recordingUrl || null,
    moment: excerpt(match.t), response: responseExcerpt,
    // The full following exchange is shown verbatim, not turned into a causal claim.
    following: following.slice(responseIndex + responseTurns.length).map(excerpt),
  };
}
async function attachStrengthEvidence(admin, synthesis, window) {
  const items = synthesis.working || [];
  const ids = [...new Set(items.filter(i => i.call_id && window.meta[i.call_id]).map(i => i.call_id))];
  if (!ids.length) return Object.assign({}, synthesis, { working: [] });
  const result = await admin.from('call_analyses').select('fathom_call_id,outcome,why_outcome,transcript_stored').in('fathom_call_id', ids).eq('status', 'done');
  if (result.error) throw new Error('Strength evidence unavailable');
  const analyses = new Map((result.data || []).map(a => [a.fathom_call_id, a]));
  const working = items.map(item => {
    const meta = window.meta[item.call_id];
    const evidence = meta && buildEvidence(item, analyses.get(item.call_id), meta.recording_url);
    return evidence ? Object.assign({}, item, { call_evidence: Object.assign({}, evidence, { owner_user_id: meta.user_id }) }) : null;
  }).filter(Boolean);
  return Object.assign({}, synthesis, { working });
}
module.exports = { buildEvidence, attachStrengthEvidence };
