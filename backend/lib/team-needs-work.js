// "What needs work" — the hybrid objection-bucket counterfactual (B-2).
// Formula approved 2026-07-26 (see scout-findings design note). Split of duties:
//   • Claude does ONE thing: group the period's distinct objection_surface
//     phrases into named buckets and return the mapping. It never sees or emits
//     a single number.
//   • JS (_computeNeedsWork, pure + fully tested) does EVERYTHING numeric: per-
//     bucket handle rates, the team-wide handled→closed linkage Δ, the
//     counterfactual (raise bucket X to the team's baseline on all OTHER
//     objections → extra handled → extra deals → extra cash), the guardrails
//     that refuse a money claim below threshold, the degrade ladder, and the
//     largest-extra-cash bucket selection. The card prose is a deterministic
//     template — the numbers are never LLM-touched.
//
// Cached in objection_synthesis_cache synthesis_type='team_needs_work', set-hash
// keyed on the analysis set (+ objection rows + kb) exactly like the other lanes.
// On-demand at team-view load; a cache hit spends no Claude. Deterministic
// "insufficient" states are cached too (free repeat loads); only a Claude/DB
// failure returns available:false and is NOT cached (retries next load).

const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { CLAUDE_MODEL } = require('../config');
const { fetchSellingContext, SYNTHESIS_CATEGORIES } = require('./selling-context');
const { loadTeamWindow, cacheGet, cachePut } = require('./team-synthesis');

// ── Guardrails (Phase 1, approved) ──────────────────────────────────────────
const MIN_BUCKET = 6;        // no "needs work" claim off a tiny bucket
const MIN_GAP_PP = 5;        // rate must be at least this far below baseline
const MIN_LINK_GROUP = 10;   // handled AND not-handled pools each ≥ this for Δ
const MIN_CLOSED = 5;        // closed calls needed for a meaningful avg cash
const MIN_ANALYZED = 10;     // analyzed calls needed to model at all
const MIN_DEALS_FOR_CASH = 0.5; // below this expected extra deals, suppress $

