/**
 * THE KNOWLEDGE-BASE MATERIAL EVERY ADVICE LANE READS BEFORE IT SAYS ANYTHING (H731).
 *
 * Justin's governing rule: any coaching, recommendation or anything of the sort must be checked
 * against the knowledge base before it is given to a user — "NOT JUST MAKE IT UP ON THE FLY".
 * Only the grader did this. This is the ONE retrieval every lane that produces advice calls,
 * BEFORE its prompt is finalised:
 *   • the team's offer, qualifications and script — the head's profile, inherited by every rep
 *     (lib/selling-context, H728), plus the team's uploads by category and scope;
 *   • the team's coaching notes (lib/coaching-corrections), keyed to the team head.
 * Scoping is the existing relationship rule (personal → team → global; managed_by → head). A team
 * never sees another team's material. THE SEEDED STARTER SET is excluded by ORIGIN: those 170 rows
 * carry scope NULL and uploaded_by NULL, and every reader here selects by scope (global/personal/
 * team) and by category (user_upload / coaching_correction) — a row with no scope and no uploader
 * matches nothing. That is a stored property, not a reading of their text.
 *
 * IF NOTHING RELEVANT COMES BACK, THE LANE SAYS NOTHING. `hasMaterial` false means the lane must not
 * call the model for advice, must not fall through to generic advice, and must not invent a citation;
 * the surface says so in words (NO_MATERIAL_COPY). ⚠ Two rulings meet here (H728: an offer not on
 * file is not a blocker; H731: nothing relevant → say nothing). The newer one governs the EMPTY
 * case; the team Justin ruled H728 for now has its material on file, so both hold for it.
 */
'use strict';
var { fetchSellingContext, SYNTHESIS_CATEGORIES } = require('./selling-context');
var corrections = require('./coaching-corrections');

var NO_MATERIAL_COPY = 'Scout has nothing on file for this team yet, so it is not coaching from guesswork. Add the offer, qualifications and script on the account page and coaching will use them from the next call on.';

/**
 * @param admin
 * @param opts { userId (whose profile chain — a rep or the head), teamKey (the head id for notes; derived from userId when absent),
 *               lane (tag for logs), maxChars, categories }
 * @returns { contextText, qualifications, notes:{rows,text,hash}, hasMaterial, kbHash, sources }
 */
async function loadKbMaterial(admin, opts) {
  var o = opts || {};
  var selling = await fetchSellingContext(admin, o.userId, o.maxChars, o.categories || SYNTHESIS_CATEGORIES);
  var teamKey = o.teamKey || null;
  if (!teamKey) { try { teamKey = await corrections.teamKeyFor(admin, o.userId); } catch (e) { teamKey = null; } }
  var notes = teamKey ? await corrections.loadCorrectionsSafe(admin, teamKey, o.lane || 'kb-material') : { rows: [], text: '', hash: 'none' };
  var hasContext = !!(selling.contextText && selling.contextText.trim());
  var hasNotes = !!(notes && notes.text && String(notes.text).trim());
  return {
    contextText: hasContext ? selling.contextText : '',
    qualifications: selling.qualifications || null,
    notes: notes || { rows: [], text: '', hash: 'none' },
    hasMaterial: hasContext || hasNotes,
    kbHash: (selling.kbHash || 'none') + '|notes:' + ((notes && notes.hash) || 'none'),
    sources: selling.sources || [],
    teamKey: teamKey,
  };
}

/** The shape a lane returns when it says nothing — one shape for every surface. */
function nothingToSay(extra) {
  return Object.assign({ available: true, no_material: true, copy: NO_MATERIAL_COPY }, extra || {});
}

module.exports = { loadKbMaterial: loadKbMaterial, nothingToSay: nothingToSay, NO_MATERIAL_COPY: NO_MATERIAL_COPY };
