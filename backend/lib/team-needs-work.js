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

// Personal (A-2.1) softer floors: one closer has a fraction of a team's
// objections. The bucket floor drops (still ≥ a handful) and the analyzed floor
// drops so a modest closer can still surface a rate-gap focus. The MONEY clause
// keeps the full linkage/cash gates — its stability comes from TEAM-BORROWED
// coefficients, not from lowering the money bar.
const PERSONAL_MIN_BUCKET = 4;
const PERSONAL_MIN_ANALYZED = 3;

const BUCKET_MAX_TOKENS = 1500;
// Bumped when the bucketing/classification logic changes — folded into the cache
// hash so cached needs-work results regenerate on deploy (a prompt change alone
// doesn't move the analyses/surface hash). v2 = taxonomy (true-objections-only).
const NEEDS_WORK_LANE_VERSION = 'v2-taxonomy';

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

// Pooled handled→closed linkage + cash facts for a set of objections+analyses.
// Used both for a group's OWN coefficients and (personal) for the TEAM-BORROWED
// ones. Pure.
function computeLinkage(objs, analyses) {
  var outcomeByCall = {}, closedCount = 0, cashSum = 0;
  (analyses || []).forEach(function (a) {
    outcomeByCall[a.fathom_call_id] = a.outcome;
    if (a.outcome === 'closed') { closedCount++; var c = Number(a.cash_collected); if (isFinite(c)) cashSum += c; }
  });
  var avgCash = closedCount > 0 ? cashSum / closedCount : 0;
  var scoped = (objs || []).filter(function (o) { return Object.prototype.hasOwnProperty.call(outcomeByCall, o.call_id); });
  var hN = 0, hClosed = 0, nN = 0, nClosed = 0;
  scoped.forEach(function (o) {
    var closed = outcomeByCall[o.call_id] === 'closed';
    if (o.handled) { hN++; if (closed) hClosed++; } else { nN++; if (closed) nClosed++; }
  });
  var pH = hN > 0 ? hClosed / hN : null, pN = nN > 0 ? nClosed / nN : null;
  return { outcomeByCall: outcomeByCall, closedCount: closedCount, avgCash: avgCash,
    handledN: hN, notHandledN: nN, pH: pH, pN: pN, delta: (pH != null && pN != null) ? pH - pN : null };
}

