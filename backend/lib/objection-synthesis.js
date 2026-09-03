// Grounded objection coaching synthesis (Objections view).
//
// For each objection category present in the window, produces ISOLATE → REFRAME
// → OVERCOME coaching. GROUNDED-FIRST: where the closer has handled examples of
// that category, the advice references their own real handling (with the quote +
// clip surfaced as evidence); otherwise it's general best practice, clearly
// labeled. One Claude call per (user, range, analysis-set), cached in
// objection_synthesis_cache and invalidated by the analysis_set_hash.

const Anthropic = require('@anthropic-ai/sdk');
const createWithUsage = require('./model-usage').usageFor('objection-synthesis');
const { isHandled, outcomeMap } = require('./objection-handled');
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

// ⚠ delegates to lib/clip-link.js — the ONE place a deep link is built.
// Building it here would mean labelling it here, and this module does not
// know the provider. Pinned by test/clip-link-single-source.test.js.
function clipUrl(meta, ts) {
  if (!meta) return null;
  return clipHref(meta.recording_url, ts);
}

function buildSynthPrompt(present, byCat) {
  var lines = [
    'You are a high-ticket sales coach. For each objection category below, give the closer concise, actionable coaching structured as ISOLATE → REFRAME → OVERCOME:',
    '  - Isolate: confirm it is the real/only objection before addressing it.',
    '  - Reframe: shift the frame the objection lives in.',
    '  - Overcome: resolve it and advance to the close.',
    'Where HANDLED examples (the closer\'s own words) are provided, GROUND your advice in what THEY actually did — build on their real approach, do not invent. Where none are provided, give general best practice.',
    'Each of isolate/reframe/overcome must be 1-2 concrete sentences. No fluff, no cheerleading.',
    '',
    'Note: money-phrased objections ("too expensive", "can\'t afford it") are categorized as "fear" in this domain.',
    '',
    'CATEGORIES:',
  ];
  present.forEach(function(c) {
    var b = byCat[c];
    lines.push('### ' + c.toUpperCase() + ' — ' + b.count + ' objections, ' + b.handled + ' handled');
    if (b.examples.length) {
      lines.push('  Handled examples (the closer\'s own words):');
      b.examples.forEach(function(e) {
        lines.push('    - prospect said "' + (e.surface || e.quote || '').slice(0, 80) + '" → closer responded: "' + (e.closer_response || '').slice(0, 320) + '"');
      });
    } else {
      lines.push('  (no handled examples in this window — use general best practice, and it will be labeled as such)');
    }
  });
  lines.push('');
  lines.push('Respond with ONLY this JSON — no markdown, no code fences:');
  lines.push('{"categories":[{"category":"fear","isolate":"...","reframe":"...","overcome":"..."}]}');
  return lines.join('\n');
}

async function computeObjectionSynthesis(admin, userId, from, to) {
  // 1) calls in window (recording_url powers clip links).
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls')
      .select('id, recording_url, call_date, source')
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
    for (var i = 0; i < callIds.length; i += 100) {
      var qb = admin.from(table).select(cols).in('fathom_call_id', callIds.slice(i, i + 100));
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
  var done = await inChunks('call_analyses', 'fathom_call_id, analyzed_at, outcome', function(q) { return q.eq('status', 'done'); });
  var outcomeByCall = outcomeMap(done);
  var hashInput = done.map(function(d) { return d.fathom_call_id + ':' + d.analyzed_at; }).sort().join('|');
  var hash = crypto.createHash('md5').update(hashInput || 'empty').digest('hex');

  // 3) cache check.
  // Key snapped to UTC day boundaries — see lib/cache-window.js. The hash above
  // already carries freshness, so the millisecond precision only forced misses.
  var ck = snapCacheWindow(from, to);
  var cacheQ = await admin.from('objection_synthesis_cache')
    .select('synthesis').eq('user_id', userId).eq('synthesis_type', 'objections').eq('from_ts', ck.from).eq('to_ts', ck.to).eq('analysis_set_hash', hash)
    .maybeSingle();
  if (!cacheQ.error && cacheQ.data && cacheQ.data.synthesis) {
    return Object.assign({ available: true, cached: true }, cacheQ.data.synthesis);
  }

  // 4) categorized objection highlights → per-category counts + handled examples.
  var rows = await inChunks('call_highlights',
    'fathom_call_id, timestamp_seconds, quote, objection_surface, objection_category, resolution, closer_response, closer_response_verified',
    function(q) { return q.eq('type', 'objection'); });
  var byCat = {};
  OBJECTION_CATEGORIES.forEach(function(c) { byCat[c] = { count: 0, handled: 0, examples: [] }; });
  rows.forEach(function(r) {
    var b = byCat[r.objection_category];
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
      if (provenCloserResponse(r) && b.examples.length < 3) {
        b.examples.push({ quote: str(r.quote, 300), closer_response: str(provenCloserResponse(r), 400), surface: str(r.objection_surface, 80), clip_url: clipUrl(meta[r.fathom_call_id], r.timestamp_seconds),
          source: (meta[r.fathom_call_id] || {}).source || null });
      }
    }
  });
  var present = OBJECTION_CATEGORIES.filter(function(c) { return byCat[c].count > 0; })
    .sort(function(a, b) { return byCat[b].count - byCat[a].count; });
  if (present.length === 0) return { available: true, categories: [], generated_at: new Date().toISOString() };

  // 5) one Claude call. Credit/quota/5xx → unavailable (do NOT cache failures).
  var resp;
  try {
    resp = await createWithUsage({
      model: CLAUDE_MODEL, max_tokens: SYNTH_MAX_TOKENS,
      messages: [{ role: 'user', content: buildSynthPrompt(present, byCat) }],
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
  var categories = present.map(function(c) {
    var b = byCat[c], g = guide[c] || {};
    return {
      category: c, count: b.count, handled: b.handled, grounded: b.examples.length > 0,
      isolate: str(g.isolate, 500), reframe: str(g.reframe, 500), overcome: str(g.overcome, 500),
      evidence: b.examples.slice(0, 2),
    };
  });
  var synthesis = { categories: categories, generated_at: new Date().toISOString() };

  // 7) cache (best-effort — a cache write failure shouldn't fail the response).
  var up = await admin.from('objection_synthesis_cache').upsert(
    { user_id: userId, synthesis_type: 'objections', from_ts: ck.from, to_ts: ck.to, analysis_set_hash: hash, synthesis: synthesis, generated_at: synthesis.generated_at },
    { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[synthesis] cache write failed for user ' + userId + ': ' + up.error.message);

  return Object.assign({ available: true, cached: false }, synthesis);
}

module.exports = { computeObjectionSynthesis: computeObjectionSynthesis };
