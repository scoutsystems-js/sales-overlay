/**
 * lib/rep-line.js — THE REP LINE IS THE JUDGEMENT (Justin, 2026-09-05; H734).
 *
 * The Coachable Moments panel laid out evidence and left the manager to assemble the point — 45 items,
 * ~9,200 pixels, read by nobody. Now ONE line per rep, which opens to that rep's moments, and the line is
 * what a manager would say after watching those calls. Justin's shape: "Godwin — 3 calls where he rolled
 * past a money signal and lost the deal." A pattern across calls, not a category with a number on it.
 *
 * WHAT FEEDS IT (enumerated before the prompt was written — H734): the rep's five panel items (kind,
 * direction, tier; the prospect's line, the proven closer reply, the extractor's observation, section,
 * timestamp, handling/resolution; for a pair, both ends and the gap; for an earned signal, the move and its
 * summary from the arc pass) plus the call's date and outcome (through outcomeForAdvice, so a disqualified
 * prospect is never "lost"). NOT available and NOT used: the disclosure tier (disclosure_handling is written
 * on prospect moments the panel does not select), the objection category on non-objection kinds, anything
 * about the prospect beyond the quoted lines.
 *
 * THE LINE MUST SATISFY, in code (verifyLine), not only in the prompt:
 *   · EVIDENCED — every id it cites is in the set beneath it, and the number it states equals the distinct
 *     calls among the cited moments; a pattern needs at least two calls (one call is a restatement);
 *   · the doctrine — no word track (no quoted line), no "but" after a number, a DQ call never framed as a
 *     loss (the one loss rule), never coached out of isolating, never the prospect's name;
 *   · never diminishing — a strength line carries no subtracting clause;
 *   · SILENCE BEATS A GUESS — the model may answer "none"; a line that fails a check is REFUSED and the
 *     row says so in code ("Scout could not anchor a pattern…"); unmeasured is never zero.
 * The name and the dash are assembled in code; the model writes only the judgement clause.
 * ONE model call per rep per period, cached on the same keys as the other syntheses, version in the hash.
 */
'use strict';
var crypto = require('crypto');
var { CLAUDE_MODEL } = require('../config');
var createWithUsage = require('./model-usage').usageFor('rep-line');
var { snapCacheWindow } = require('./cache-window');
var doctrineLib = require('./doctrine');
var corrections = require('./coaching-corrections');
var { outcomeLabel } = require('./outcome-labels');
var { provenCloserResponse } = require('./closer-side');
var { gapLabel } = require('./missed-signal-pair');

var REP_LINE_VERSION = 'v3-2026-09-05';   /* v3: never the closer's own name in the judgement (the model appended "Godwin Ona" to his line; now refused in code and said in the prompt). Was v2-2026-09-05 */   /* v2: every moment is on a different call (stated, so the model stops recounting by date); JSON only; the last balanced object is read. Was v1-2026-09-05 */
var CALL_TIMEOUT_MS = 60000;   // a hung request must not hold the panel: unavailable (not cached) and the next load retries
var SYNTHESIS_TYPE = 'rep_line';
var MAX_TOKENS = 400;
var NONE_COPY = 'No pattern this period across {n} moments.';
var REFUSED_COPY = 'Scout could not anchor a pattern to these moments this period.';
var CONCURRENCY = 6;   // the standing ceiling on model loops (H250)

