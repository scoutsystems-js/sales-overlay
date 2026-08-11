// lib/kb-entry.js — turning a call highlight into a knowledge_base entry.
// KB Part 2, sub-stage 2b (the manual "Add to Knowledge Base" button) and the
// shared foundation 2d's auto-population will reuse verbatim.
//
// ── RULING 1 ENFORCEMENT (do not change casually) ─────────────────────────
// Harvested call material must NEVER reach the grader in v1. Two independent
// filters in lib/selling-context.js keep it out, and BOTH depend on choices made
// here + in the route:
//   (a) fetchSellingContext filters `category = 'user_upload'`. The route writes
//       the category COLUMN as 'learned_pattern', so these rows never enter the
//       candidate set at all.
//   (b) GRADER_CATEGORIES / SYNTHESIS_CATEGORIES gate metadata->>'category'.
//       KB_ENTRY_METADATA_CATEGORY below is deliberately absent from both lists.
// Either filter alone is sufficient; both are present on purpose so that
// "fixing" one in isolation cannot silently open the loop. Pinned by
// kb-entry.test.js ("RULING 1: metadata category is NOT a grader- or
// synthesis-visible category").
//
// ── The dedupe key ────────────────────────────────────────────────────────
// (uploaded_by, source_fathom_call_id, source_section, source_quote_hash),
// enforced by the partial unique index in migration 030.
//
// It is deliberately NOT keyed on the highlight id. persistHighlights is
// insert-new-then-delete-old, so EVERY re-analysis reissues fresh ids for the
// same moments — an id-keyed index would look correct and silently readmit a
// duplicate on the next re-grade.
//
// KNOWN LIMIT, stated honestly: the key is stable against row-id reissue (the
// actual failure mode) but NOT against the model re-wording a quote on
// re-extraction. If a re-analysis produces "It costs too much" where it once
// produced "It just costs too much", that is a different hash and a second entry.
// Normalization below absorbs case/whitespace/wrapping-quote/trailing-punctuation
// drift, which covers the common variation; semantic near-duplicates are out of
// scope for 2b and would need embedding-similarity dedupe.

const crypto = require('crypto');

// The metadata content-type for a harvested call moment. MUST stay out of
// GRADER_CATEGORIES and SYNTHESIS_CATEGORIES — see ruling 1 above.
var KB_ENTRY_METADATA_CATEGORY = 'call_moment';

