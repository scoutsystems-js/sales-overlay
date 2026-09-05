'use strict';
/* lib/coaching-corrections.js — FINE TUNE COACHING (Justin, 2026-09-02).
 *
 * Add-to-Knowledge-Base from the other end. Add-to-KB teaches by EXAMPLE (a
 * moment worth copying); this teaches by CORRECTION: a manager says how their
 * team would rather a moment were handled, Scout extracts the concept behind
 * it, the manager confirms the wording, and it is stored in the TEAM knowledge
 * base where the coaching lane reads it as a heavily weighted example.
 *
 * ⚠⚠ THE DEFECT THIS EXISTS FOR: Scout coached a rep OUT of isolating the
 * objection, twice. A manager can now fix that in one click and Scout learns
 * that isolation is correct FOR THAT TEAM — instead of us editing nine prompts.
 *
 * THE RULINGS IT INHERITS (none re-openable):
 *  - PER-TEAM, NEVER GLOBAL: scope 'team', keyed on team_owner_id. Two managers
 *    can handle the same objection differently and both be right.
 *  - ACCUMULATE, NEVER OVERWRITE: every row is loaded oldest first; identical
 *    concepts collapse on a CONCEPT HASH onto the first, never on recency.
 *  - A HEAVILY WEIGHTED EXAMPLE, NOT A HARD RULE: the prompt lane says the
 *    notes outrank Scout's defaults, and that a moment that was genuinely
 *    different may be said to be so — in a sentence, never silently.
 *  - SUBSTITUTION, NOT SUPPRESSION: the GRADER and the EXTRACTOR never see a
 *    correction. Two independent filters keep it out (the same two that keep
 *    harvested moments out): lib/selling-context.js reads only
 *    category='user_upload' (this writes 'coaching_correction'), and the
 *    metadata category below is in neither GRADER_CATEGORIES nor
 *    SYNTHESIS_CATEGORIES. A manager cannot change a grade by correcting
 *    coaching. Pinned by test/fine-tune-coaching.test.js.
 *  - STRUCTURED AND LINKABLE: `metadata.given_on` carries the call id, the
 *    highlight id and the rep — so a later harvest can ask "did this team's
 *    closes move after this correction" without parsing prose.
 *  - NEW CALLS ONLY: existing coaching is not rewritten.
 */
var crypto = require('crypto');
var createWithUsage = require('./model-usage').usageFor('fine-tune-coaching');
var { CLAUDE_MODEL } = require('../config');

var CATEGORY = 'coaching_correction';           // the category COLUMN — never 'user_upload'
var METADATA_CATEGORY = 'coaching_correction';  // metadata->>'category' — in neither selling-context list
var LABEL = 'Team coaching notes';              // what the KB page shows reps and managers
var EXTRACTION_PROMPT_VERSION = 'v2-2026-09-05-doctrine';   /* v2 (H733): the same ONE call also names the doctrine entry the note speaks to (attachment) and judges the locked pair (refusal, conservative). Was v1-2026-09-02 */
var doctrineLib = require('./doctrine');
var MAX_NOTES_IN_PROMPT = 24;

function normalizeConcept(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').replace(/[.!\s]+$/g, '').trim();
}
function conceptHash(concept) {
  var n = normalizeConcept(concept);
  return n ? crypto.createHash('sha1').update(n).digest('hex') : null;
}

/* The rep's team key: their manager, or themselves when they manage. The same
   rule lib/kb-scope.js reads with (COALESCE(team_owner_id, uploaded_by)). */
async function teamKeyFor(admin, userId) {
  if (!userId) return null;
  var p = await admin.from('user_profiles').select('managed_by').eq('user_id', userId).maybeSingle();
  if (p.error) throw new Error('user_profiles: ' + p.error.message);
  return (p.data && p.data.managed_by) || userId;
}

/* Every correction for a team, oldest first, deduped on the concept hash. */
async function loadCorrections(admin, teamKey) {
  if (!teamKey) return { rows: [], text: '', hash: 'none' };
  var q = await admin.from('knowledge_base')
    .select('id, content, metadata, created_at, uploaded_by, team_owner_id')
    .eq('category', CATEGORY).eq('team_owner_id', teamKey).order('created_at', { ascending: true });
  if (q.error) throw new Error('knowledge_base: ' + q.error.message);
  var rows = (q.data || []).slice().sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
  var seen = {}, out = [];
  rows.forEach(function (r) {
    var h = (r.metadata && r.metadata.concept_hash) || conceptHash(r.content) || r.id;
    if (seen[h]) return;             // the FIRST statement of a concept stands
    seen[h] = true; out.push(r);
  });
  var shown = out.slice(0, MAX_NOTES_IN_PROMPT);
  var text = shown.map(function (r, i) {
    var when = r.created_at ? String(r.created_at).slice(0, 10) : '';
    return (i + 1) + '. ' + String(r.content || '').trim() + (when ? ' (a manager correction, ' + when + ')' : '');
  }).join('\n');
  var hash = out.length ? crypto.createHash('md5').update(out.map(function (r) { return r.id + ':' + (r.created_at || ''); }).join('|')).digest('hex') : 'none';
  return { rows: out, text: text, hash: hash };
}