function hms(s) { s = Math.max(0, Math.floor(Number(s) || 0)); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + (h ? String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
function str(v, n) { return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, n) : ''; }
function firstName(name) { var n = str(name, 80); return n ? n.split(/\s+/)[0] : 'This rep'; }

/* One item, for the model — the id it can cite, and only what the row carries. */
function itemBlock(it, id, scope) {
  var m = it.moment || {};
  var outcome = doctrineLib.outcomeForAdvice(it.outcome, !!(scope && scope.dqCalls && scope.dqCalls[it.call_id]));
  var lines = ['[' + id + '] ' + (it.direction === 'cost' ? 'COST' : 'FORWARD') + ' · ' + (it.label || it.kind) + ' · call on ' + str(it.call_date, 10) + ' · outcome: ' + (outcome === 'disqualified' ? 'Disqualified (the prospect could not buy — not a lost deal, not a failed close)' : outcomeLabel(outcome))];
  if (it.kind === 'missed_signal_pair' && it.pair) {
    var p = it.pair;
    lines.push('  at ' + hms(p.signal && p.signal.timestamp_seconds) + ' the prospect said: "' + str(p.signal && p.signal.quote, 240) + '"' + (p.signal && p.signal.handling ? ' — the closer ' + p.signal.handling + ' it' : ''));
    lines.push('  ' + gapLabel(p.gap_seconds) + ' later the prospect said: "' + str(p.dq && p.dq.quote, 240) + '" (a disqualification)');
  } else {
    lines.push('  at ' + hms(m.timestamp_seconds) + ' the ' + (m.speaker === 'CLOSER' ? 'closer' : 'prospect') + ' said: "' + str(m.quote, 240) + '"');
    var reply = provenCloserResponse(m); if (reply) lines.push('  the closer replied: "' + str(reply, 240) + '"');
    if (m.observation) lines.push('  what was observed: ' + str(m.observation, 300));
    if (m.handling) lines.push('  handling: ' + m.handling); if (m.resolution) lines.push('  resolution: ' + m.resolution);
    if (it.kind === 'earned_signal' && it.move) lines.push('  the move that earned it: ' + it.move + (it.move_summary ? ' — ' + str(it.move_summary, 200) : ''));
  }
  if (it.consequence) lines.push('  ' + it.consequence);
  return lines.join('\n');
}

function buildRepLinePrompt(rep, items, material, opts) {
  var o = opts || {};
  var ids = items.map(function (_, i) { return 'm' + (i + 1); });
  var lines = [
    'You are a sales manager who has just watched every call below. Write the ONE sentence you would say about this closer to another manager — the pattern across these calls, already assembled. Not a label, not a category with a number on it, not a restatement of one moment.',
    '',
    'THE SHAPE, and it is a framework: "<N> calls where they <did the thing> and <what it cost or what it won>." Example of the shape only, never to copy: "3 calls where they rolled past a money signal and the deal went nowhere." Begin with the pattern, not the closer\'s name — the name is added for you.',
    '',
    'THE CLOSER: ' + str(rep.name, 80) + '. ' + (rep.calls || 0) + ' counted calls this period; the moments below are the ones worth a manager\'s attention (up to five, the costly ones first). EVERY MOMENT IS ON A DIFFERENT CALL — two moments on the same date are two calls — so the number of calls you cite is exactly the number of moments in evidence_ids.',
    '',
    'RULES — each one is checked in code after you answer, and a sentence that fails is discarded:',
    '  1. EVIDENCE. List in "evidence_ids" the moments the sentence is about. A number in the sentence MUST equal the number of distinct calls among those moments. A pattern needs at least two calls; if the moments show no pattern, answer kind "none" — silence beats a guess.',
    '  2. STRENGTH. If the moments are mostly what this closer did RIGHT, write that as the sentence (kind "strength") — a strong period is stated as one, and it is not a preamble to a criticism. No "but", no "however", no subtracting clause after a number they earned.',
    '  3. Never a word track: no quoted line for the closer to say. Never the prospect\'s name — "a prospect". Never the closer\'s name either, anywhere in the sentence — refer to the closer only as "they"; their name is added in front of your sentence for you.',
    '  4. A prospect marked Disqualified could not buy: never "lost the deal" or "failed close" about that call — the miss, if any, was upstream, in qualification.',
    '  5. Never coach the closer out of isolating an objection. Never a claim the moments do not carry.',
    '  6. One sentence, at most 30 words, plain words, no colon, no headline, no score.',
    '',
    'THE MOMENTS:',
  ].concat(items.map(function (it, i) { return itemBlock(it, ids[i], o.lossScope); }));
  if (material && material.contextText) lines.push('', 'TEAM MATERIAL (what this team sells and how — judge against it):', material.contextText);
  if (material && material.notes && material.notes.text) lines.push('', corrections.promptLane(material.notes.text));
  if (o.doctrineBlock) lines.push('', o.doctrineBlock);
  lines.push('', 'Return ONLY this JSON — nothing before it, nothing after it, no reasoning, no revision: {"kind":"pattern|strength|none","judgement":"<the sentence, without the closer\'s name>","evidence_ids":["m1","m3"],"calls_claimed":<the number of ids in evidence_ids>}');
  return lines.join('\n');
}

var NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, both: 2, all: null };
function statedNumber(text) {
  var m = /\b(\d+)\b/.exec(text); if (m) return Number(m[1]);
  var w = /\b(one|two|three|four|five|six|seven|eight|nine|ten|both)\b/i.exec(text); if (w) return NUMBER_WORDS[w[1].toLowerCase()];
  return null;
}
/* A prospect's NAME, never a word that happens to sit in the name field: placeholders ("Unknown prospect", "Prospect",
   a calendar stand-in) are not names, and the match is case-sensitive on the proper noun — "the prospect" in a
   judgement must not trip on a name field that reads "Prospect". */
