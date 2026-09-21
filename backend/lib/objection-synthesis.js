// Grounded objection coaching synthesis (Objections view).
//
// For each objection category present in the window, produces ISOLATE → REFRAME
// → OVERCOME coaching. GROUNDED-FIRST: where the closer has handled examples of
// that category, the advice references their own real handling (with the quote +
// clip surfaced as evidence); otherwise it uses only saved team material or
// returns no guidance. One Claude call per (user, range, analysis-set), cached in
// objection_synthesis_cache and invalidated by the analysis_set_hash.

const Anthropic = require('@anthropic-ai/sdk');
const { CHUNK } = require('./chunk');   // ⚠ the one `.in()` chunk size (③-6) — never a literal here
const createWithUsage = require('./model-usage').usageFor('objection-synthesis');
const { isHandled, outcomeMap } = require('./objection-handled');
const { strictObjections } = require('./objection-strict');
const { snapCacheWindow } = require('./cache-window');
const crypto = require('crypto');
const { CLAUDE_MODEL } = require('../config');

const { clipHref } = require('./clip-link');
const { displayCloserResponse, provenCloserResponse } = require('./closer-side');
const OBJECTION_CATEGORIES = require('./objection-categories').STORED_OBJECTION_CATEGORIES;   /* ⚠ ONE SOURCE (fix #7, H680): the ruled set in its stored order — never a literal copy here (sweep ③-3) */
const SYNTH_MAX_TOKENS = 2500;

var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Brace-balanced first-JSON-object extractor (same approach as the worker).
function extractJson(text) {
  if (!text) return null;
  var cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }
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

function str(x, cap) { return (typeof x === 'string' && x.trim()) ? x.trim().slice(0, cap || 600) : null; }

// A combined "either/or" answer is a list of unrelated calls, not the useful
// repeated behavior this surface promises. In that case silence is truer.
function sharedPattern(x, cap) {
  var value = str(x, cap);
  return value && !/\beither\b/i.test(value) ? value : null;
}

function observedMissedPattern(x, cap) {
  var value = sharedPattern(x, cap);
  // The saved moment proves the closer's action, not what it caused the prospect
  // to do later. Withhold causal storytelling rather than present it as evidence.
  return value && !/\b(?:allowed|caused|resulted|led|kept)\b[^.]{0,140}\b(?:prospect|deferral|decision|close|outcome|loss)\b/i.test(value) ? value : null;
}

function eligibleObjectionRows(rows) {
  return strictObjections(rows || []);
}

function normSurface(value) { return String(value == null ? '' : value).trim().toLowerCase(); }

function focusRows(rows, focus) {
  if (!focus || !Array.isArray(focus.surfaces) || !focus.surfaces.length) return rows || [];
  var wanted = {};
  focus.surfaces.forEach(function(surface) { var key = normSurface(surface); if (key) wanted[key] = true; });
  return (rows || []).filter(function(row) { return !!wanted[normSurface(row.objection_surface)]; });
}

function focusFromQuery(value) {
  if (typeof value !== 'string' || value.length > 20000) return null;
  try {
    var parsed = JSON.parse(value);
    var label = typeof parsed.label === 'string' ? parsed.label.trim().slice(0, 80) : '';
    var surfaces = Array.isArray(parsed.surfaces) ? parsed.surfaces
      .filter(function(surface) { return typeof surface === 'string' && surface.trim(); })
      .slice(0, 200).map(function(surface) { return surface.trim().slice(0, 300); }) : [];
    return label && surfaces.length ? { label: label, surfaces: surfaces } : null;
  } catch (_) { return null; }
}

// ⚠ delegates to lib/clip-link.js — the ONE place a deep link is built.
// Building it here would mean labelling it here, and this module does not
// know the provider. Pinned by test/clip-link-single-source.test.js.
function clipUrl(meta, ts) {
  if (!meta) return null;
  return clipHref(meta.recording_url, ts);
}

