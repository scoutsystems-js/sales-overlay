/**
 * SCOUT'S DOCTRINE — the method Scout coaches from (H732, Justin's ruling 2026-09-05).
 *
 * DOCTRINE IS METHOD, NOT TEAM MATERIAL, AND THE TWO ARE NEVER INTERCHANGEABLE. Team material is what
 * a team sells (offer, qualifications, script, uploads, notes) — per team. Doctrine is how Scout
 * judges anyone (what an objection is, the five types, the money boundary, discovery as the upstream
 * cause, isolation, tying back in) — global, inherited by every team that will ever exist.
 *   • Doctrine loads at GLOBAL scope as ELEVEN retrievable units (category 'doctrine', one row per
 *     entry, metadata.key), never one document, never split below an entry.
 *   • Doctrine NEVER satisfies the "has material" check (lib/kb-material): a team with no offer, no
 *     qualifications and no script still gets the empty-state sentence and no coaching. Doctrine says
 *     HOW to judge; it does not supply WHAT this team sells.
 *   • In a prompt, doctrine is a CONSTRAINT on the reasoning, never evidence to quote; no user-facing
 *     string says "per the doctrine".
 * TWO HARD RULES are enforced IN CODE here as well as stated in the prompt:
 *   • never coach a rep out of isolating an objection — `violatesIsolation(text)` drops the coaching
 *     entry (a pattern check; it catches the shapes we have seen, not every possible phrasing);
 *   • never treat a financial disqualification as a lost deal or a failed close — a `disqualify_signal`
 *     moment and an objection classed `disqualification` are never coached at all (`excludesDq`), and
 *     coaching text that frames a DQ as a loss is dropped (`framesDqAsLoss`).
 * The units are parsed from doctrine/scout-doctrine.md (the source of truth, in git) — "## N · Title"
 * headings, the body to the next heading. Pure except loadDoctrine.
 */
'use strict';
var fs = require('fs'); var path = require('path'); var crypto = require('crypto');

var DOCTRINE_VERSION = 'v1-2026-09-05';
var CATEGORY = 'doctrine';
var SOURCE_LABEL = 'Scout Coaching Doctrine';

/** Parse the markdown into units: [{ order, key, title, text }]. */
function parseDoctrine(md) {
  var lines = String(md || '').split('\n'); var units = []; var cur = null;
  lines.forEach(function (line) {
    var m = /^## (\d+) · (.+)$/.exec(line.trim());
    if (m) { if (cur) units.push(cur); cur = { order: Number(m[1]), title: m[2].trim(), body: [] }; return; }
    if (cur) { if (/^---\s*$/.test(line.trim())) return; cur.body.push(line); }
  });
  if (cur) units.push(cur);
  return units.map(function (u) {
    var text = u.body.join('\n').trim();
    return { order: u.order, key: u.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), title: u.title, text: text };
  }).filter(function (u) { return u.text.length > 0; });
}
function readDoctrineFile() { return parseDoctrine(fs.readFileSync(path.join(__dirname, '..', 'doctrine', 'scout-doctrine.md'), 'utf8')); }

/** The rows as stored: one per unit, global scope, origin = the category and metadata.doctrine. */
function doctrineRows(units) {
  return units.map(function (u) {
    return { category: CATEGORY, label: u.title, content: u.title + '\n\n' + u.text, triggers: [], scope: 'global', uploaded_by: null, team_owner_id: null,
      source_label: SOURCE_LABEL, metadata: { doctrine: true, key: u.key, order: u.order, version: DOCTRINE_VERSION, category: CATEGORY } };
  });
}

/** Load the units from the knowledge base (global scope, category doctrine), ordered. */
async function loadDoctrine(admin) {
  var q = await admin.from('knowledge_base').select('id, label, content, metadata, created_at').eq('category', CATEGORY).eq('scope', 'global');
  if (q.error) throw new Error('knowledge_base doctrine: ' + q.error.message);
  var units = (q.data || []).map(function (r) { var m = r.metadata || {}; return { id: r.id, order: m.order || 0, key: m.key || null, title: r.label, text: String(r.content || '').replace(/^[^\n]*\n\n/, ''), version: m.version || null }; })
    .sort(function (a, b) { return a.order - b.order; });
  var hash = units.length ? crypto.createHash('sha1').update(units.map(function (u) { return u.id + ':' + (u.version || ''); }).join('|')).digest('hex') : 'none';
  return { units: units, hash: hash };
}