// ── The deterministic core (pure — no DB, no Claude, no I/O) ─────────────────
// objs:     [{ call_id, surface, handled:boolean, quote, observation, rep, clip_url }]
// analyses: [{ fathom_call_id, outcome, cash_collected }]  (done rows only)
// mapping:  { <normalized surface>: <bucket label> }  (Claude's output, normalized)
// opts (optional): { subject:'team'|'personal', minBucket, minAnalyzed, injected }
//   subject   — 'personal' switches the card copy to "You handled …" + raw counts.
//   minBucket / minAnalyzed — personal uses softer floors (bucket 4) since one
//     closer has far fewer objections than a team.
//   injected  — TEAM-BORROWED money coefficients (from computeLinkage on the
//     team) so the personal $ clause is backed by a stable sample. When absent,
//     the group's OWN linkage powers the money math (team behaviour, unchanged).
// Returns the card + detail envelope. NEVER throws for content reasons.
function computeNeedsWork(objs, analyses, mapping, opts) {
  objs = objs || []; analyses = analyses || []; mapping = mapping || {}; opts = opts || {};
  var subject = opts.subject === 'personal' ? 'personal' : 'team';
  var minBucket = opts.minBucket || MIN_BUCKET;
  var minAnalyzed = (opts.minAnalyzed != null) ? opts.minAnalyzed : MIN_ANALYZED;
  var analyzed = analyses.length;

  // Classification (item #5): the objection MATH counts TRUE OBJECTIONS ONLY.
  // Logistical barriers (e.g. a declined payment) and disqualifications (e.g.
  // "can't afford") are NOT coachable objections — they're excluded from the
  // math and surfaced separately as context. bucketClass maps a bucket label to
  // its class; absent/unknown → 'true_objection' (backward-compatible default).
  var bucketClass = opts.bucketClass || {};
  function classOf(label) { return bucketClass[label] || 'true_objection'; }
  function labelOf(o) { return mapping[normSurface(o.surface)] || 'Other'; }

  var outcomeByCall = computeLinkage(objs, analyses).outcomeByCall; // over ALL objs, just to scope by parent outcome

  // Only objections whose parent call has a known (done-analysis) outcome, then
  // split TRUE objections (the math) from context (logistical + DQ).
  var scopedAll = objs.filter(function (o) { return Object.prototype.hasOwnProperty.call(outcomeByCall, o.call_id); });
  var scoped = [], context = { disqualifications: 0, logistical: 0 };
  scopedAll.forEach(function (o) {
    var cls = classOf(labelOf(o));
    if (cls === 'disqualification') context.disqualifications++;
    else if (cls === 'logistical_barrier') context.logistical++;
    else scoped.push(o); // true_objection (the default) → counted in the math
  });
  var totalObj = scoped.length;
  var totalHandled = scoped.filter(function (o) { return o.handled; }).length;

  // Linkage Δ over TRUE objections only (a DQ objection in a closed call must not
  // inflate the handled→closed marginal). Own coefficients; injected (personal
  // borrow) coefficients are the caller's responsibility to keep true-only.
  var link = computeLinkage(scoped, analyses);

  // Money coefficients: TEAM-BORROWED when injected (personal), else OWN.
  var inj = opts.injected || null;
  var borrowed = !!inj;
  var mDelta = borrowed ? inj.delta : link.delta;
  var mAvgCash = borrowed ? inj.avgCash : link.avgCash;
  var mHN = borrowed ? inj.handledN : link.handledN;
  var mNN = borrowed ? inj.notHandledN : link.notHandledN;
  var mClosed = borrowed ? inj.closedCount : link.closedCount;
  var mPH = borrowed ? inj.pH : link.pH;
  var mPN = borrowed ? inj.pN : link.pN;

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
      buckets: list, mapping: mappingOut, quotes: [], subject: subject,
      context: { disqualifications: context.disqualifications, logistical: context.logistical },
      linkage: { p_closed_handled: mPH, p_closed_nothandled: mPN, delta: mDelta, handled_n: mHN, nothandled_n: mNN, borrowed: borrowed },
      avg_cash: Math.round(mAvgCash * 100) / 100, closed_calls: mClosed, analyzed_calls: analyzed, objections: totalObj,
    };
  }

  var insufficientText = subject === 'personal'
    ? 'Not enough of your objections yet to pinpoint a focus area — keep logging calls.'
    : 'Not enough objection volume this period to pinpoint a focus area.';
  // Overall-volume gate → deterministic insufficient (cacheable, no Claude).
  if (analyzed < minAnalyzed || totalObj === 0) {
    return { state: 'insufficient', headline: 'What needs work', card_text: insufficientText,
      bucket: null, extra: null, detail: baseDetail(null), generated_at: new Date().toISOString() };
  }

  var moneyGatesGlobal = (mDelta != null && mDelta > 0 && mHN >= MIN_LINK_GROUP && mNN >= MIN_LINK_GROUP && mClosed >= MIN_CLOSED && mAvgCash > 0);

  // Candidate weak buckets (exclude the 'Other' grab-bag from being the focus).
  var candidates = [];
  Object.keys(buckets).forEach(function (label) {
    if (label === 'Other') return;
    var b = buckets[label];
    if (b.total < minBucket) return;
    var otherTotal = totalObj - b.total, otherHandled = totalHandled - b.handled;
    var baseline = otherTotal > 0 ? otherHandled / otherTotal : 0;
    var rate = b.total > 0 ? b.handled / b.total : 0;
    var gapPP = (baseline - rate) * 100;
    if (gapPP < MIN_GAP_PP) return; // not a relative weakness
    var addHandled = Math.max(0, Math.min(b.total - b.handled, baseline * b.total - b.handled));
    var extraDeals = moneyGatesGlobal ? addHandled * mDelta : null;
    var extraCash = (extraDeals != null) ? extraDeals * mAvgCash : null;
    candidates.push({ b: b, baseline: baseline, otherTotal: otherTotal, otherHandled: otherHandled, rate: rate, gapPP: gapPP, addHandled: addHandled, extraDeals: extraDeals, extraCash: extraCash });
  });

  if (candidates.length === 0) {
    return { state: 'insufficient', headline: 'What needs work',
      card_text: subject === 'personal' ? 'No single objection type stands out as a weak spot for you yet.' : 'No single objection type stands out as a weakness this period.',
      bucket: null, extra: null, detail: baseDetail(null), generated_at: new Date().toISOString() };
  }

  // Money-eligible candidates need the global gates AND enough expected deals.
  var moneyCands = candidates.filter(function (c) { return c.extraCash != null && c.extraDeals >= MIN_DEALS_FOR_CASH; });
  var focus, state;
  if (moneyCands.length) { moneyCands.sort(function (a, b) { return b.extraCash - a.extraCash; }); focus = moneyCands[0]; state = 'money'; }
  else { candidates.sort(function (a, b) { return b.gapPP - a.gapPP; }); focus = candidates[0]; state = 'rate_gap'; }

  var label = focus.b.label;
  var bH = focus.b.handled, bT = focus.b.total;
  var rateW = pctWhole(bH, bT);
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
    extra = { additional_handled: round1(focus.addHandled), delta: mDelta, avg_cash: mAvgCash, extra_deals: focus.extraDeals, extra_cash: focus.extraCash, borrowed: borrowed };
    if (subject === 'personal') {
      // Raw counts beside every rate (ruling 4); plain team-borrow phrasing (ruling 3).
      card_text = 'You handled “' + label + '” objections ' + bH + ' of ' + bT + ' times (' + rateW + '%) — your weakest area, vs ' + baseW +
        '% on your other objections. Closing that gap ≈ ' + deals + ' more ' + (deals === 1 ? 'deal' : 'deals') +
        ' ≈ $' + cash.toLocaleString('en-US') + ' more collected' + (borrowed ? ', based on your team’s typical deal size.' : '.');
    } else {
      card_text = 'Your team handles “' + label + '” objections at ' + rateW + '%, vs ' + baseW +
        '% on every other objection this period. Closing that gap ≈ ' + round1(focus.addHandled) +
        ' more handled ≈ ' + deals + ' more ' + (deals === 1 ? 'deal' : 'deals') +
        ' ≈ $' + cash.toLocaleString('en-US') + ' more collected.';
    }
  } else {
    extra = { additional_handled: round1(focus.addHandled), delta: mDelta, avg_cash: mAvgCash, extra_deals: null, extra_cash: null, borrowed: borrowed };
    if (subject === 'personal') {
      card_text = 'You handled “' + label + '” objections ' + bH + ' of ' + bT + ' times (' + rateW + '%) — your weakest area, vs ' + baseW +
        '% on your other objections this period.';
    } else {
      card_text = 'Your team handles “' + label + '” objections at ' + rateW + '%, the biggest gap vs ' + baseW +
        '% on every other objection this period.';
    }
  }

  return {
    state: state, headline: 'What needs work',
    bucket: { label: label, total: bT, handled: bH, rate_pct: rateW, baseline_pct: baseW, baseline_handled: focus.otherHandled, baseline_total: focus.otherTotal, gap_pp: round1(focus.gapPP) },
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
    + '||kb:' + selling.kbHash + '||lane:' + NEEDS_WORK_LANE_VERSION
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

  var mapRes = await getBucketMapping(objs);
  if (!mapRes.ok) {
    if (mapRes.empty) { var none = computeNeedsWork(objs, analyses, {}); await cachePut(admin, keyId, 'team_needs_work', from, to, hash, none); return Object.assign({ available: true, cached: false }, none); }
    return { available: false, reason: mapRes.reason };
  }

  var result = computeNeedsWork(objs, analyses, mapRes.mapping, { bucketClass: mapRes.bucketClass });
  await cachePut(admin, keyId, 'team_needs_work', from, to, hash, result);
  return Object.assign({ available: true, cached: false }, result);
}

