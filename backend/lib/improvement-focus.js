'use strict';
// Team Coaching now presents improvements only (Justin, 2026-09-05).
// Reuse already-written, KB-grounded coaching; no new model call or inferred advice.
const { selectCoachableMoments } = require('./coaching');
const { violatesIsolation, framesDqAsLoss, isDqMoment } = require('./doctrine');
const {VERSION} = require('./coaching-evidence-review');
const { labelFor } = require('./coaching-history');
const SECTION_TOPICS = {intro:'Opening the call', discovery:'Discovery', pitch:'Pitch', objection:'Objection handling', close:'Closing', call:'Call coaching'};
function topicFor(key, moment) { return key.startsWith('objection:') ? labelFor(key) : SECTION_TOPICS[moment.section || 'call'] || 'Call coaching'; }

function selectImprovementFocus(calls, options = {}) {
  const groups = new Map();
  for (const call of calls || []) {
    const hasDq = call.outcome === 'disqualified' || (call.highlights || []).some(isDqMoment);
    for (const moment of selectCoachableMoments(call.highlights)) {
      if (!moment.coaching_review || moment.coaching_review.version !== VERSION || moment.coaching_review.verdict !== 'approved') continue;
      if (options.kbHash !== undefined && moment.coaching_review.kb_hash !== options.kbHash) continue;
      if (options.eligible && !options.eligible(call, moment)) continue;
      const coaching = typeof moment.coaching === 'string' ? moment.coaching.trim() : '';
      if (/nothing to change/i.test(coaching)) continue;
      if (!coaching || !Number.isFinite(moment.timestamp_seconds) || moment.speaker_verified !== true) continue;
      if (violatesIsolation(coaching) || (hasDq && framesDqAsLoss(coaching))) continue;
      if (/doctrine|knowledge base|\bKB\b/i.test(coaching)) continue;
      const key = moment.type === 'objection' && moment.objection_category
        ? 'objection:' + moment.objection_category : 'section:' + (moment.section || 'call');
      const group = groups.get(key) || [];
      if (!group.some(item => item.call_id === call.id)) group.push({
        call_id: call.id, user_id: call.user_id, call_date: call.call_date,
        recording_url: call.recording_url, outcome: call.outcome || null,
        topic: topicFor(key, moment), coaching,
        moment: { ...moment }, kind: 'improvement', direction: 'cost', label: topicFor(key, moment),
      });
      groups.set(key, group);
    }
  }
  const ranked = [...groups.values()].map(items => items.sort((a,b) => String(b.call_date).localeCompare(String(a.call_date))))
    .sort((a,b) => b.length - a.length || String(b[0].call_date).localeCompare(String(a[0].call_date)));
  if (options.all) return ranked.flat();
  return ranked.length ? ranked[0].slice(0,5) : [];
}
module.exports = { selectImprovementFocus };
