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
/** The prompt block: a constraint on the reasoning, never evidence to quote. */
function doctrineBlock(doctrine, lane) {
  var units = unitsFor(doctrine, lane);
  if (!units.length) return '';
  return ['SCOUT\'S METHOD — how to judge what you read below. It governs your reasoning; it is NOT evidence, never cite it, never mention it, never quote it to the reader. Where this team\'s own material below says something more specific, the team\'s material wins.']
    .concat(units.map(function (u) { return '· ' + u.title + '\n' + u.text; })).join('\n\n');
}

/* ── the two hard rules, in code ── */
var ISOLATION_PATTERNS = [/instead of isolat/i, /rather than isolat/i, /don'?t isolate/i, /do not isolate/i, /stop isolating/i, /skip(?:ping)? (?:the )?isolat/i, /without isolating/i, /no need to isolate/i, /avoid isolat/i, /isolating .{0,40}(?:was|is) (?:a )?(?:mistake|wrong|unnecessary)/i];
function violatesIsolation(text) { var t = String(text || ''); return ISOLATION_PATTERNS.some(function (p) { return p.test(t); }); }
var DQ_LOSS_PATTERNS = [/lost (?:the )?(?:deal|sale)/i, /failed (?:to )?close/i, /failed close/i, /blew (?:the )?(?:close|deal)/i, /cost (?:you )?the (?:deal|sale|close)/i, /should have closed/i];
function framesDqAsLoss(text) { var t = String(text || ''); return DQ_LOSS_PATTERNS.some(function (p) { return p.test(t); }); }
function isDqMoment(h) { return !!h && (h.type === 'disqualify_signal' || (h.type === 'objection' && h.objection_class === 'disqualification')); }

module.exports = { DOCTRINE_VERSION: DOCTRINE_VERSION, CATEGORY: CATEGORY, SOURCE_LABEL: SOURCE_LABEL, parseDoctrine: parseDoctrine, readDoctrineFile: readDoctrineFile, doctrineRows: doctrineRows, loadDoctrine: loadDoctrine, unitsFor: unitsFor, doctrineBlock: doctrineBlock, LANE_KEYS: LANE_KEYS, violatesIsolation: violatesIsolation, framesDqAsLoss: framesDqAsLoss, isDqMoment: isDqMoment };