var SYNTH_PROMPT_VERSION = 'v9-2026-09-21-focus-population-alignment';
function buildSynthPrompt(present, byCat, material) {
  var lines = [
    'You are a high-ticket sales coach. For each objection category below, give the closer concise, actionable coaching structured as ISOLATE → REFRAME → OVERCOME:',
    '  - Isolate: confirm it is the real/only objection before addressing it.',
    '  - Reframe: shift the frame the objection lives in.',
    '  - Overcome: resolve it and advance to the close.',
    'Where HANDLED examples (the closer\'s own words) are provided, GROUND your advice in what THEY actually did — build on their real approach, do not invent. Where none are provided, use only the saved team material; if it does not speak to the category, return null rather than generic advice.',
    'Each of isolate/reframe/overcome must be 1-2 concrete sentences. No fluff, no cheerleading.',
    'Do not borrow a specific call, phrase, or technique from a different objection category. Each category must be coached from its own eligible examples and applicable team material.',
    'For a category with handled examples, also write what_worked: one short sentence describing the repeatable move the closer used successfully. Ground it only in those handled examples and the team material, not a transcript fragment or generic advice. If there are no handled examples, return null for what_worked.',
    'For a category with at least TWO handled examples, also write when_handled: one short, plain-language summary of the repeated behavior that made those objections move forward. State only what the examples show; do not claim a call closed unless the example says it did. Do not list separate calls. If the examples do not show one shared behavior, return null; also return null with fewer than two handled examples.',
    'For a category with at least TWO NOT-HANDLED examples, also write when_not_handled: one short, plain-language summary of what the closer did or failed to do in those examples. These are explicitly partial or unhandled moments, not inferred failures. State only what the examples show; do not infer intent or claim a loss unless the example says it did. Do not list the separate calls with “either/or” wording. If the examples do not show one shared behavior, return null; also return null with fewer than two not-handled examples.',
    'For a category with a CLOSED HANDLED REVIEW EXAMPLE, also write practice: one direct sentence telling the closer what to practice. Ground it only in that closed handled example and the team material. If there is no closed handled review example, return null for practice.',
    'Fear practice: first isolate whether the stated concern is the real blocker. Do not recommend a payment plan, BNPL, price change, or other solution before that isolation. Only after it is the real blocker may the sentence name the response that worked in the review call.',
    '',
    'Note: money-phrased objections ("too expensive", "can\'t afford it") are categorized as "fear" in this domain.',
    '',
    'CATEGORIES:',
  ];
  present.forEach(function(c) {
    var b = byCat[c];
    var missedExamples = b.missedExamples || [];
    lines.push('### ' + c.toUpperCase() + ' — ' + b.count + ' objections, ' + b.handled + ' handled');
    if (b.examples.length) {
      lines.push('  Handled examples (the closer\'s own words):');
      b.examples.forEach(function(e) {
        lines.push('    - prospect said "' + (e.surface || e.quote || '').slice(0, 80) + '" → closer responded: "' + (e.closer_response || '').slice(0, 320) + '"');
      });
    } else {
        /* H731: NO GENERIC FALLBACK. A category with no handled example and nothing in the knowledge base that
         speaks to it gets NO advice — the fields come back null and the surface says so. */
      lines.push('  (no handled examples in this window — if the TEAM MATERIAL below speaks to this category, coach from it and say so; if it does not, return null for isolate, reframe and overcome — never general best practice)');
    }
    if (missedExamples.length) {
      lines.push('  Not-handled examples (explicit partial or unhandled moments):');
      missedExamples.forEach(function(e) {
        lines.push('    - prospect said "' + (e.surface || e.quote || '').slice(0, 80) + '" → closer responded: "' + (e.closer_response || '__no_reply__').slice(0, 320) + '"' + (e.observation ? ' · observed: "' + e.observation.slice(0, 240) + '"' : ''));
      });
    }
    if (b.closedExamples && b.closedExamples.length) {
      var review = b.closedExamples[0];
      lines.push('  CLOSED HANDLED REVIEW EXAMPLE (the objection was explicitly handled and this same call closed):');
      lines.push('    - prospect said "' + (review.surface || review.quote || '').slice(0, 80) + '" → closer responded: "' + (review.closer_response || '').slice(0, 320) + '"');
    }
  });
  lines.push('');
  if (material && material.doctrineBlock) { var dblock = material.doctrineBlock('objection-synthesis'); if (dblock) { lines.push(dblock); lines.push(''); } }   // H732
  if (material && material.contextText) { lines.push('TEAM MATERIAL (this closer\'s offer, qualifications and approach — ground every sentence in it):'); lines.push(material.contextText.trim()); lines.push(''); }
  if (material && material.notes && material.notes.text) { lines.push(require('./coaching-corrections').promptLane(material.notes.text)); lines.push(''); }
  lines.push('Respond with ONLY this JSON — no markdown, no code fences:');
  lines.push('{"categories":[{"category":"fear","isolate":"...","reframe":"...","overcome":"...","what_worked":"... or null","when_handled":"... or null","when_not_handled":"... or null","practice":"... or null"}]}');
  return lines.join('\n');
}