var NOT_A_NAME = { prospect: 1, unknown: 1, client: 1, customer: 1, guest: 1, user: 1, zoom: 1, meeting: 1, room: 1, personal: 1, call: 1, the: 1, and: 1, with: 1, unnamed: 1, nolastname: 1, none: 1, null: 1 };
function nameTokens(items) {
  var out = [];
  items.forEach(function (it) { String(it.prospect_name || '').split(/[\s,]+/).forEach(function (t) { t = t.replace(/[^A-Za-z'-]/g, ''); if (t.length >= 3 && !NOT_A_NAME[t.toLowerCase()] && /^[A-Z]/.test(t) && out.indexOf(t) === -1) out.push(t); }); });
  return out;
}
/* THE GUARD. Pure. Returns { ok, kind, line|null, evidence_ids, calls, reason }. */
function verifyLine(parsed, rep, items, scope) {
  var ids = items.map(function (_, i) { return 'm' + (i + 1); });
  var out = { ok: false, kind: 'refused', line: null, evidence_ids: [], calls: 0, reason: null };
  if (!parsed || typeof parsed !== 'object') { out.reason = 'unparseable'; return out; }
  var kind = parsed.kind;
  if (kind === 'none') return { ok: true, kind: 'none', line: null, evidence_ids: [], calls: 0, reason: null };
  if (kind !== 'pattern' && kind !== 'strength') { out.reason = 'unknown kind'; return out; }
  var judgement = str(parsed.judgement, 240);
  if (!judgement) { out.reason = 'empty'; return out; }
  var ev = Array.isArray(parsed.evidence_ids) ? parsed.evidence_ids.filter(function (x, i, a) { return typeof x === 'string' && a.indexOf(x) === i; }) : [];
  var missing = ev.filter(function (x) { return ids.indexOf(x) === -1; });
  if (!ev.length) { out.reason = 'no evidence cited'; return out; }
  if (missing.length) { out.reason = 'cites moments not beneath it: ' + missing.join(','); return out; }
  var calls = {}; ev.forEach(function (x) { var it = items[ids.indexOf(x)]; if (it && it.call_id) calls[it.call_id] = 1; });
  var distinct = Object.keys(calls).length;
  if (distinct < 2) { out.reason = 'one call is a restatement, not a pattern'; return out; }
  var n = statedNumber(judgement);
  if (n !== null && n !== distinct) { out.reason = 'states ' + n + ' but the evidence covers ' + distinct + ' calls'; return out; }
  if (typeof parsed.calls_claimed === 'number' && parsed.calls_claimed !== distinct) { out.reason = 'claims ' + parsed.calls_claimed + ' calls, evidence covers ' + distinct; return out; }
  if (/["“”]/.test(judgement) || /'[^']{12,}'/.test(judgement)) { out.reason = 'a quoted line — a word track'; return out; }
  var names = nameTokens(items.filter(function (it) { return ev.indexOf(ids[items.indexOf(it)]) !== -1; }));
  for (var i = 0; i < names.length; i++) if (new RegExp('\\b' + names[i].replace(/[-']/g, function (c) { return '\\' + c; }) + '\\b').test(judgement)) { out.reason = 'names the prospect'; return out; }
  /* v3: the closer's own name never appears in the judgement — the name is the row's, added in front */
  var own = String(rep.name || '').split(/\s+/).map(function (t) { return t.replace(/[^A-Za-z'-]/g, ''); }).filter(function (t) { return t.length >= 3 && /^[A-Z]/.test(t); });
  for (var k = 0; k < own.length; k++) if (new RegExp('\\b' + own[k].replace(/[-']/g, function (c) { return '\\' + c; }) + '\\b').test(judgement)) { out.reason = 'names the closer'; return out; }
  if (doctrineLib.violatesIsolation(judgement)) { out.reason = 'coaches out of isolating'; return out; }
  if (/\b\d+\b[^.]*\b(but|however|though|although)\b/i.test(judgement) || (kind === 'strength' && /\b(but|however|though|although)\b/i.test(judgement))) { out.reason = 'a subtracting clause'; return out; }
  var evDq = Object.keys(calls).some(function (c) { return scope && scope.dqCalls && scope.dqCalls[c]; });
  if (evDq && doctrineLib.framesDqAsLoss(judgement)) { out.reason = 'frames a disqualified prospect as a loss'; return out; }
  if (judgement.split(/\s+/).length > 34) { out.reason = 'too long'; return out; }
  return { ok: true, kind: kind, line: (rep.line_name || firstName(rep.name)) + ' — ' + judgement.replace(/\s+/g, ' ').replace(/\.?$/, '.'), evidence_ids: ev, calls: distinct, reason: null };
}
function noneLine(rep, items) { return { ok: true, kind: 'none', line: NONE_COPY.replace('{n}', String(items.length)), evidence_ids: [], calls: 0, reason: null }; }
function refusedLine(reason) { return { ok: false, kind: 'refused', line: REFUSED_COPY, evidence_ids: [], calls: 0, reason: reason || null }; }

function extractJson(text) {
  var s = String(text || ''); var found = null; var depth = 0, start = -1, inStr = false, esc = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { found = JSON.parse(s.slice(start, i + 1)); } catch (e) { /* keep the last one that parses */ } start = -1; } if (depth < 0) depth = 0; }
  }
  return found;
}
function hashFor(items, material) {
  return crypto.createHash('md5').update(items.map(function (it) { return (it.moment && it.moment.id) || it.call_id; }).join('|') + '|' + items.map(function (it) { return it.call_id + ':' + (it.outcome || ''); }).join('|') + '|' + REP_LINE_VERSION + '|kb:' + ((material && material.kbHash) || 'none')).digest('hex');
}

/** One rep. Returns the line record (cached or fresh). */
async function computeRepLine(admin, rep, material, from, to, opts) {
  var items = rep.items || [];
  if (!items.length) return { kind: 'no_items', line: null, evidence_ids: [], calls: 0, cached: false };
  if (!material || !material.hasMaterial) return { kind: 'no_material', line: null, evidence_ids: [], calls: 0, cached: false };
  var ck = snapCacheWindow(from, to); var hash = hashFor(items, material);
  var cq = await admin.from('objection_synthesis_cache').select('synthesis').eq('user_id', rep.user_id).eq('synthesis_type', SYNTHESIS_TYPE).eq('from_ts', ck.from).eq('to_ts', ck.to).eq('analysis_set_hash', hash).maybeSingle();
  if (!cq.error && cq.data && cq.data.synthesis && cq.data.synthesis.kind) return Object.assign({ cached: true }, cq.data.synthesis);
  var prompt = buildRepLinePrompt(rep, items, material, { lossScope: rep.loss_scope, doctrineBlock: material.doctrineBlock ? material.doctrineBlock('rep-line') : '' });
  var result;
  try {
    var resp = await Promise.race([
      createWithUsage({ model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }, { userId: rep.user_id, callId: null, lane: 'rep-line' }),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('rep-line timed out after ' + CALL_TIMEOUT_MS + 'ms')); }, CALL_TIMEOUT_MS).unref(); }),
    ]);
    var rawText = (resp.content || []).map(function (c) { return c.text || ''; }).join('');
    var parsed = extractJson(rawText);
    var v = verifyLine(parsed, rep, items, rep.loss_scope);
    result = v.ok ? (v.kind === 'none' ? noneLine(rep, items) : v) : refusedLine(v.reason);
    /* a refusal keeps the model's raw answer (never rendered) so the shape that failed can be read, not guessed */
    if (!v.ok) { result.raw = String(rawText).slice(0, 600); result.judgement = parsed && typeof parsed.judgement === 'string' ? parsed.judgement.slice(0, 240) : null; console.warn('[rep-line] refused for ' + rep.user_id + ': ' + v.reason); }
  } catch (e) {
    return { kind: 'unavailable', line: null, evidence_ids: [], calls: 0, cached: false, reason: (e && e.message) || 'unknown' };
  }
  var record = { kind: result.kind, line: result.line, evidence_ids: result.evidence_ids, calls: result.calls, reason: result.reason || null, raw: result.raw || null, judgement: result.judgement || null, generated_at: new Date().toISOString(), version: REP_LINE_VERSION };
  var up = await admin.from('objection_synthesis_cache').upsert({ user_id: rep.user_id, synthesis_type: SYNTHESIS_TYPE, from_ts: ck.from, to_ts: ck.to, analysis_set_hash: hash, synthesis: record, generated_at: record.generated_at }, { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[rep-line] cache write failed for ' + rep.user_id + ': ' + up.error.message);
  return Object.assign({ cached: false }, record);
}

/** Every rep on the board, at most CONCURRENCY in flight; the material loaded ONCE for the team. */
async function computeRepLines(admin, reps, material, from, to) {
  /* the line opens with the first name (Justin's shape) unless another rep on the board shares it — then the board's
     own display name ("Josh N", "Josh P"), so two rows never read the same */
  var firsts = {}; reps.forEach(function (r) { var f = firstName(r.name); firsts[f] = (firsts[f] || 0) + 1; });
  reps.forEach(function (r) { r.line_name = firsts[firstName(r.name)] > 1 ? String(r.name || '').trim() : firstName(r.name); });
  var out = new Array(reps.length); var next = 0;
  async function worker() { while (next < reps.length) { var i = next++; out[i] = await computeRepLine(admin, reps[i], material, from, to); } }
  var pool = []; for (var k = 0; k < Math.min(CONCURRENCY, reps.length); k++) pool.push(worker());
  await Promise.all(pool);
  return out;
}

module.exports = { REP_LINE_VERSION: REP_LINE_VERSION, SYNTHESIS_TYPE: SYNTHESIS_TYPE, NONE_COPY: NONE_COPY, REFUSED_COPY: REFUSED_COPY,
  buildRepLinePrompt: buildRepLinePrompt, verifyLine: verifyLine, computeRepLine: computeRepLine, computeRepLines: computeRepLines, _hashFor: hashFor, _itemBlock: itemBlock, _statedNumber: statedNumber, _extractJson: extractJson, _nameTokens: nameTokens };