/* Which units each lane reads — a lane surfaces whole units, never fragments. */
var LANE_KEYS = {
  coaching:               ['what_an_objection_is', 'the_five_objection_types', 'the_three_way_boundary_on_money', 'discovery_is_the_upstream_cause_of_every_objection', 'isolation_is_the_correct_first_move', 'tying_back_in', 'follow_ups', 'how_coaching_is_written', 'what_scout_must_never_do'],
  'objection-synthesis':  ['what_an_objection_is', 'the_five_objection_types', 'the_three_way_boundary_on_money', 'discovery_is_the_upstream_cause_of_every_objection', 'isolation_is_the_correct_first_move', 'how_coaching_is_written', 'what_scout_must_never_do'],
  'team-objection-summary': ['what_an_objection_is', 'the_five_objection_types', 'the_three_way_boundary_on_money', 'discovery_is_the_upstream_cause_of_every_objection', 'isolation_is_the_correct_first_move', 'how_coaching_is_written', 'what_scout_must_never_do'],
  'team-synthesis':       ['discovery_is_the_upstream_cause_of_every_objection', 'tying_back_in', 'follow_ups', 'closing_percentage_counts_prospects_not_calls', 'how_coaching_is_written', 'what_good_looks_like', 'what_scout_must_never_do'],
  'performance-synthesis': ['discovery_is_the_upstream_cause_of_every_objection', 'tying_back_in', 'follow_ups', 'closing_percentage_counts_prospects_not_calls', 'how_coaching_is_written', 'what_good_looks_like', 'what_scout_must_never_do'],
  'team-digest':          ['follow_ups', 'closing_percentage_counts_prospects_not_calls', 'how_coaching_is_written', 'what_good_looks_like', 'what_scout_must_never_do'],
};
function unitsFor(doctrine, lane) {
  var keys = LANE_KEYS[lane]; var units = (doctrine && doctrine.units) || [];
  if (!keys) return units;
  return units.filter(function (u) { return keys.indexOf(u.key) !== -1; });
}
/* ── THE LOCKED PAIR (Justin, 2026-09-05; H733). Two rules no manager note overrides. A fine-tune that
   contradicts either is REFUSED with the reason shown at the moment they submit it — never silently
   accepted, never silently dropped. Everything else in the doctrine is the manager's to change. */
var LOCKED_RULES = [
  { id: 'isolation', text: 'Never coach a rep out of isolating an objection.' },
  { id: 'dq_loss',   text: 'Never treat a financial disqualification as a lost deal or a failed close.' },
];
/** The sentence the manager reads when a note is refused. Plain words; no mechanism. */
function lockedRefusalText(ruleId, modelReason) {
  if (!LOCKED_RULES.some(function (x) { return x.id === ruleId; })) return null;
  var head = ruleId === 'isolation'
    ? 'Scout can\'t keep this note: it would coach your reps out of isolating an objection, and Scout never does that. Isolating is the correct first move. What happens after the isolation is yours to coach.'
    : 'Scout can\'t keep this note: it would treat a prospect who genuinely can\'t afford the offer as a lost deal, and Scout never does that. That miss is coached upstream, on qualification. How your reps qualify is yours to coach.';
  var read = modelReason ? ' What Scout read in it: ' + String(modelReason).trim().replace(/\.?$/, '.') : '';
  return head + read;
}

/** The prompt block: a constraint on the reasoning, never evidence to quote.
 *  H733 — THE MANAGER'S VOICE ON TOP: a team note that ATTACHES to an entry (metadata.doctrine_keys, set at
 *  write time by the one extraction call and stored, so it is inspectable) is printed BENEATH that entry, and
 *  the block says the note wins on the point where the two conflict and the rest of the entry stands. A note
 *  that attaches to nothing stays team material exactly as before (attachment is an enhancement, never a
 *  gate). A note that speaks to two entries is printed under both. The locked pair is restated as absolute. */
