// Team synthesis (v1.4 Manager view): two cached, credit-tolerant Claude calls,
// both evidence-resolved from real DB rows by id (never LLM-invented), with rep
// attribution. Cached in objection_synthesis_cache keyed on the TEAM KEY id
// (manager/owner user_id) + synthesis_type ∈ {team, highlights}. Modeled on
// lib/performance-synthesis.js.
//
//   computeTeamRecommendations — team-wide weakest section, most-lost objection
//     category, cited per-rep where relevant. {working[], improve[]}.
//   computeWeeklyHighlights    — best moments across the team in three fixed
//     lanes (objection_handling, challenging, pain_excavation), each with rep +
//     quote + clip + why.

const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { CLAUDE_MODEL } = require('../config');
const { fetchSellingContext } = require('./selling-context');

const SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];
const OBJ_CATEGORIES = ['fear', 'logistical', 'timing', 'partner'];
const MAX_CANDIDATES = 20;
const MAX_ONE_THINGS = 20;

var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}
function extractJson(text) {
  if (!text) return null;
  var cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  var start = cleaned.indexOf('{');
  if (start === -1) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}
function str(x, cap) { return (typeof x === 'string' && x.trim()) ? x.trim().slice(0, cap || 500) : null; }
function clipUrl(rec, ts) { return (rec && typeof ts === 'number') ? rec + (rec.indexOf('?') === -1 ? '?' : '&') + 't=' + ts : null; }
function avg(sum, n) { return n > 0 ? Math.round(sum / n) : null; }
function apiFail(e) { return { available: false, reason: 'Anthropic API failure' + ((e && e.status) ? ' (HTTP ' + e.status + ')' : '') + ': ' + ((e && e.message) || 'unknown') }; }

// Load the team's calls in a window + their done analyses + objection/highlight
// rows, once. Returns everything both synthesizers need.
async function loadTeamWindow(admin, repIds, from, to) {
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, user_id, recording_url, call_date, title')
      .in('user_id', repIds).gte('call_date', from).lte('call_date', to)
      .order('call_date', { ascending: false }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }
  var meta = {}, callIds = [];
  calls.forEach(function (c) { meta[c.id] = c; callIds.push(c.id); });
  async function inChunks(table, cols, refine) {
    var out = [];
    for (var i = 0; i < callIds.length; i += 100) {
      var qb = admin.from(table).select(cols).in('fathom_call_id', callIds.slice(i, i + 100));
      if (refine) qb = refine(qb);
      var r = await qb; if (r.error) throw new Error(table + ': ' + r.error.message);
      out = out.concat(r.data || []);
    }
    return out;
  }
  return { meta: meta, callIds: callIds, inChunks: inChunks };
}