function mergeGuidance(present, byCat, guide, lossScope) {
  return present.map(function(c) {
    var bucket = byCat[c], guidance = guide[c] || {};
    var hasHandledExample = bucket.examples.length > 0;
    var missedExamples = bucket.missedExamples || [];
    var reviewExample = bucket.closedExamples && bucket.closedExamples.length ? bucket.closedExamples[0] : null;
    return {
      category: c, count: bucket.count, handled: bucket.handled, grounded: hasHandledExample,
      isolate: require('./doctrine').enforceLossRule(str(guidance.isolate, 500), lossScope, null, 'objection-synthesis'),
      reframe: require('./doctrine').enforceLossRule(str(guidance.reframe, 500), lossScope, null, 'objection-synthesis'),
      overcome: require('./doctrine').enforceLossRule(str(guidance.overcome, 500), lossScope, null, 'objection-synthesis'),
      // A closed call can credit a rate, but it never manufactures a worked example.
      what_worked: hasHandledExample
        ? require('./doctrine').enforceLossRule(str(guidance.what_worked, 500), lossScope, null, 'objection-synthesis')
        : null,
      when_handled: bucket.examples.length >= 2
        ? require('./doctrine').enforceLossRule(sharedPattern(guidance.when_handled, 500), lossScope, null, 'objection-synthesis')
        : null,
      when_not_handled: missedExamples.length >= 2
        ? require('./doctrine').enforceLossRule(observedMissedPattern(guidance.when_not_handled, 500), lossScope, null, 'objection-synthesis')
        : null,
      practice: reviewExample
        ? require('./doctrine').enforceLossRule(str(guidance.practice, 220), lossScope, null, 'objection-synthesis')
        : null,
      review_example: reviewExample,
      evidence: bucket.examples.slice(0, 2),
    };
  });
}