function attachedNotes(notes, key) {
  return (Array.isArray(notes) ? notes : []).filter(function (n) {
    var m = (n && n.metadata) || {}; var keys = Array.isArray(m.doctrine_keys) ? m.doctrine_keys : (m.doctrine_key ? [m.doctrine_key] : []);
    return keys.indexOf(key) !== -1;
  });
}
function doctrineBlock(doctrine, lane, notes) {
  var units = unitsFor(doctrine, lane);
  if (!units.length) return '';
  var anyAttached = units.some(function (u) { return attachedNotes(notes, u.key).length > 0; });
  var head = 'SCOUT\'S METHOD — how to judge what you read below. It governs your reasoning; it is NOT evidence, never cite it, never mention it, never quote it to the reader. Where this team\'s own material below says something more specific, the team\'s material governs the specifics and this governs the judgement.';
  if (anyAttached) head += '\nWhere THIS TEAM\'S MANAGER has written a note under an entry, the manager\'s note WINS on the point where the two conflict and the rest of the entry stands unchanged — it is their team. Two rules are never overridden by any note: ' + LOCKED_RULES.map(function (r) { return r.text; }).join(' ');
  return [head].concat(units.map(function (u) {
    var att = attachedNotes(notes, u.key);
    var body = '· ' + u.title + '\n' + u.text;
    if (att.length) body += '\n  THIS TEAM\'S MANAGER ON THIS POINT (wins where it conflicts with the entry above):' + att.map(function (n, i) { return '\n  ' + (i + 1) + '. ' + String(n.content || '').trim(); }).join('');
    return body;
  })).join('\n\n');
}
/** For the extraction prompt: the entries a note can attach to. */
function entryList(doctrine) { return ((doctrine && doctrine.units) || []).map(function (u) { return u.key + ': ' + u.title; }); }
/** Keys a client or a model handed back, kept only where they name a real entry — never trusted raw. */
function validKeys(doctrine, keys) {
  var known = {}; ((doctrine && doctrine.units) || []).forEach(function (u) { known[u.key] = u.title; });
  var out = []; (Array.isArray(keys) ? keys : []).forEach(function (k) { if (typeof k === 'string' && known[k] && out.indexOf(k) === -1) out.push(k); });
  return out.slice(0, 2).map(function (k) { return { key: k, title: known[k] }; });
}

