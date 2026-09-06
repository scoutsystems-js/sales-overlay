'use strict';
const crypto = require('node:crypto');
const STANDARD = 'agree_day_time_v1';
const STANDARD_TEXT = 'When a sale remains open and further contact is needed, try to agree a specific day and time before ending the call. Don’t flag a confirmed appointment or a prospect who explicitly declines to schedule.';
function policyHash(note) {
  return crypto.createHash('sha256').update(JSON.stringify({id:note.id,content:note.content,standard:note.metadata.manager_followup_standard})).digest('hex');
}
// A structured standard is only attached after manager confirmation. Descriptive
// KB examples cannot authorize it, regardless of what an AI says about them.
function classifyFollowup({facts,outcome,notes,teamOwner}) {
  if (['closed','lost','disqualified','no_show'].includes(outcome)) return {state:'not_applicable'};
  if (outcome !== 'follow_up' || !facts || facts.ending_complete !== true) return {state:'unknown'};
  if (facts.state === 'booked') return {state:'clear'};
  if (facts.state === 'declined' && facts.declined === true) return {state:'not_applicable'};
  if (facts.state === 'no_contact_needed' && facts.further_contact === false) return {state:'not_applicable'};
  if (facts.state !== 'not_booked' || facts.further_contact !== true || facts.declined !== false) return {state:'unknown'};
  const applicable = (notes || []).filter(note => teamOwner && note.id && note.category === 'coaching_correction' && note.scope === 'team' && note.team_owner_id === teamOwner && note.metadata?.manager_followup_standard === STANDARD && note.content === STANDARD_TEXT);
  if (applicable.length !== 1) return {state:'unknown'};
  const policy = applicable[0];
  return {state:'issue',policy_id:policy.id,policy_hash:policyHash(policy)};
}
module.exports = {STANDARD,STANDARD_TEXT,policyHash,classifyFollowup};