async function cacheGet(admin, keyId, type, from, to, hash) {
  var q = await admin.from('objection_synthesis_cache').select('synthesis')
    .eq('user_id', keyId).eq('synthesis_type', type).eq('from_ts', from).eq('to_ts', to).eq('analysis_set_hash', hash).maybeSingle();
  return (!q.error && q.data && q.data.synthesis) ? q.data.synthesis : null;
}
async function cachePut(admin, keyId, type, from, to, hash, synthesis) {
  var up = await admin.from('objection_synthesis_cache').upsert(
    { user_id: keyId, synthesis_type: type, from_ts: from, to_ts: to, analysis_set_hash: hash, synthesis: synthesis, generated_at: synthesis.generated_at },
    { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[team-synthesis] cache write failed (' + type + ', key ' + keyId + '): ' + up.error.message);
}

// ── Team recommendations ─────────────────────────────────────────────────────
async function computeTeamRecommendations(admin, keyId, repIds, from, to, emailMap) {
  if (!repIds || repIds.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };
  var w = await loadTeamWindow(admin, repIds, from, to);
  if (w.callIds.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

  var analyses = await w.inChunks('call_analyses',
    'fathom_call_id, analyzed_at, outcome, overall_score, intro_score, discovery_score, pitch_score, objection_score, close_score, one_thing',
    function (q) { return q.eq('status', 'done'); });
  if (analyses.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

  // KB-grounded: the manager/owner's team selling context (cap 3000), folded into
  // the set-hash so a KB upload invalidates the cached team recommendations.
  var selling = await fetchSellingContext(admin, keyId, 3000);
  var hash = crypto.createHash('md5').update(analyses.map(function (a) { return a.fathom_call_id + ':' + a.analyzed_at; }).sort().join('|') + '||kb:' + selling.kbHash).digest('hex');
  var cached = await cacheGet(admin, keyId, 'team', from, to, hash);
  if (cached) return Object.assign({ available: true, cached: true }, cached);

  var repOf = function (cid) { return w.meta[cid] ? w.meta[cid].user_id : null; };
  var secSum = {}, secN = {}; SECTIONS.forEach(function (s) { secSum[s] = 0; secN[s] = 0; });
  var winSum = 0, winN = 0, lossSum = 0, lossN = 0, outcomeByCall = {};
  var oneThings = [];
  analyses.forEach(function (a) {
    outcomeByCall[a.fathom_call_id] = a.outcome;
    SECTIONS.forEach(function (s) { var v = a[s + '_score']; if (typeof v === 'number') { secSum[s] += v; secN[s]++; } });
    if (typeof a.overall_score === 'number') { if (a.outcome === 'closed') { winSum += a.overall_score; winN++; } else if (a.outcome === 'lost') { lossSum += a.overall_score; lossN++; } }
    if (typeof a.one_thing === 'string' && a.one_thing.trim() && oneThings.length < MAX_ONE_THINGS) {
      var em = emailMap && emailMap[repOf(a.fathom_call_id)]; oneThings.push((em ? em.split('@')[0] + ': ' : '') + a.one_thing.trim());
    }
  });
  var sections = {}, strongest = null, weakest = null;
  SECTIONS.forEach(function (s) { sections[s] = avg(secSum[s], secN[s]); });
  SECTIONS.forEach(function (s) { if (sections[s] == null) return; if (strongest === null || sections[s] > sections[strongest]) strongest = s; if (weakest === null || sections[s] < sections[weakest]) weakest = s; });

  var objRows = await w.inChunks('call_highlights', 'objection_category, resolution', function (q) { return q.eq('type', 'objection'); });
  var obj = {}; OBJ_CATEGORIES.forEach(function (c) { obj[c] = { total: 0, handled: 0 }; });
  objRows.forEach(function (r) { var bk = obj[r.objection_category]; if (bk) { bk.total++; if (r.resolution === 'handled') bk.handled++; } });

  var hlRows = await w.inChunks('call_highlights', 'fathom_call_id, timestamp_seconds, quote, closer_response, type');
  function cls(o) { return o === 'closed' ? 'win' : (o === 'lost' ? 'loss' : 'other'); }
  var candidates = hlRows.map(function (r) {
    var c = cls(outcomeByCall[r.fathom_call_id]); var rid = repOf(r.fathom_call_id);
    return { cls: c, type: r.type, rep: (emailMap && emailMap[rid]) || rid,
      quote: str(r.closer_response, 200) || str(r.quote, 200) || '',
      clip_url: clipUrl(w.meta[r.fathom_call_id] && w.meta[r.fathom_call_id].recording_url, r.timestamp_seconds),
      call_id: r.fathom_call_id,
      _s: (c === 'win' && (r.type === 'strong_moment' || r.type === 'buying_signal')) ? 5 : (c === 'loss' && (r.type === 'objection' || r.type === 'missed_opportunity')) ? 4 : (r.type === 'strong_moment') ? 3 : 1 };
  }).filter(function (c) { return c.quote; }).sort(function (a, b) { return b._s - a._s; }).slice(0, MAX_CANDIDATES);
  candidates.forEach(function (c, i) { c.id = 'm' + (i + 1); });
  var byId = {}; candidates.forEach(function (c) { byId[c.id] = c; });

  var promptLines = [
    'You are a sales manager coach. Synthesize a TEAM performance review across ' + repIds.length + ' reps for this period. Be specific, grounded, and cite reps by name where relevant. No generic praise.',
    'TEAM SECTION AVERAGES (0-100): ' + SECTIONS.map(function (s) { return s + ' ' + (sections[s] == null ? 'n/a' : sections[s]); }).join(', ') + '. Strongest: ' + (strongest || 'n/a') + '. Weakest: ' + (weakest || 'n/a') + '.',
    'WIN-class avg ' + (avg(winSum, winN) || 'n/a') + ' (' + winN + '), LOSS-class avg ' + (avg(lossSum, lossN) || 'n/a') + ' (' + lossN + ').',
    'OBJECTIONS by category (handled/total): ' + OBJ_CATEGORIES.map(function (c) { return c + ' ' + obj[c].handled + '/' + obj[c].total; }).join(', ') + '.',
    '',
    'GRADER one-thing notes across reps (synthesize the recurring TEAM theme; names prefixed):',
  ].concat(oneThings.map(function (t) { return '  - ' + t.slice(0, 200); })).concat([
    '',
    'EVIDENCE MOMENTS (cite one by id in evidence_id; do not invent quotes). Each is tagged with the rep:',
  ]).concat(candidates.map(function (c) { return '  [' + c.id + '] (' + c.cls.toUpperCase() + ', rep ' + c.rep + ') ' + c.type + ': "' + c.quote + '"'; })).concat([
    '',
    'Produce: WHATS WORKING (2-3 team strengths, each grounded in an evidence_id + a number), WHAT TO IMPROVE (2-3 team gaps: the team-wide weakest section, the most-lost objection category, and the synthesized one-thing theme; cite the rep(s) it most applies to and a representative evidence_id).',
    'Respond with ONLY this JSON — no markdown: {"working":[{"claim":"...","data":"...","evidence_id":"m1"}],"improve":[{"claim":"...","data":"...","evidence_id":"m2"}]}',
  ]);
  if (selling.contextText && selling.contextText.trim()) {
    promptLines.splice(1, 0,
      'SELLING CONTEXT (the team\'s actual offer / sales approach — ground your assessment in it; judge against THIS offer and selling style, do not penalize approaches it endorses):',
      selling.contextText.trim(), '');
  }
  var prompt = promptLines.join('\n');

  var resp;
  try { resp = await getAnthropic().messages.create({ model: CLAUDE_MODEL, max_tokens: 2600, messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { return apiFail(e); }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed || !Array.isArray(parsed.working) || !Array.isArray(parsed.improve)) return { available: false, reason: 'synthesis returned unparseable output' };
  function resolve(arr) {
    return arr.slice(0, 3).map(function (it) {
      var ev = (it && it.evidence_id && byId[it.evidence_id]) || null;
      return { claim: str(it && it.claim, 400), data: str(it && it.data, 200), rep: ev ? ev.rep : null, quote: ev ? ev.quote : null, clip_url: ev ? ev.clip_url : null, call_id: ev ? ev.call_id : null };
    }).filter(function (it) { return it.claim; });
  }
  var synthesis = { working: resolve(parsed.working), improve: resolve(parsed.improve), generated_at: new Date().toISOString() };
  await cachePut(admin, keyId, 'team', from, to, hash, synthesis);
  return Object.assign({ available: true, cached: false }, synthesis);
}

// ── Call Highlights of the Week ──────────────────────────────────────────────
var LANES = ['objection_handling', 'challenging', 'pain_excavation'];
async function computeWeeklyHighlights(admin, keyId, repIds, from, to, emailMap) {
  if (!repIds || repIds.length === 0) return { available: true, lanes: {}, generated_at: new Date().toISOString() };
  var w = await loadTeamWindow(admin, repIds, from, to);
  if (w.callIds.length === 0) return { available: true, lanes: {}, generated_at: new Date().toISOString() };

  // Candidates: strong_moment + handled objections (the raw material for the 3 lanes).
  var hlRows = await w.inChunks('call_highlights', 'fathom_call_id, timestamp_seconds, quote, observation, closer_response, type, resolution',
    function (q) { return q.in('type', ['strong_moment', 'objection']); });
  var cands = hlRows.filter(function (r) { return r.type === 'strong_moment' || r.resolution === 'handled'; }).map(function (r) {
    var rid = w.meta[r.fathom_call_id] ? w.meta[r.fathom_call_id].user_id : null;
    return { type: r.type, rep: (emailMap && emailMap[rid]) || rid, rep_id: rid,
      quote: str(r.closer_response, 220) || str(r.quote, 220) || '', observation: str(r.observation, 200) || '',
      clip_url: clipUrl(w.meta[r.fathom_call_id] && w.meta[r.fathom_call_id].recording_url, r.timestamp_seconds), call_id: r.fathom_call_id };
  }).filter(function (c) { return c.quote; }).slice(0, 30);
  if (cands.length === 0) return { available: true, lanes: {}, generated_at: new Date().toISOString() };
  cands.forEach(function (c, i) { c.id = 'h' + (i + 1); });
  var byId = {}; cands.forEach(function (c) { byId[c.id] = c; });

  var hash = crypto.createHash('md5').update(cands.map(function (c) { return c.id + ':' + c.call_id; }).join('|')).digest('hex');
  var cached = await cacheGet(admin, keyId, 'highlights', from, to, hash);
  if (cached) return Object.assign({ available: true, cached: true }, cached);

  var prompt = [
    'You are a sales manager picking the BEST team moments of the week to celebrate + teach from, in three fixed lanes:',
    '  objection_handling — the cleanest objection resolution.',
    '  challenging — the best moment a rep challenged/pushed the prospect (challenger-sale).',
    '  pain_excavation — the best moment a rep dug into real pain.',
    'Pick AT MOST ONE moment per lane (omit a lane if nothing fits). Cite by candidate id. Do NOT invent quotes.',
    '',
    'CANDIDATES (tagged with rep):',
  ].concat(cands.map(function (c) { return '  [' + c.id + '] rep ' + c.rep + ' (' + c.type + '): "' + c.quote + '" — ' + c.observation; })).concat([
    '',
    'Respond with ONLY this JSON — no markdown: {"objection_handling":{"id":"h1","why":"one line"},"challenging":{"id":"h2","why":"..."},"pain_excavation":{"id":"h3","why":"..."}}',
  ]).join('\n');

  var resp;
  try { resp = await getAnthropic().messages.create({ model: CLAUDE_MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { return apiFail(e); }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed) return { available: false, reason: 'synthesis returned unparseable output' };
  var lanes = {};
  LANES.forEach(function (lane) {
    var pick = parsed[lane]; var ev = (pick && pick.id && byId[pick.id]) || null;
    if (ev) lanes[lane] = { rep: ev.rep, quote: ev.quote, clip_url: ev.clip_url, call_id: ev.call_id, why: str(pick.why, 200) };
  });
  var synthesis = { lanes: lanes, generated_at: new Date().toISOString() };
  await cachePut(admin, keyId, 'highlights', from, to, hash, synthesis);
  return Object.assign({ available: true, cached: false }, synthesis);
}

module.exports = { computeTeamRecommendations: computeTeamRecommendations, computeWeeklyHighlights: computeWeeklyHighlights };