var BUCKET_CLASSES = ['true_objection', 'logistical_barrier', 'disqualification'];
// Claude bucketing of the DISTINCT surfaces only (no numbers). It (a) groups
// COARSELY — collapses synonyms into one bucket — and (b) CLASSIFIES each bucket.
// Returns {ok:true, mapping, bucketClass} | {ok:false, empty:true} | {ok:false, reason}.
async function getBucketMapping(objs) {
  var counts = {};
  objs.forEach(function (o) { var k = String(o.surface == null ? '' : o.surface).trim(); if (k) counts[k] = (counts[k] || 0) + 1; });
  var distinct = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  if (distinct.length === 0) return { ok: false, empty: true };

  var prompt = [
    'You are grouping and classifying sales-objection phrases.',
    'Below is every DISTINCT objection phrase a salesperson heard this period (with how many times it came up).',
    '',
    'STEP 1 — GROUP COARSELY. Collapse synonyms and near-duplicates into ONE bucket; do NOT make several buckets that mean the same thing. Aim for 4-8 buckets. Examples of coarse buckets: "Price / too expensive", "Timing", "Spouse / partner", "Trust / proof". Give each a short human label (<= 30 chars).',
    'Keep each bucket CLASSIFICATION-COHERENT (step 2): never mix, say, a price objection with a declined payment in the same bucket — split them.',
    '',
    'STEP 2 — CLASSIFY each bucket as exactly one "class":',
    '  "true_objection"     — a real, coachable objection the closer can overcome (price/too expensive, timing, needs to think, spouse approval, trust/proof, competitor).',
    '  "logistical_barrier" — a mechanical/process problem, NOT a coachable objection. A FAILED or DECLINED PAYMENT belongs here (card declined, payment failed, plan lapsed, financing fell through).',
    '  "disqualification"   — the prospect is not a fit / cannot buy. "No money", "can\'t afford it", "no funding" is a DISQUALIFICATION, not an objection.',
    'Rule of thumb: a declined payment = logistical_barrier; "no money / can\'t buy" = disqualification; both are NOT coachable objections.',
    '',
    'Rules: assign EVERY phrase to exactly one bucket. Do NOT output counts, rates, money, or any number. Do NOT invent phrases.',
    '',
    'PHRASES (phrase — count):',
  ].concat(distinct.map(function (s) { return '  - ' + s + ' — ' + counts[s]; })).concat([
    '',
    'Respond with ONLY this JSON — no markdown:',
    '{ "buckets": [ { "label": "Price / too expensive", "class": "true_objection", "phrases": ["too expensive", "wants lower price"] }, { "label": "Payment failure", "class": "logistical_barrier", "phrases": ["card declined"] } ] }',
  ]).join('\n');

  var mapping = {}, bucketClass = {};
  try {
    var resp = await getAnthropic().messages.create({ model: CLAUDE_MODEL, max_tokens: BUCKET_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
    var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
    if (!parsed || !Array.isArray(parsed.buckets)) return { ok: false, reason: 'Bucketing returned unusable output — will retry on the next load.' };
    parsed.buckets.forEach(function (bk) {
      var label = str(bk && bk.label, 30); if (!label) return;
      var cls = (bk && BUCKET_CLASSES.indexOf(bk.class) !== -1) ? bk.class : 'true_objection'; // default coachable
      bucketClass[label] = cls;
      (Array.isArray(bk && bk.phrases) ? bk.phrases : []).forEach(function (p) { var k = normSurface(p); if (k) mapping[k] = label; });
    });
  } catch (e) {
    return { ok: false, reason: 'Anthropic API failure' + ((e && e.status) ? ' (HTTP ' + e.status + ')' : '') + ': ' + ((e && e.message) || 'unknown') };
  }
  return { ok: true, mapping: mapping, bucketClass: bucketClass };
}

// Item #3: per-call evidence for one bucket — the objection moments whose
// surface is in `surfaces`, across `userIds` in [from,to], newest-first.
// Returns [{ call_id, date, title, quote, closer_response, clip_url }].
async function loadBucketEvidence(admin, userIds, surfaces, from, to) {
  if (!userIds || !userIds.length || !surfaces || !surfaces.length) return [];
  var want = {}; surfaces.forEach(function (s) { want[normSurface(s)] = true; });
  var w = await loadTeamWindow(admin, userIds, from, to);
  if (!w.callIds.length) return [];
  var rows = await w.inChunks('call_highlights',
    'fathom_call_id, timestamp_seconds, quote, closer_response, objection_surface, resolution, type',
    function (q) { return q.eq('type', 'objection'); });
  var clip = function (cid, ts) { var rec = w.meta[cid] && w.meta[cid].recording_url; return (rec && typeof ts === 'number') ? rec + (rec.indexOf('?') === -1 ? '?' : '&') + 't=' + ts : null; };
  // PROSPECT NAMES 3a — this evidence view is meant to read "July 12th Call with
  // Jim Stone", so it shows the resolved PROSPECT NAME, falling back to the raw
  // meeting title when the name could not be resolved. (Deliberately NOT applied
  // to the objections feed or the team digest — see CLAUDE.md: on those
  // cross-call scanning surfaces the title is a call LABEL and its program
  // prefix carries information a bare name loses.)
  var nameRows = await w.inChunks('call_analyses', 'fathom_call_id, prospect_name');
  var nameByCall = {};
  nameRows.forEach(function (n) { if (n && n.prospect_name) nameByCall[n.fathom_call_id] = n.prospect_name; });
  return rows.filter(function (r) { return want[normSurface(r.objection_surface)]; }).map(function (r) {
    var c = w.meta[r.fathom_call_id] || {};
    return { call_id: r.fathom_call_id, date: c.call_date || null,
      title: nameByCall[r.fathom_call_id] || c.title || null,
      prospect_name: nameByCall[r.fathom_call_id] || null,
      surface: r.objection_surface, handled: r.resolution === 'handled',
      quote: str(r.quote, 400), closer_response: str(r.closer_response, 400), clip_url: clip(r.fathom_call_id, r.timestamp_seconds) };
  }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
}

// Map raw call_highlights objection rows → the core's obj shape.
function toObjs(objRows, w) {
  var clip = function (cid, ts) { var rec = w.meta[cid] && w.meta[cid].recording_url; return (rec && typeof ts === 'number') ? rec + (rec.indexOf('?') === -1 ? '?' : '&') + 't=' + ts : null; };
  return objRows.map(function (r) {
    return { call_id: r.fathom_call_id, surface: r.objection_surface, handled: r.resolution === 'handled',
      quote: str(r.quote, 300), observation: str(r.observation, 240), rep: null, clip_url: clip(r.fathom_call_id, r.timestamp_seconds) };
  });
}
var OBJ_COLS = 'fathom_call_id, timestamp_seconds, quote, observation, closer_response, objection_surface, resolution, type';
var ANALYSIS_COLS = 'fathom_call_id, analyzed_at, outcome, cash_collected, status';

// ── Personal "What needs work" (A-2.1) ──────────────────────────────────────
// The closer's OWN objection buckets (self-vs-self rate + gap). The MONEY clause
// borrows the closer's TEAM's pooled Δ + avg-cash (stable sample) when they're on
// a team; otherwise it degrades to rate-gap-only. Cache lane 'needs_work' keyed
// by the user. Same envelope family as the team lane.
// Personal cache uses a FIXED window identity (not the drifting from/to) so
// there is exactly ONE entry per user; the analyses-set hash is what refreshes
// it as the rolling 90d content changes. window_days is echoed for the UI label.
async function computePersonalNeedsWork(admin, userId, from, to) {
  var personalOpts = { subject: 'personal', minBucket: PERSONAL_MIN_BUCKET, minAnalyzed: PERSONAL_MIN_ANALYZED };
  // Range-responsive (2026-07-27): computes on the SELECTED window, labels it,
  // and caches per range. window_days echoed for the UI label.
  var windowDays = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
  function stamp(r) { r.window_days = windowDays; return r; }
  var w = await loadTeamWindow(admin, [userId], from, to);
  if (w.callIds.length === 0) return Object.assign({ available: true, cached: false }, stamp(computeNeedsWork([], [], {}, personalOpts)));

  var analyses = await w.inChunks('call_analyses', ANALYSIS_COLS, function (q) { return q.eq('status', 'done'); });
  var objRows = await w.inChunks('call_highlights', OBJ_COLS, function (q) { return q.eq('type', 'objection'); });
  var objs = toObjs(objRows, w);

  // Team-borrow: resolve the closer's manager, then pool that manager's whole
  // rep set over the SAME window for stable Δ + avg-cash coefficients.
  var injected = null, teamKeyForHash = '';
  var prof = await admin.from('user_profiles').select('managed_by').eq('user_id', userId).maybeSingle();
  var managedBy = prof && prof.data && prof.data.managed_by;
  if (managedBy) {
    var repsQ = await admin.from('user_profiles').select('user_id').eq('managed_by', managedBy);
    var repIds = (repsQ.error ? [] : (repsQ.data || []).map(function (x) { return x.user_id; }));
    if (repIds.length) {
      var tw = await loadTeamWindow(admin, repIds, from, to);
      if (tw.callIds.length) {
        var tAnalyses = await tw.inChunks('call_analyses', ANALYSIS_COLS, function (q) { return q.eq('status', 'done'); });
        var tObjRows = await tw.inChunks('call_highlights', 'fathom_call_id, objection_surface, resolution, type', function (q) { return q.eq('type', 'objection'); });
        var tObjs = tObjRows.map(function (r) { return { call_id: r.fathom_call_id, surface: r.objection_surface, handled: r.resolution === 'handled' }; });
        var link = computeLinkage(tObjs, tAnalyses);
        if (link.delta != null) { injected = { delta: link.delta, avgCash: link.avgCash, handledN: link.handledN, notHandledN: link.notHandledN, closedCount: link.closedCount, pH: link.pH, pN: link.pN }; }
        teamKeyForHash = managedBy + ':' + repIds.slice().sort().join(',');
      }
    }
  }

  var selling = await fetchSellingContext(admin, userId, 1, SYNTHESIS_CATEGORIES);
  var hash = crypto.createHash('md5').update(
    analyses.map(function (a) { return a.fathom_call_id + ':' + a.analyzed_at; }).sort().join('|')
    + '||surf:' + objs.map(function (o) { return normSurface(o.surface); }).sort().join(',')
    + '||inj:' + (injected ? (injected.delta.toFixed(4) + '/' + Math.round(injected.avgCash)) : 'none')
    + '||kb:' + selling.kbHash + '||lane:' + NEEDS_WORK_LANE_VERSION
  ).digest('hex');

  var cached = await cacheGet(admin, userId, 'needs_work', from, to, hash);
  if (cached) return Object.assign({ available: true, cached: true }, stamp(cached));

  if (analyses.length < PERSONAL_MIN_ANALYZED || objs.length === 0) {
    var pre = computeNeedsWork(objs, analyses, {}, personalOpts);
    await cachePut(admin, userId, 'needs_work', from, to, hash, pre);
    return Object.assign({ available: true, cached: false }, stamp(pre));
  }

  var mapRes = await getBucketMapping(objs);
  if (!mapRes.ok) {
    if (mapRes.empty) { var none = computeNeedsWork(objs, analyses, {}, personalOpts); await cachePut(admin, userId, 'needs_work', from, to, hash, none); return Object.assign({ available: true, cached: false }, stamp(none)); }
    return { available: false, reason: mapRes.reason };
  }

  var result = computeNeedsWork(objs, analyses, mapRes.mapping, { subject: 'personal', minBucket: PERSONAL_MIN_BUCKET, minAnalyzed: PERSONAL_MIN_ANALYZED, injected: injected, bucketClass: mapRes.bucketClass });
  await cachePut(admin, userId, 'needs_work', from, to, hash, result);
  return Object.assign({ available: true, cached: false }, stamp(result));
}

module.exports = {
  computeTeamNeedsWork: computeTeamNeedsWork,
  computePersonalNeedsWork: computePersonalNeedsWork,
  loadBucketEvidence: loadBucketEvidence,
  // pure test surface (underscore = test-only)
  _computeNeedsWork: computeNeedsWork,
  _computeLinkage: computeLinkage,
  _MIN_BUCKET: MIN_BUCKET, _MIN_GAP_PP: MIN_GAP_PP, _MIN_LINK_GROUP: MIN_LINK_GROUP,
  _MIN_CLOSED: MIN_CLOSED, _MIN_ANALYZED: MIN_ANALYZED, _MIN_DEALS_FOR_CASH: MIN_DEALS_FOR_CASH,
  _PERSONAL_MIN_BUCKET: PERSONAL_MIN_BUCKET, _PERSONAL_MIN_ANALYZED: PERSONAL_MIN_ANALYZED,
};