async function computeObjectionSynthesis(admin, userId, from, to, focus) {
  // 1) calls in window (recording_url powers clip links).
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls')
      .select('id, title, recording_url, call_date, source')
      .eq('user_id', userId).gte('call_date', from).lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
      .order('call_date', { ascending: false, nullsFirst: false })
      .range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var cb = cq.data || [];
    calls = calls.concat(cb);
    if (cb.length < PAGE) break;
    start += PAGE;
  }
  var meta = {}, callIds = [];
  calls.forEach(function(c) { meta[c.id] = c; callIds.push(c.id); });
  if (callIds.length === 0) return { available: true, categories: [], generated_at: new Date().toISOString() };

  async function inChunks(table, cols, refine) {
    var out = [];
    for (var i = 0; i < callIds.length; i += CHUNK) {
      var qb = admin.from(table).select(cols).in('fathom_call_id', callIds.slice(i, i + CHUNK));
      if (refine) qb = refine(qb);
      var r = await qb;
      if (r.error) throw new Error(table + ': ' + r.error.message);
      out = out.concat(r.data || []);
    }
    return out;
  }

  // 2) done analyses → analysis_set_hash (cache invalidation).
  // `outcome` added 2026-08-17: an objection on a closed call counts as handled.
  // Same select, one more column — no extra query.
  var done = await inChunks('call_analyses', 'fathom_call_id, analyzed_at, outcome, prospect_name', function(q) { return q.eq('status', 'done'); });
  var outcomeByCall = outcomeMap(done);
  var analysisByCall = {};
  done.forEach(function(d) { analysisByCall[d.fathom_call_id] = d; });
  var hashInput = done.map(function(d) { return d.fathom_call_id + ':' + d.analyzed_at; }).sort().join('|');
  /* H731: the material rides the hash — a profile edit or a new note regenerates; the version too. */
  var material = await require('./kb-material').loadKbMaterial(admin, { userId: userId, lane: 'objection-synthesis', maxChars: 2500 });
  var focusKey = focus && typeof focus.label === 'string' ? normSurface(focus.label) : '';
  var focusHash = focusKey + ':' + ((focus && Array.isArray(focus.surfaces)) ? focus.surfaces.map(normSurface).filter(Boolean).sort().join('|') : '');
  var hash = crypto.createHash('md5').update((hashInput || 'empty') + '|' + SYNTH_PROMPT_VERSION + '|focus:' + focusHash + '|kb:' + material.kbHash).digest('hex');

  // 3) cache check.
  // Key snapped to UTC day boundaries — see lib/cache-window.js. The hash above
  // already carries freshness, so the millisecond precision only forced misses.
  var ck = snapCacheWindow(from, to);
  var cacheQ = await admin.from('objection_synthesis_cache')
    .select('synthesis').eq('user_id', userId).eq('synthesis_type', 'objections').eq('from_ts', ck.from).eq('to_ts', ck.to).eq('analysis_set_hash', hash)
    .maybeSingle();
  if (!cacheQ.error && cacheQ.data && cacheQ.data.synthesis) {
  if (!material.hasMaterial) return require('./kb-material').nothingToSay({ categories: [], generated_at: new Date().toISOString() });   // H731: nothing relevant → nothing said
    return Object.assign({ available: true, cached: true }, cacheQ.data.synthesis);
  }

  // 4) categorized objection highlights → per-category counts + handled examples.
  var rows = await inChunks('call_highlights',
    'fathom_call_id, timestamp_seconds, quote, observation, objection_surface, objection_category, resolution, closer_response, closer_response_verified, type, objection_class',
    function(q) { return q.in('type', ['objection', 'disqualify_signal']); });
  var lossScope = require('./doctrine').lossScope(done, rows);   // H733: which of this closer's calls carry a disqualification
  rows = eligibleObjectionRows(rows.filter(function (r) { return r.type === 'objection'; }));
  rows = focusRows(rows, focus);
  var byCat = {};
  var categories = focusKey ? [focusKey] : OBJECTION_CATEGORIES;
  categories.forEach(function(c) { byCat[c] = { count: 0, handled: 0, examples: [], missedExamples: [], closedExamples: [] }; });
  rows.forEach(function(r) {
    var b = byCat[focusKey || r.objection_category];
    if (!b) return; // null / uncategorized — excluded
    b.count += 1;
    // ⚠ TWO DIFFERENT QUESTIONS ON ONE ROW, and they get two different answers.
    // The COUNT is a rate the synthesis quotes, so it follows the 2026-08-17
    // ruling and credits objections on closed calls. The EXAMPLE is evidence of
    // GOOD HANDLING shown to a closer — a credited-but-unhandled moment is not
    // that, and putting it forward would hold up weak handling as the model to
    // copy. Examples stay on the moment's own resolution.
    if (isHandled(r, outcomeByCall[r.fathom_call_id])) b.handled += 1;
    if (r.resolution === 'handled') {
      /* ⚠ SENTINEL-GATED: an example is EVIDENCE OF GOOD HANDLING shown to a
         closer — a sentinel is not something he said. */
      if (provenCloserResponse(r)) {
        var example = { quote: str(r.quote, 300), closer_response: str(provenCloserResponse(r), 400), surface: str(r.objection_surface, 80), clip_url: clipUrl(meta[r.fathom_call_id], r.timestamp_seconds),
          source: (meta[r.fathom_call_id] || {}).source || null };
        if (b.examples.length < 3) b.examples.push(example);
        if (outcomeByCall[r.fathom_call_id] === 'closed') {
          var analysis = analysisByCall[r.fathom_call_id] || {};
          b.closedExamples.push(Object.assign({}, example, {
            call_id: r.fathom_call_id,
            prospect_name: str(analysis.prospect_name, 160) || str((meta[r.fathom_call_id] || {}).title, 160),
            call_date: (meta[r.fathom_call_id] || {}).call_date || null,
            outcome: 'closed',
            timestamp_seconds: typeof r.timestamp_seconds === 'number' ? r.timestamp_seconds : null,
          }));
        }
      }
    }
    if ((r.resolution === 'partial' || r.resolution === 'unhandled') && b.missedExamples.length < 3) {
      var missedResponse = provenCloserResponse(r);
      var missedObservation = str(r.observation, 300);
      if (missedResponse || missedObservation) {
        b.missedExamples.push({
          quote: str(r.quote, 300),
          closer_response: str(missedResponse, 400),
          surface: str(r.objection_surface, 80),
          observation: missedObservation,
          resolution: r.resolution,
        });
      }
    }
  });
  Object.keys(byCat).forEach(function(c) {
    byCat[c].closedExamples.sort(function(a, b) {
      return String(b.call_date || '').localeCompare(String(a.call_date || '')) || (b.timestamp_seconds || 0) - (a.timestamp_seconds || 0);
    });
  });
  var present = categories.filter(function(c) { return byCat[c].count > 0; })
    .sort(function(a, b) { return byCat[b].count - byCat[a].count; });
  if (present.length === 0) return { available: true, categories: [], generated_at: new Date().toISOString() };

  // 5) one Claude call. Credit/quota/5xx → unavailable (do NOT cache failures).
  var resp;
  try {
    resp = await createWithUsage({
      model: CLAUDE_MODEL, max_tokens: SYNTH_MAX_TOKENS,
      messages: [{ role: 'user', content: buildSynthPrompt(present, byCat, material) }],
    });
  } catch (apiErr) {
    return { available: false, reason: 'Anthropic API failure' + ((apiErr && apiErr.status) ? ' (HTTP ' + apiErr.status + ')' : '') + ': ' + ((apiErr && apiErr.message) || 'unknown') };
  }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed || !Array.isArray(parsed.categories)) return { available: false, reason: 'synthesis returned unparseable output' };

  // 6) merge Claude guidance with the REAL counts/handled/evidence (evidence is
  //    never LLM-generated — it's the actual handled example from the DB).
  var guide = {};
  parsed.categories.forEach(function(g) { if (g && g.category) guide[String(g.category).toLowerCase()] = g; });
  var categories = mergeGuidance(present, byCat, guide, lossScope);
  var synthesis = { categories: categories, generated_at: new Date().toISOString() };

  // 7) cache (best-effort — a cache write failure shouldn't fail the response).
  var up = await admin.from('objection_synthesis_cache').upsert(
    { user_id: userId, synthesis_type: 'objections', from_ts: ck.from, to_ts: ck.to, analysis_set_hash: hash, synthesis: synthesis, generated_at: synthesis.generated_at },
    { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[synthesis] cache write failed for user ' + userId + ': ' + up.error.message);

  return Object.assign({ available: true, cached: false }, synthesis);
}

module.exports = { computeObjectionSynthesis: computeObjectionSynthesis, focusFromQuery: focusFromQuery, _buildSynthPrompt: buildSynthPrompt, _mergeGuidance: mergeGuidance, _eligibleObjectionRows: eligibleObjectionRows, _focusRows: focusRows, _focusFromQuery: focusFromQuery, _SYNTH_PROMPT_VERSION: SYNTH_PROMPT_VERSION };