function buildCorrectionRow(opts) {
  var o = opts || {};
  var target = o.target || {};
  var concept = (typeof o.concept === 'string' && o.concept.trim()) ? o.concept.trim() : null;
  var feedback = (typeof o.feedback === 'string') ? o.feedback.trim() : '';
  var g = o.givenOn || {};
  return {
    category: CATEGORY,
    label: LABEL,
    /* The concept is what the model reads. When extraction failed the
       manager's own words stand in — never dropped, and the page says so. */
    content: concept || feedback,
    triggers: [],
    metadata: {
      category: METADATA_CATEGORY,
      concept: concept,
      concept_hash: conceptHash(concept || feedback),
      feedback: feedback,
      subject: o.subject || null,
      direction: o.direction || null,
      objection_category: o.objectionCategory || null,
      given_on: {
        surface: g.surface || 'call_review_moment',
        fathom_call_id: g.fathomCallId || null,
        highlight_id: g.highlightId || null,
        rep_user_id: g.repUserId || null,
        moment_type: g.momentType || null,
        section: g.section || null,
        coaching_snapshot: g.coachingSnapshot || null,
        quote: g.quote || null,
      },
      added_by: o.addedBy || null,
      extraction: o.extraction || null,
      /* H733 — THE ATTACHMENT, STORED AND INSPECTABLE (never implicit in an embedding): the doctrine entries this
         note speaks to, first = primary. Empty = attaches to nothing and is team material exactly as before.
         locked_review = the extraction thought it MIGHT contradict a locked rule but was not sure: stored, on record. */
      doctrine_key: (Array.isArray(o.doctrine) && o.doctrine[0]) ? o.doctrine[0].key : null,
      doctrine_keys: Array.isArray(o.doctrine) ? o.doctrine.map(function (d) { return d.key; }) : [],
      doctrine_titles: Array.isArray(o.doctrine) ? o.doctrine.map(function (d) { return d.title; }) : [],
      locked_review: o.lockedReview || null,
    },
    embedding: o.embedding === undefined ? null : o.embedding,
    uploaded_by: target.uploaded_by || null,
    scope: 'team',
    team_owner_id: target.team_owner_id || null,
    source_label: LABEL,
    source_fathom_call_id: g.fathomCallId || null,
    source_section: g.section || null,
    source_quote_hash: null,   // opts out of the harvested-moment dedupe index; dedupe is the concept hash
  };
}

function extractionPrompt(o) {
  var m = o.moment || {};
  return [
    'A sales manager has corrected a piece of AI coaching. Extract the CONCEPT behind the correction — the preference this manager holds for their team — so it can guide future coaching on this team.',
    '',
    'THE MOMENT (from a real sales call):',
    'Prospect said: ' + (m.quote || '(not recorded)'),
    m.closer_response ? 'Closer replied: ' + m.closer_response : '',
    m.observation ? 'What was observed: ' + m.observation : '',
    m.type ? 'Moment type: ' + m.type + (m.section ? ' (' + m.section + ')' : '') : '',
    '',
    'THE COACHING SCOUT WROTE FOR IT:',
    o.coaching || '(none recorded)',
    '',
    'THE MANAGER\'S CORRECTION, VERBATIM:',
    o.feedback,
    '',
    /* H733 — THE SAME CALL DOES TWO MORE THINGS, so no second call exists: it names which entry of Scout's method the
       note speaks to (attachment — stored, inspectable), and it judges whether the note contradicts one of the two
       locked rules. The judgement is CONSERVATIVE: "sure" only when the note plainly instructs the forbidden thing;
       a wrongly refused manager is worse than a note that slips through to the code-level guards. */
    (o.doctrine && o.doctrine.units && o.doctrine.units.length ? [
      '',
      'SCOUT\'S METHOD has these entries (key: title). Name the entry this correction speaks to in "doctrine_keys" — the most relevant first, a second only if it genuinely speaks to two; an empty list if it speaks to none:',
    ].concat(doctrineLib.entryList(o.doctrine).map(function (e) { return '  - ' + e; })).concat([
      '',
      'TWO RULES ARE LOCKED and a correction may never override them: (1) never coach a rep out of isolating an objection; (2) never treat a financial disqualification (a prospect who genuinely cannot afford the offer) as a lost deal or a failed close.',
      'In "locked_conflict", say whether this correction CONTRADICTS one: "rule" is "isolation", "dq_loss" or null; "sure" is true ONLY when the correction plainly instructs reps to do the forbidden thing (e.g. "don\'t isolate, just answer it"; "count a can\'t-afford as a lost deal"). A correction that says to isolate MORE, or to qualify HARDER, does not conflict. When you are not sure, set "sure": false — the note will be kept. "reason" is one plain sentence a manager can read.',
    ]).join('\n') : ''),
    '',
    'Write the concept as ONE sentence beginning "On this team, …" — a preference about how closers should handle this kind of moment, stated as a principle, not a script. Never name the prospect. Never invent anything the manager did not say; if the correction is about this one moment only, say the principle it implies and nothing more.',
    'Return ONLY this JSON, no prose:',
    '{"concept":"On this team, ...","subject":"objection|discovery|pitch|close|intro|other","direction":"prefer|avoid","objection_category":"fear|timing|partner|logistical|uncategorized|null","doctrine_keys":["<key>"],"locked_conflict":{"rule":"isolation|dq_loss|null","sure":false,"reason":"..."}}',
  ].filter(Boolean).join('\n');
}