// Normalize a quote for hashing. Absorbs the drift that does NOT change meaning:
// case, surrounding whitespace, internal whitespace runs, wrapping quote marks,
// trailing sentence punctuation. Internal punctuation is KEPT — it can be the
// only thing distinguishing two genuinely different moments ("I can, sometimes"
// vs "I can sometimes"), and over-normalizing would merge distinct material.
function normalizeQuote(v) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[“”‘’]/g, "'")  // smart quotes → straight
    .trim()
    .replace(/^['"]+|['"]+$/g, '')                 // wrapping quote marks
    .trim()
    .replace(/[.!?,;:\s]+$/g, '')                  // trailing punctuation
    .replace(/\s+/g, ' ')                          // whitespace runs
    .toLowerCase()
    .trim();
}

// sha1 of the normalized quote, or null when there is nothing to hash. null is
// important: a blank hash would put every quote-less moment in one bucket and
// the unique index would swallow legitimate adds. The index is partial
// (WHERE source_quote_hash IS NOT NULL) so nulls simply opt out of dedupe.
function quoteHash(v) {
  var n = normalizeQuote(v);
  if (!n) return null;
  return crypto.createHash('sha1').update(n).digest('hex');
}

// Prose rendering of the moment — what gets embedded and what a coach reads back.
// Mirrors the shape /kb/store-patterns already uses for learned_pattern rows so
// the two are visually consistent in the KB list.
function buildEntryContent(h) {
  var hl = h || {};
  var section = (typeof hl.section === 'string' && hl.section) ? hl.section : 'call';
  var speaker = (typeof hl.speaker === 'string' && hl.speaker) ? hl.speaker : 'SPEAKER';
  var quote = (typeof hl.quote === 'string') ? hl.quote.trim() : '';
  var observation = (typeof hl.observation === 'string') ? hl.observation.trim() : '';
  var response = (typeof hl.closer_response === 'string') ? hl.closer_response.trim() : '';

  var parts = ['During ' + section + ', ' + speaker + ' said: "' + quote + '".'];
  if (observation) parts.push('What happened: ' + observation + '.');
  if (response) parts.push('The closer responded: "' + response + '".');
  if (hl.resolution) parts.push('Outcome: ' + hl.resolution + '.');
  return parts.join(' ');
}

// Which knowledge base this write lands in (ruling 5).
//   • acting on YOUR OWN call        → your own KB (personal), whatever your role
//   • manager/owner on a REP's call  → the TEAM KB (this is the promotion path)
//   • plain rep on someone else's    → refused
// callerScope is resolveUserScope()'s output; callOwnerId is the call's user_id.
// The caller's AUTHORITY over that rep is checked separately in the route (a
// manager may only act on their own reps) — this decides the target, not access.
function resolveEntryTarget(callerScope, callOwnerId) {
  if (!callerScope || !callOwnerId) return { ok: false, error: 'Missing caller or call owner' };

  if (callOwnerId === callerScope.p_user_id) {
    return { ok: true, target: { scope: 'personal', team_owner_id: null, uploaded_by: callerScope.p_user_id } };
  }
  if (callerScope.role === 'manager' || callerScope.role === 'owner') {
    if (!callerScope.p_admin_id) return { ok: false, error: 'You have no team to add this to.' };
    return { ok: true, target: { scope: 'team', team_owner_id: callerScope.p_admin_id, uploaded_by: callerScope.p_user_id } };
  }
  return { ok: false, error: 'You can only add moments from your own calls.' };
}

// Build the knowledge_base row for a harvested moment. THE single row shape —
// POST /kb/from-highlight (manual, source 'manual_add') and the analysis worker
// (auto-population, source 'auto_closed_call') both go through here, so there is
// ONE insert implementation with two callers (ruling 2, 2c).
//
// The two category choices below are what enforce ruling 1. Changing either
// exposes harvested material to the grader — see the header of this file and
// test/kb-hash-guard.test.js.
function buildMomentRow(opts) {
  var h = opts.highlight || {};
  var target = opts.target;
  var section = opts.section !== undefined ? opts.section : (h.section || null);
  var label = (target.scope === 'team') ? 'Team call moments' : 'My call moments';

  return {
    category: 'learned_pattern',              // RULING 1 — filter (a)
    label: label,
    content: buildEntryContent(h),
    triggers: [],
    metadata: {
      category: KB_ENTRY_METADATA_CATEGORY,   // RULING 1 — filter (b)
      source: opts.source,
      section: section,
      type: h.type || null,
      resolution: h.resolution || null,
      speaker: h.speaker || null,
      // Is this speaker PROVEN, or is it the model's guess?
      // 6b had to repair harvested rows (some of them prospect quotes filed as
      // the rep's own winning material) precisely because nothing recorded that
      // the label was a guess.
      //
      // The highlight's OWN verdict wins when present: a call can be matched
      // overall while an individual quote is paraphrased and therefore not
      // reconstructible from the transcript. Trusting the call-level flag alone
      // would stamp such a moment "verified" on the strength of its neighbours.
      // Falls back to call-level confidence for rows predating migration 034,
      // and fails closed in every other case.
      speaker_verified: (typeof h.speaker_verified === 'boolean')
        ? h.speaker_verified
        : opts.speakerConfidence === 'matched',
      quote: h.quote || null,
      observation: h.observation || null,
      closer_response: h.closer_response || null,
      timestamp_seconds: (typeof h.timestamp_seconds === 'number') ? h.timestamp_seconds : null,
      source_fathom_call_id: opts.fathomCallId,
      source_highlight_id: h.id || null,      // provenance only — NEVER the dedupe key
      source_user_id: opts.sourceUserId || null,
      added_by: opts.addedBy || null,
    },
    embedding: opts.embedding === undefined ? null : opts.embedding,
    uploaded_by: target.uploaded_by,
    scope: target.scope,
    team_owner_id: target.team_owner_id,
    source_label: label,
    source_fathom_call_id: opts.fathomCallId,
    source_section: section,
    source_quote_hash: quoteHash(h.quote),
  };
}

// Insert a built row, translating the dedupe index into a normal outcome.
// Returns { added, duplicate, error } and NEVER throws — a KB write must never
// be able to fail its caller (critical for the worker, per the house rule that
// a KB problem can never fail or stall an analysis).
async function insertMoment(admin, row) {
  try {
    var res = await admin.from('knowledge_base').insert(row);
    if (res && res.error) {
      // 23505 = knowledge_base_call_moment_dedupe_idx. The moment is already in
      // this KB — from an earlier manual click or a prior auto-population run.
      // Idempotent success, not an error. This is the mechanism that makes the
      // manual button and auto-population safe to run over each other.
      if (res.error.code === '23505') return { added: false, duplicate: true };
      return { added: false, duplicate: false, error: String(res.error.message || 'unknown').slice(0, 200) };
    }
    return { added: true, duplicate: false };
  } catch (err) {
    return { added: false, duplicate: false, error: (err && err.message) || 'unknown' };
  }
}

module.exports = {
  normalizeQuote: normalizeQuote,
  quoteHash: quoteHash,
  buildEntryContent: buildEntryContent,
  resolveEntryTarget: resolveEntryTarget,
  buildMomentRow: buildMomentRow,
  insertMoment: insertMoment,
  KB_ENTRY_METADATA_CATEGORY: KB_ENTRY_METADATA_CATEGORY,
};