/* ── the two hard rules, in code ── */
var ISOLATION_PATTERNS = [/instead of isolat/i, /rather than isolat/i, /don'?t isolate/i, /do not isolate/i, /stop isolating/i, /skip(?:ping)? (?:the )?isolat/i, /without isolating/i, /no need to isolate/i, /avoid isolat/i, /isolating .{0,40}(?:was|is) (?:a )?(?:mistake|wrong|unnecessary)/i];
function violatesIsolation(text) { var t = String(text || ''); return ISOLATION_PATTERNS.some(function (p) { return p.test(t); }); }
var DQ_LOSS_PATTERNS = [/lost (?:the )?(?:deal|sale)/i, /failed (?:to )?close/i, /failed close/i, /blew (?:the )?(?:close|deal)/i, /cost (?:you )?the (?:deal|sale|close)/i, /should have closed/i,
  /* H733: the opening-line shapes — "This call was lost", "you lost this one", "a lost deal", "a loss" */
  /\b(?:call|deal|sale|one) was lost\b/i, /\blost this (?:call|deal|sale|one)\b/i, /\ba lost (?:call|deal|sale)\b/i, /\bthis (?:call|deal|sale) (?:was|is) a loss\b/i, /\bcounts? as (?:a )?(?:loss|lost)\b/i, /\blos(?:e|ing) (?:the |this |a )?(?:deal|sale)s?\b/i];
function framesDqAsLoss(text) { var t = String(text || ''); return DQ_LOSS_PATTERNS.some(function (p) { return p.test(t); }); }
function isDqMoment(h) { return !!h && (h.type === 'disqualify_signal' || (h.type === 'objection' && h.objection_class === 'disqualification')); }

/* ── H733: A DISQUALIFIED PROSPECT IS NEVER A LOST DEAL, ON EVERY ADVICE LANE — the coaching side only. The
   stored outcome is untouched (`disqualified` is manual-only, H454); what changes is what a lane is TOLD and
   what it may SAY. A call "carries a disqualification" when any of its moments is a DQ moment (isDqMoment) or
   its outcome is the manual `disqualified`. The extractor emits `disqualify_signal` for "cannot afford" AND
   "the offer does not apply" alike and the row does not say which — the doctrine's reasoning (this person
   should not have been sold to; there was no deal to lose) holds for both, so the condition is any DQ. */
function outcomeForAdvice(outcome, hasDq) { return (hasDq && (outcome === 'lost' || outcome === 'disqualified')) ? 'disqualified' : outcome; }
/** What a lane knows about its input set: which calls carry a DQ, which were lost, and whether EVERY loss in
 *  the set is a DQ (then any loss framing in unattributed prose can only be about a DQ). */
function lossScope(analyses, highlights) {
  var dq = {}, lost = {};
  (Array.isArray(highlights) ? highlights : []).forEach(function (h) { if (isDqMoment(h) && h.fathom_call_id) dq[h.fathom_call_id] = 1; });
  (Array.isArray(analyses) ? analyses : []).forEach(function (a) {
    if (!a || !a.fathom_call_id) return;
    if (a.outcome === 'disqualified') dq[a.fathom_call_id] = 1;
    if (a.outcome === 'lost') lost[a.fathom_call_id] = 1;
  });
  var lostIds = Object.keys(lost), dqIds = Object.keys(dq);
  return { dqCalls: dq, lostCalls: lost, hasDq: dqIds.length > 0,
    allLossesAreDq: dqIds.length > 0 && lostIds.every(function (id) { return dq[id]; }) };
}
/** The loss rule on a piece of written text: drop it (null) when it frames a loss AND the loss is attributable
 *  to a disqualified prospect — the text cites a DQ call, or the text is unattributed and every loss in its
 *  scope is a DQ. Otherwise the text stands: on a set with real losses, "lost the deal" is an honest sentence. */
function enforceLossRule(text, scope, callId, laneTag) {
  var t = String(text || ''); if (!t.trim() || !scope) return text;
  var attributable = callId ? !!scope.dqCalls[callId] : !!scope.allLossesAreDq;
  if (attributable && framesDqAsLoss(t)) { console.warn('[' + (laneTag || 'doctrine') + '] dropped (frames a disqualification as a loss): ' + t.slice(0, 120)); return null; }
  return text;
}
/* A manager NOTE that plainly contradicts a locked rule — the code-level check on the stored wording (the model's
   judgement runs at the first step; this runs on the words the manager finally saves, with no second model call).
   CONSERVATIVE BY DESIGN: only unmistakable phrasings; when unsure, the note is stored. */
var NOTE_DQ_LOSS_PATTERNS = [/(?:disqualif|can'?t afford|cannot afford|no money|broke)[^.]{0,80}\b(?:is|as|counts? as|treat(?:ed)? as|score(?:d)? as|=)\s+(?:a |the )?(?:lost deal|lost sale|loss|failed close|lost)\b/i,
  /\b(?:treat|score|count|coach)\b[^.]{0,60}(?:disqualif|can'?t afford|cannot afford)[^.]{0,60}\b(?:lost deal|lost sale|a loss|failed close|as lost)\b/i];
function noteContradictsLocked(text) {
  var t = String(text || '');
  if (violatesIsolation(t)) return { rule: 'isolation', reason: 'the note tells reps not to isolate' };
  if (NOTE_DQ_LOSS_PATTERNS.some(function (p) { return p.test(t); })) return { rule: 'dq_loss', reason: 'the note treats a prospect who cannot afford the offer as a lost deal' };
  return null;
}

module.exports = { DOCTRINE_VERSION: DOCTRINE_VERSION, CATEGORY: CATEGORY, SOURCE_LABEL: SOURCE_LABEL, parseDoctrine: parseDoctrine, readDoctrineFile: readDoctrineFile, doctrineRows: doctrineRows, loadDoctrine: loadDoctrine, unitsFor: unitsFor, doctrineBlock: doctrineBlock, LANE_KEYS: LANE_KEYS, violatesIsolation: violatesIsolation, framesDqAsLoss: framesDqAsLoss, isDqMoment: isDqMoment,
  LOCKED_RULES: LOCKED_RULES, lockedRefusalText: lockedRefusalText, attachedNotes: attachedNotes, entryList: entryList, validKeys: validKeys,
  outcomeForAdvice: outcomeForAdvice, lossScope: lossScope, enforceLossRule: enforceLossRule, noteContradictsLocked: noteContradictsLocked };