/* ONE model call, on its own lane in model_usage (attribution, not cost, is
   the concern — a new call invisible in the per-lane split is how the next
   cost question becomes unanswerable). A bad answer is a null concept and a
   reason, never a throw: the manager's words are stored either way. */
async function extractConcept(o) {
  var out = { ok: false, concept: null, subject: null, direction: null, objection_category: null, reason: null, usage: null, doctrine: [], locked_conflict: null };
  try {
    var resp = await createWithUsage({ model: CLAUDE_MODEL, max_tokens: 300, messages: [{ role: 'user', content: extractionPrompt(o) }] },
      { userId: o.userId || null, callId: (o.moment && o.moment.fathom_call_id) || null, lane: 'fine-tune-coaching' });
    var text = (resp && resp.content || []).map(function (c) { return c.text || ''; }).join('');
    var m = text.match(/\{[\s\S]*\}/);
    var parsed = m ? JSON.parse(m[0]) : null;
    if (!parsed || typeof parsed.concept !== 'string' || !parsed.concept.trim()) { out.reason = 'no concept in the answer'; return out; }
    out.ok = true;
    out.concept = parsed.concept.trim().slice(0, 600);
    out.subject = typeof parsed.subject === 'string' ? parsed.subject : null;
    out.direction = typeof parsed.direction === 'string' ? parsed.direction : null;
    out.objection_category = (typeof parsed.objection_category === 'string' && parsed.objection_category !== 'null') ? parsed.objection_category : null;
    /* H733: attachment keys kept only where they name a real entry; the locked judgement kept only in its closed shape. */
    out.doctrine = doctrineLib.validKeys(o.doctrine, parsed.doctrine_keys);
    var lc = parsed.locked_conflict;
    if (lc && typeof lc === 'object' && (lc.rule === 'isolation' || lc.rule === 'dq_loss')) out.locked_conflict = { rule: lc.rule, sure: lc.sure === true, reason: (typeof lc.reason === 'string') ? lc.reason.slice(0, 300) : null };
    out.usage = { model: CLAUDE_MODEL, prompt_version: EXTRACTION_PROMPT_VERSION,
      input_tokens: resp && resp.usage ? resp.usage.input_tokens : null, output_tokens: resp && resp.usage ? resp.usage.output_tokens : null };
    return out;
  } catch (e) {
    out.reason = (e && e.message) || 'unknown';
    return out;
  }
}

/* ⚠⚠ ONE WORDING FOR EVERY LANE THAT READS THE NOTES (2026-09-02). Five copies
   of a prompt lane is the two-things-answering-one-question defect waiting to
   happen. The 7c coaching pass adds one sentence (`applied: true`) asking
   which notes were applied, because it stores that as a checkable field. */
function promptLane(text, opts) {
  var t = (text || '').trim();
  if (!t) return '';
  var lines = [
    '\u26a0\u26a0 MANAGER NOTES \u2014 THIS TEAM\'S OWN CORRECTIONS. This team\'s sales manager corrected',
    'earlier coaching, and these are the concepts behind those corrections:',
    t,
    'These notes outrank your defaults: on this team they are what good looks like.',
    'A note printed under an entry of Scout\'s method above wins on the point where the two conflict; the rest of that entry stands.',
    'Treat each one as a heavily weighted example, not a hard rule \u2014 if a specific',
    'moment was genuinely different, say so in one sentence rather than silently',
    'ignoring the note. Never coach against a note without naming which one and why.',
  ];
  if (opts && opts.applied) {
    lines.push('For each moment, list the numbers of the notes you applied in',
               '"applied_manager_notes" (an empty list if none applied).');
  }
  return lines.join('\n');
}

/* The loader every lane should call: a read failure means "coach without
   notes, and say so in the log" — never a failed page. */
async function loadCorrectionsSafe(admin, teamKey, laneTag) {
  try { return await loadCorrections(admin, teamKey); }
  catch (e) { console.warn('[' + (laneTag || 'coaching-corrections') + '] manager notes unavailable (' + ((e && e.message) || 'unknown') + ') \u2014 continuing without them'); return { rows: [], text: '', hash: 'none' }; }
}

module.exports = {
  CATEGORY: CATEGORY, METADATA_CATEGORY: METADATA_CATEGORY, LABEL: LABEL,
  EXTRACTION_PROMPT_VERSION: EXTRACTION_PROMPT_VERSION,
  conceptHash: conceptHash, teamKeyFor: teamKeyFor, loadCorrections: loadCorrections,
  buildCorrectionRow: buildCorrectionRow, extractConcept: extractConcept, _extractionPrompt: extractionPrompt,
  promptLane: promptLane, loadCorrectionsSafe: loadCorrectionsSafe,
};