const BUCKET_MAX_TOKENS = 1500;

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
function normSurface(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function money100(x) { return Math.round(x / 100) * 100; }
function pctWhole(n, d) { return d > 0 ? Math.round((100 * n) / d) : null; }
function round1(x) { return Math.round(x * 10) / 10; }

// ── The deterministic core (pure — no DB, no Claude, no I/O) ─────────────────
// objs:     [{ call_id, surface, handled:boolean, quote, observation, rep, clip_url }]
// analyses: [{ fathom_call_id, outcome, cash_collected }]  (done rows only)
// mapping:  { <normalized surface>: <bucket label> }  (Claude's output, normalized)
// Returns the card + detail envelope. NEVER throws for content reasons.
function computeNeedsWork(objs, analyses, mapping) {
  objs = objs || []; analyses = analyses || []; mapping = mapping || {};
  var analyzed = analyses.length;

  // Cash + outcome facts.
  var outcomeByCall = {}, closedCount = 0, cashSum = 0;
  analyses.forEach(function (a) {
    outcomeByCall[a.fathom_call_id] = a.outcome;
    if (a.outcome === 'closed') {
      closedCount++;
      var c = Number(a.cash_collected); if (isFinite(c)) cashSum += c;
    }
  });
  var avgCash = closedCount > 0 ? cashSum / closedCount : 0;

  // Only objections whose parent call has a known (done-analysis) outcome.
  var scoped = objs.filter(function (o) { return Object.prototype.hasOwnProperty.call(outcomeByCall, o.call_id); });
  var totalObj = scoped.length;
  var totalHandled = scoped.filter(function (o) { return o.handled; }).length;

  // Team-wide handled→closed linkage Δ (per-objection marginal, pooled). "Not
  // handled" = every objection whose resolution isn't 'handled' (partial /
  // unhandled / unknown), matching the bucket rate's handled/total definition.
  var hN = 0, hClosed = 0, nN = 0, nClosed = 0;
  scoped.forEach(function (o) {
    var closed = outcomeByCall[o.call_id] === 'closed';
    if (o.handled) { hN++; if (closed) hClosed++; }
    else { nN++; if (closed) nClosed++; }
  });
  var pH = hN > 0 ? hClosed / hN : null;
  var pN = nN > 0 ? nClosed / nN : null;
  var delta = (pH != null && pN != null) ? pH - pN : null;

  // Buckets.
  var buckets = {}; // label -> { label, total, handled, surfaces:{}, rows:[] }
  scoped.forEach(function (o) {
    var label = mapping[normSurface(o.surface)] || 'Other';
    var b = buckets[label] || (buckets[label] = { label: label, total: 0, handled: 0, surfaces: {}, rows: [] });
    b.total++; if (o.handled) b.handled++;
    var sk = String(o.surface == null ? '' : o.surface).trim() || '(blank)';
    b.surfaces[sk] = b.surfaces[sk] || { surface: sk, n: 0, handled: 0 };
    b.surfaces[sk].n++; if (o.handled) b.surfaces[sk].handled++;
    b.rows.push(o);
  });

  function baseDetail(focusLabel) {
    var list = Object.keys(buckets).map(function (label) {
      var b = buckets[label];
      return { label: label, total: b.total, handled: b.handled, rate_pct: pctWhole(b.handled, b.total), is_focus: label === focusLabel };
    }).sort(function (a, b) { return b.total - a.total; });
    var mappingOut = [];
    Object.keys(buckets).forEach(function (label) {
      var b = buckets[label];
      Object.keys(b.surfaces).forEach(function (sk) { mappingOut.push({ bucket: label, surface: b.surfaces[sk].surface, n: b.surfaces[sk].n, handled: b.surfaces[sk].handled }); });
    });
    mappingOut.sort(function (a, b) { return b.n - a.n; });
    return {
      buckets: list, mapping: mappingOut, quotes: [],
      linkage: { p_closed_handled: pH, p_closed_nothandled: pN, delta: delta, handled_n: hN, nothandled_n: nN },
      avg_cash: Math.round(avgCash * 100) / 100, closed_calls: closedCount, analyzed_calls: analyzed, objections: totalObj,
    };
  }

  // Overall-volume gate → deterministic insufficient (cacheable, no Claude).
  if (analyzed < MIN_ANALYZED || totalObj === 0) {
    return { state: 'insufficient', headline: 'What needs work',
      card_text: 'Not enough objection volume this period to pinpoint a focus area.',
      bucket: null, extra: null, detail: baseDetail(null), generated_at: new Date().toISOString() };
  }

  var moneyGatesGlobal = (delta != null && delta > 0 && hN >= MIN_LINK_GROUP && nN >= MIN_LINK_GROUP && closedCount >= MIN_CLOSED && avgCash > 0);

  // Candidate weak buckets (exclude the 'Other' grab-bag from being the focus).
  var candidates = [];
  Object.keys(buckets).forEach(function (label) {
    if (label === 'Other') return;
    var b = buckets[label];
    if (b.total < MIN_BUCKET) return;
    var otherTotal = totalObj - b.total, otherHandled = totalHandled - b.handled;
    var baseline = otherTotal > 0 ? otherHandled / otherTotal : 0;
    var rate = b.total > 0 ? b.handled / b.total : 0;
    var gapPP = (baseline - rate) * 100;
    if (gapPP < MIN_GAP_PP) return; // not a relative weakness
    var addHandled = Math.max(0, Math.min(b.total - b.handled, baseline * b.total - b.handled));
    var extraDeals = moneyGatesGlobal ? addHandled * delta : null;
    var extraCash = (extraDeals != null) ? extraDeals * avgCash : null;
    candidates.push({ b: b, baseline: baseline, rate: rate, gapPP: gapPP, addHandled: addHandled, extraDeals: extraDeals, extraCash: extraCash });
  });

  if (candidates.length === 0) {
    return { state: 'insufficient', headline: 'What needs work',
      card_text: 'No single objection type stands out as a weakness this period.',
      bucket: null, extra: null, detail: baseDetail(null), generated_at: new Date().toISOString() };
  }

  // Money-eligible candidates need the global gates AND enough expected deals.
  var moneyCands = candidates.filter(function (c) { return c.extraCash != null && c.extraDeals >= MIN_DEALS_FOR_CASH; });
  var focus, state;
  if (moneyCands.length) { moneyCands.sort(function (a, b) { return b.extraCash - a.extraCash; }); focus = moneyCands[0]; state = 'money'; }
  else { candidates.sort(function (a, b) { return b.gapPP - a.gapPP; }); focus = candidates[0]; state = 'rate_gap'; }

  var label = focus.b.label;
  var rateW = pctWhole(focus.b.handled, focus.b.total);
  var baseW = Math.round(focus.baseline * 100);
  var detail = baseDetail(label);
  // Grounding quotes: not-handled examples from the focus bucket first (what's
  // being missed), capped at 2, only rows that actually carry a quote.
  var qcands = focus.b.rows.slice().sort(function (a, b) { return (a.handled ? 1 : 0) - (b.handled ? 1 : 0); });
  detail.quotes = qcands.filter(function (o) { return str(o.quote, 300); }).slice(0, 2).map(function (o) {
    return { text: str(o.quote, 300), observation: str(o.observation, 240), rep: o.rep || null, clip_url: o.clip_url || null, call_id: o.call_id, handled: !!o.handled };
  });

  var extra, card_text;
  if (state === 'money') {
    var deals = Math.max(1, Math.round(focus.extraDeals));
    var cash = money100(focus.extraCash);
    extra = { additional_handled: round1(focus.addHandled), delta: delta, avg_cash: avgCash, extra_deals: focus.extraDeals, extra_cash: focus.extraCash };
    card_text = 'Your team handles “' + label + '” objections at ' + rateW + '%, vs ' + baseW +
      '% on every other objection this period. Closing that gap ≈ ' + round1(focus.addHandled) +
      ' more handled ≈ ' + deals + ' more ' + (deals === 1 ? 'deal' : 'deals') +
      ' ≈ $' + cash.toLocaleString('en-US') + ' more collected.';
  } else {
    extra = { additional_handled: round1(focus.addHandled), delta: delta, avg_cash: avgCash, extra_deals: null, extra_cash: null };
    card_text = 'Your team handles “' + label + '” objections at ' + rateW + '%, the biggest gap vs ' + baseW +
      '% on every other objection this period.';
  }

  return {
    state: state, headline: 'What needs work',
    bucket: { label: label, total: focus.b.total, handled: focus.b.handled, rate_pct: rateW, baseline_pct: baseW, gap_pp: round1(focus.gapPP) },
    extra: extra, card_text: card_text, detail: detail, generated_at: new Date().toISOString(),
  };
}

// ── DB + cache + Claude-mapping wrapper ─────────────────────────────────────
// Same envelope family as the other lanes: {available, cached?, ...core} or
// {available:false, reason} (NOT cached) on a Claude/DB failure.
async function computeTeamNeedsWork(admin, keyId, repIds, from, to, emailMap) {
  if (!repIds || repIds.length === 0) {
    return Object.assign({ available: true, cached: false }, computeNeedsWork([], [], {}));
  }
  var w = await loadTeamWindow(admin, repIds, from, to);
  if (w.callIds.length === 0) {
    return Object.assign({ available: true, cached: false }, computeNeedsWork([], [], {}));
  }

  var analyses = await w.inChunks('call_analyses', 'fathom_call_id, analyzed_at, outcome, cash_collected, status',
    function (q) { return q.eq('status', 'done'); });
  var objRows = await w.inChunks('call_highlights',
    'fathom_call_id, timestamp_seconds, quote, observation, closer_response, objection_surface, resolution, type',
    function (q) { return q.eq('type', 'objection'); });

  var repOf = function (cid) { return w.meta[cid] ? w.meta[cid].user_id : null; };
  var clip = function (cid, ts) { var rec = w.meta[cid] && w.meta[cid].recording_url; return (rec && typeof ts === 'number') ? rec + (rec.indexOf('?') === -1 ? '?' : '&') + 't=' + ts : null; };
  var objs = objRows.map(function (r) {
    var rid = repOf(r.fathom_call_id);
    return {
      call_id: r.fathom_call_id,
      surface: r.objection_surface,
      handled: r.resolution === 'handled',
      quote: str(r.quote, 300),
      observation: str(r.observation, 240),
      rep: (emailMap && emailMap[rid] ? emailMap[rid].split('@')[0] : null),
      clip_url: clip(r.fathom_call_id, r.timestamp_seconds),
    };
  });

  // Hash folds analyses (fathom_call_id:analyzed_at — re-analysis changes it),
  // the objection surface set, and kbHash — same invalidation discipline as the
  // other lanes. Selling context is folded in for consistency (not used in the
  // bucketing prompt — bucketing must not be biased by offer text).
  var selling = await fetchSellingContext(admin, keyId, 1, SYNTHESIS_CATEGORIES);
  var hash = crypto.createHash('md5').update(
    analyses.map(function (a) { return a.fathom_call_id + ':' + a.analyzed_at; }).sort().join('|')
    + '||surf:' + objs.map(function (o) { return normSurface(o.surface); }).sort().join(',')
    + '||kb:' + selling.kbHash
  ).digest('hex');

  var cached = await cacheGet(admin, keyId, 'team_needs_work', from, to, hash);
  if (cached) return Object.assign({ available: true, cached: true }, cached);

  // Short-circuit BEFORE Claude when we can't possibly make a claim — cache the
  // deterministic insufficient result (free repeat loads, zero Claude spend).
  if (analyses.length < MIN_ANALYZED || objs.length === 0) {
    var pre = computeNeedsWork(objs, analyses, {});
    await cachePut(admin, keyId, 'team_needs_work', from, to, hash, pre);
    return Object.assign({ available: true, cached: false }, pre);
  }

  // Claude: bucket the DISTINCT surfaces only. It returns a mapping, no numbers.
  var counts = {};
  objs.forEach(function (o) { var k = String(o.surface == null ? '' : o.surface).trim(); if (k) counts[k] = (counts[k] || 0) + 1; });
  var distinct = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  if (distinct.length === 0) {
    var none = computeNeedsWork(objs, analyses, {});
    await cachePut(admin, keyId, 'team_needs_work', from, to, hash, none);
    return Object.assign({ available: true, cached: false }, none);
  }

  var prompt = [
    'You are grouping sales-objection phrases into a small set of named buckets.',
    'Below is every DISTINCT objection phrase a sales team heard this period (with how many times it came up). Group them into 4-8 buckets by MEANING, and give each bucket a short human label in the team\'s language (e.g. "Think about it", "Price / too expensive", "Spouse / partner", "Timing", "Payment / financing", "Trust / proof").',
    'Rules: assign EVERY phrase to exactly one bucket. Do NOT output counts, rates, money, or any number other than referencing the phrases. Do NOT invent phrases. Labels must be short (<= 30 chars).',
    '',
    'PHRASES (phrase — count):',
  ].concat(distinct.map(function (s) { return '  - ' + s + ' — ' + counts[s]; })).concat([
    '',
    'Respond with ONLY this JSON — no markdown:',
    '{ "buckets": [ { "label": "Think about it", "phrases": ["needs to think", "needs a few days"] } ] }',
  ]).join('\n');

  var mapping = {};
  try {
    var resp = await getAnthropic().messages.create({ model: CLAUDE_MODEL, max_tokens: BUCKET_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
    var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
    if (!parsed || !Array.isArray(parsed.buckets)) {
      return { available: false, reason: 'Bucketing returned unusable output — will retry on the next load.' };
    }
    parsed.buckets.forEach(function (bk) {
      var label = str(bk && bk.label, 30); if (!label) return;
      (Array.isArray(bk && bk.phrases) ? bk.phrases : []).forEach(function (p) {
        var k = normSurface(p); if (k) mapping[k] = label;
      });
    });
  } catch (e) {
    return { available: false, reason: 'Anthropic API failure' + ((e && e.status) ? ' (HTTP ' + e.status + ')' : '') + ': ' + ((e && e.message) || 'unknown') };
  }

  var result = computeNeedsWork(objs, analyses, mapping);
  await cachePut(admin, keyId, 'team_needs_work', from, to, hash, result);
  return Object.assign({ available: true, cached: false }, result);
}

module.exports = {
  computeTeamNeedsWork: computeTeamNeedsWork,
  // pure test surface (underscore = test-only)
  _computeNeedsWork: computeNeedsWork,
  _MIN_BUCKET: MIN_BUCKET, _MIN_GAP_PP: MIN_GAP_PP, _MIN_LINK_GROUP: MIN_LINK_GROUP,
  _MIN_CLOSED: MIN_CLOSED, _MIN_ANALYZED: MIN_ANALYZED, _MIN_DEALS_FOR_CASH: MIN_DEALS_FOR_CASH,
};
