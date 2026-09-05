// Performance Summary synthesis (Coaching Dashboard) — the learning loop's
// visible surface. One cached Claude call per (user, range) compares the
// closer's WIN-class (closed) vs LOSS-class (lost) calls and produces two
// evidence-linked blocks: WHAT'S WORKING and WHAT TO IMPROVE. Every insight is
// {claim, data, quote, clip_url, call_id} — the SAME shape the future
// learned_pattern extraction pipeline (designed, unbuilt) will feed into this
// display. Cached in objection_synthesis_cache with synthesis_type='performance'
// (same set-hash invalidation, same credit-tolerant unavailable state).

const Anthropic = require('@anthropic-ai/sdk');
const { CHUNK } = require('./chunk');   // ⚠ the one `.in()` chunk size (③-6) — never a literal here
const createWithUsage = require('./model-usage').usageFor('performance-synthesis');
const { isHandled } = require('./objection-handled');
const { snapCacheWindow } = require('./cache-window');
const crypto = require('crypto');
const { CLAUDE_MODEL } = require('../config');
/* Bumped ONLY for a correctness defect in what the cache already holds —
   never for a speculative improvement. See the key comment below. */
const SYNTH_RULE_VERSION = 'v9-2026-09-05-layered';   /* v9 (H733): notes under their entries; a disqualified prospect is never a lost deal. Was v8-2026-09-05-doctrine */ //   /* v8 (H732): Scout's doctrine in the prompt as a constraint. Was v7-2026-09-05-kb-material */ //   /* v7 (H731): the one knowledge-base retrieval before the prompt; nothing relevant → nothing said. Was v6-2026-09-05-subject-bar-page-facts */ //   /* v6 (H728): the subject check, the candidate bar and the page facts — the same three the recommendations lane carries. Was v5-2026-09-02-category-order-canonical */ //   /* v5: the "OBJECTIONS by category" line now iterates the ruled stored order (fear, timing, partner, logistical) — prompt text changed, so the cache key changes (fix #7, H680). v4 was the manager-notes lane. */   /* the prompt gained the MANAGER NOTES lane (Fine Tune Coaching) */
const { fetchSellingContext, SYNTHESIS_CATEGORIES } = require('./selling-context');
const { EVIDENCE_RULE, EVIDENCE_RULE_VERSION } = require('./evidence-rule');
const { evidenceSubjectMismatch, candidateEligible, subjectPromptRule } = require('./evidence-subject');   // H728 step 1
const doctrineLib = require('./doctrine');   // H733
const PF = require('./page-facts');   // H728 step 2
const { loadKbMaterial, nothingToSay } = require('./kb-material');   // H731
const { MIN_BUCKET } = require('./team-needs-work');

const { clipHref } = require('./clip-link');
const { displayCloserResponse } = require('./closer-side');
/* ⚠ ONE tone rule, four lanes — see lib/coaching-tone.js. Four copies drift, and a
   drifted tone rule is INVISIBLE: nothing fails, the wording just softens in one
   lane and not another. */
const TONE = require('./coaching-tone.js');
const SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];
const OBJ_CATEGORIES = require('./objection-categories').STORED_OBJECTION_CATEGORIES;   /* ⚠ ONE SOURCE (fix #7, H680): the ruled set in its stored order — never a literal copy here (sweep ③-3) */
const SYNTH_MAX_TOKENS = 2600;
const MAX_CANDIDATES = 16;   // evidence moments handed to the model
const MAX_ONE_THINGS = 15;   // one_thing notes summarized as a theme

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
// ⚠ delegates to lib/clip-link.js — the ONE place a deep link is built.
// Building it here would mean labelling it here, and this module does not
// know the provider. Pinned by test/clip-link-single-source.test.js.
function clipUrl(meta, ts) {
  if (!meta) return null;
  return clipHref(meta.recording_url, ts);
}
function outcomeClass(o) { return o === 'closed' ? 'win' : (o === 'lost' ? 'loss' : (o === 'disqualified' ? 'disqualified' : 'other')); }
function avg(sum, n) { return n > 0 ? Math.round(sum / n) : null; }

// Priority for which highlight moments become candidate evidence (win wins/
// strengths first, then loss-call gaps, then the rest) so the bounded set is
// the most useful for a win-vs-loss synthesis.
function candidateScore(type, cls) {
  if (cls === 'win' && (type === 'strong_moment' || type === 'buying_signal')) return 5;
  if (cls === 'loss' && (type === 'objection' || type === 'missed_opportunity' || type === 'disqualify_signal')) return 4;
  if (type === 'strong_moment' || type === 'buying_signal') return 3;
  if (type === 'objection' || type === 'missed_opportunity') return 2;
  return 1;
}

function buildPrompt(agg, oneThings, candidates, sellingContext, managerNotes) {
  var lines = [
    'You are a sales coach writing a Performance Summary for one high-ticket closer, comparing their WIN-class calls (outcome=closed) vs LOSS-class calls (outcome=lost) over this period. Be specific and grounded — cite real moments, tie claims to the numbers. No generic praise.',
    '',
    TONE.NEVER_DIMINISH,
    '',
    'SECTION AVERAGES (0-100): ' + SECTIONS.map(function (s) { return s + ' ' + (agg.sections[s] == null ? 'n/a' : agg.sections[s]); }).join(', ') + '. Strongest: ' + (agg.strongest || 'n/a') + '. Weakest: ' + (agg.weakest || 'n/a') + '.',
    'OVERALL: win-class avg ' + (agg.win_avg == null ? 'n/a' : agg.win_avg) + ' (' + agg.win_n + '), loss-class avg ' + (agg.loss_avg == null ? 'n/a' : agg.loss_avg) + ' (' + agg.loss_n + '), all done ' + (agg.blended == null ? 'n/a' : agg.blended) + ' (' + agg.done_n + ').',
    'OBJECTIONS by category (handled/total): ' + OBJ_CATEGORIES.map(function (c) { return c + ' ' + agg.obj[c].handled + '/' + agg.obj[c].total; }).join(', ') + '.',
    '',
    'GRADER "one thing to improve" notes across calls — synthesize the recurring THEME, do NOT quote these individually:',
  ];
  if (sellingContext && sellingContext.trim()) {
    lines.splice(2, 0,
      'SELLING CONTEXT (this closer\'s actual offer / sales approach — ground your assessment in it; judge against THIS offer and selling style, do not penalize approaches it endorses):',
      sellingContext.trim(), '');
  }
  /* FINE TUNE COACHING (2026-09-02): the closer's TEAM notes, through the one shared lane. */
  if (managerNotes && String(managerNotes).trim()) lines.splice(2, 0, require('./coaching-corrections').promptLane(managerNotes), '');
  oneThings.forEach(function (t) { lines.push('  - ' + t.slice(0, 220)); });
  lines.push('');
  // ⚠ The rule immediately above the list it governs — same placement as the
  //   team synthesis, so the two cannot drift on where it appears.
  lines.push(EVIDENCE_RULE);
  lines.push('');
  lines.push(PF.factsBlock(PF.pageFacts(agg.sections, agg.obj, { minBucket: MIN_BUCKET })));   // H728 step 2: the same facts as the page
  if (agg.doctrineBlock) { lines.push(''); lines.push(agg.doctrineBlock); }   // H732
  lines.push('');
  lines.push('EVIDENCE MOMENTS (cite exactly one by its id in evidence_id; do not invent quotes). Each carries its TYPE, category and SECTION:');
  candidates.forEach(function (c) {
    lines.push('  [' + c.id + '] (' + c.cls.toUpperCase() + ' call) ' + c.type + (c.objection_category ? '/' + c.objection_category : '') + (c.section ? ' in ' + c.section : '') + ': "' + (c.quote || '').slice(0, 160) + '"');
  });
  lines.push('');
  lines.push(subjectPromptRule());
  lines.push('');
  lines.push('Produce:');
  lines.push('- WHAT\'S WORKING: 2-3 strengths, each grounded in a specific WIN-call moment (evidence_id from a win call) and tied to a number (e.g. the strongest section).');
  lines.push('- WHAT TO IMPROVE: 2-3 gaps, each with a data point (weakest section avg / unhandled-objection stat), the synthesized THEME from the one_thing notes, and a representative LOSS-call moment where it cost leverage (evidence_id). Where a WIN call shows it done right, say so in the claim.');
  lines.push('State explicitly what DIFFERS between win and loss calls.');
  lines.push('');
  lines.push('Respond with ONLY this JSON — no markdown, no fences:');
  lines.push('{"working":[{"claim":"...","data":"...","evidence_id":"m1","subject":{"kind":"strong_moment","category":null,"section":null}}],"improve":[{"claim":"...","data":"...","evidence_id":"m2","subject":{"kind":"objection","category":"partner","section":null}}]}');
  return lines.join('\n');
}

/* H728 — module-level so a test can EXECUTE it: WHAT the quote is about (evidenceSubjectMismatch — the
   same function the recommendations lane uses) and whether the claim's DIRECTION agrees with the page
   facts (claimContradictsFacts). The claim keeps its numbers and loses an unearned quote; a claim that
   contradicts the page is dropped. */
function resolveInsights(arr, byId, opts) {
  var facts = opts && opts.facts; var direction = opts && opts.direction; var loss = opts && opts.lossScope;
  return (Array.isArray(arr) ? arr : []).slice(0, 3).map(function (it) {
    var ev = (it && it.evidence_id && byId[it.evidence_id]) || null;
    var subj = ev ? evidenceSubjectMismatch(it && it.subject, ev) : null;
    if (subj) { console.warn('[performance-synthesis] evidence dropped (subject): ' + subj); ev = null; }
    var contra = facts ? PF.claimContradictsFacts(it, direction, facts) : null;
    if (contra) { console.warn('[performance-synthesis] claim dropped (contradicts the page facts): ' + contra); return null; }
    if (loss && doctrineLib.enforceLossRule(String((it && it.claim) || '') + ' ' + String((it && it.data) || ''), loss, ev ? ev.call_id : null, 'performance-synthesis') === null) return null;   // H733
    return {
      claim: str(it && it.claim, 400),
      data: str(it && it.data, 200),
      quote: ev ? ev.quote : null,
      clip_url: ev ? ev.clip_url : null,
      source: ev ? ev.source : null,
      call_id: ev ? ev.call_id : null,
    };
  }).filter(function (it) { return it && it.claim; });
}

async function computePerformanceSynthesis(admin, userId, from, to) {
  // 1) calls in window.
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    var cq = await admin.from('fathom_calls').select('id, recording_url, call_date, title, source')
      /* ⚠⚠ NOT-A-SALES-CALL EXCLUSION — AND THIS IS ALSO THE CACHE FIX.
         The set_hash for this lane is computed over the ROWS THIS QUERY YIELDS
         (fathom_call_id + ':' + analyzed_at). Filtering here removes a marked
         call from that set, so the hash CHANGES and the cached synthesis
         invalidates automatically — in BOTH directions, because unmarking puts
         the row back and the hash returns to its previous value.
         ⚠ That is why the tag is NOT folded into the hash separately: a second
         mechanism would be redundant with this one and could drift out of step
         with it.
         ⚠ `.not(col,'is',true)`, NEVER `.eq(col,false)` — the column is nullable
         and `= false` is NULL for an unassessed row, which would silently drop
         almost the entire corpus. Pinned by test/not-a-sales-call.test.js. */
      .eq('user_id', userId).gte('call_date', from).lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
      .order('call_date', { ascending: false, nullsFirst: false }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var cb = cq.data || []; calls = calls.concat(cb);
    if (cb.length < PAGE) break; start += PAGE;
  }
  var meta = {}, callIds = [];
  calls.forEach(function (c) { meta[c.id] = c; callIds.push(c.id); });
  if (callIds.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

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

  // 2) done analyses. ⚠ TWO PHASES ON PURPOSE: the cache KEY needs only
  // fathom_call_id + analyzed_at, but the synthesis needs eleven columns. Loading
  // all eleven before the cache check meant a HIT paid for data it then threw
  // away — measured at ~776 ms of a ~1.2 s cached response. The heavy select now
  // happens only on a miss.
  var keyRows = await inChunks('call_analyses', 'fathom_call_id, analyzed_at',
    function (q) { return q.eq('status', 'done'); });
  if (keyRows.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

  // KB-grounded: fetch the closer's selling context (offer/scripts, cap 3000) and
  // fold its hash into the set-hash so a KB upload invalidates the cached synthesis.
  /* H731: THE KNOWLEDGE BASE, BEFORE THE ADVICE — one retrieval, scoped by the relationship rules. */
  var material = await loadKbMaterial(admin, { userId: userId, lane: 'performance-synthesis', maxChars: 3000 });
  var selling = { contextText: material.contextText, kbHash: material.kbHash };
  var corr = material.notes;   // the notes ride the one retrieval (H731)
  var hashInput = keyRows.map(function (a) { return a.fathom_call_id + ':' + a.analyzed_at; }).sort().join('|') + '||kb:' + selling.kbHash + '||notes:' + corr.hash
    /* ⚠⚠ A VERSION IS IN THIS KEY AGAIN, AND THE DISTINCTION IS THE POINT.

       It was deliberately LEFT OUT for the v1 evidence RULE, because that rule
       was MEASURED not to work (67% mismatched before, 75% after) and bumping a
       key to make an ineffective change take effect is paying to look busy. That
       reasoning still stands for a speculative rule, and the note said so:
       "put the version back the day a fix demonstrably moves the number."

       ⚠⚠ THIS IS NOT THAT CASE. It is a CORRECTNESS defect, not a hoped-for
       improvement: cached syntheses render the literal string
       `__moment_is_closer__` as the evidence quote, because a sentinel is a
       non-empty string and won the `closer_response || quote` fallback. A user
       reads an internal token as the proof of their weakness. Without the
       version those cached entries keep showing it forever and the gate below
       reaches nothing — the same shape the digest cache had.
       ⚠ THE TEST TO APPLY NEXT TIME: does the cached output contain something
       WRONG, or merely something that could be better? Only the first earns a
       bump. */
    + '||v:' + SYNTH_RULE_VERSION;
  var hash = crypto.createHash('md5').update(hashInput).digest('hex');

  // 3) cache check.
  // Key snapped to UTC day boundaries — see lib/cache-window.js.
  var ck = snapCacheWindow(from, to);
  var cacheQ = await admin.from('objection_synthesis_cache').select('synthesis')
    .eq('user_id', userId).eq('synthesis_type', 'performance').eq('from_ts', ck.from).eq('to_ts', ck.to).eq('analysis_set_hash', hash).maybeSingle();
  if (!cacheQ.error && cacheQ.data && cacheQ.data.synthesis) return Object.assign({ available: true, cached: true }, cacheQ.data.synthesis);
  if (!material.hasMaterial) return nothingToSay({ working: [], improve: [], generated_at: new Date().toISOString() });   // H731

  // MISS from here on — now pay for the columns the synthesis actually needs.
  var analyses = await inChunks('call_analyses',
    'fathom_call_id, analyzed_at, status, outcome, overall_score, intro_score, discovery_score, pitch_score, objection_score, close_score, one_thing',
    function (q) { return q.eq('status', 'done'); });
  if (analyses.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

  var outcomeByCall = {};
  var secSum = {}, secN = {}; SECTIONS.forEach(function (s) { secSum[s] = 0; secN[s] = 0; });
  var winSum = 0, winN = 0, lossSum = 0, lossN = 0, blSum = 0, blN = 0;
  var oneThings = [];
  analyses.forEach(function (a) {
    outcomeByCall[a.fathom_call_id] = a.outcome;
    SECTIONS.forEach(function (s) { var v = a[s + '_score']; if (typeof v === 'number') { secSum[s] += v; secN[s]++; } });
    if (typeof a.overall_score === 'number') {
      blSum += a.overall_score; blN++;
      if (a.outcome === 'closed') { winSum += a.overall_score; winN++; }
      else if (a.outcome === 'lost') { lossSum += a.overall_score; lossN++; }
    }
    if (typeof a.one_thing === 'string' && a.one_thing.trim() && oneThings.length < MAX_ONE_THINGS) oneThings.push(a.one_thing.trim());
  });
  var sections = {}; SECTIONS.forEach(function (s) { sections[s] = avg(secSum[s], secN[s]); });
  var strongest = null, weakest = null;
  SECTIONS.forEach(function (s) {
    if (sections[s] == null) return;
    if (strongest === null || sections[s] > sections[strongest]) strongest = s;
    if (weakest === null || sections[s] < sections[weakest]) weakest = s;
  });

  // 4) objection stats.
  var objRows = await inChunks('call_highlights', 'objection_category, resolution', function (q) { return q.eq('type', 'objection'); });
  var obj = {}; OBJ_CATEGORIES.forEach(function (c) { obj[c] = { total: 0, handled: 0 }; });
  // Ruling 2026-08-17 — the SAME definition the UI shows. If this lane counted
  // differently, the synthesis prose would contradict the number beside it.
  objRows.forEach(function (r) { var b = obj[r.objection_category]; if (b) { b.total++; if (isHandled(r, outcomeByCall[r.fathom_call_id])) b.handled++; } });

  // 5) candidate evidence moments (with real clip links + outcome class).
  var hlRows = await inChunks('call_highlights', 'id, fathom_call_id, timestamp_seconds, quote, closer_response, type, objection_category, objection_class, section, speaker, speaker_verified, resolution, handling, cause');   // H733: objection_class
  var lossScope = doctrineLib.lossScope(analyses, hlRows);   // H733
  var candidates = hlRows.filter(candidateEligible).map(function (r) {
    var cls = outcomeClass(doctrineLib.outcomeForAdvice(outcomeByCall[r.fathom_call_id], !!lossScope.dqCalls[r.fathom_call_id]));   // H733: DISQUALIFIED, never LOSS
    return {
      cls: cls, type: r.type, objection_category: r.objection_category || null, section: r.section || null,
      /* ⚠ SENTINEL-GATED: a sentinel is a non-empty string and would WIN this
         fallback, rendering `__moment_is_closer__` as the evidence quote. */
      quote: str(displayCloserResponse(r.closer_response), 220) || str(r.quote, 220) || '',
      clip_url: clipUrl(meta[r.fathom_call_id], r.timestamp_seconds),
      source: (meta[r.fathom_call_id] || {}).source || null,
      call_id: r.fathom_call_id,
      _score: candidateScore(r.type, cls),
    };
  }).filter(function (c) { return c.quote; })
    .sort(function (a, b) { return b._score - a._score; })
    .slice(0, MAX_CANDIDATES);
  candidates.forEach(function (c, i) { c.id = 'm' + (i + 1); });
  var byId = {}; candidates.forEach(function (c) { byId[c.id] = c; });

  var agg = {
    sections: sections, strongest: strongest, weakest: weakest,
    win_avg: avg(winSum, winN), win_n: winN, loss_avg: avg(lossSum, lossN), loss_n: lossN,
    blended: avg(blSum, blN), done_n: blN, obj: obj,
    doctrineBlock: material.doctrineBlock ? material.doctrineBlock('performance-synthesis') : '',   // H732
  };

  // 6) Claude call — credit-tolerant.
  var resp;
  try {
    resp = await createWithUsage({
      model: CLAUDE_MODEL, max_tokens: SYNTH_MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(agg, oneThings, candidates, selling.contextText, corr.text) }],
    });
  } catch (apiErr) {
    return { available: false, reason: 'Anthropic API failure' + ((apiErr && apiErr.status) ? ' (HTTP ' + apiErr.status + ')' : '') + ': ' + ((apiErr && apiErr.message) || 'unknown') };
  }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed || !Array.isArray(parsed.working) || !Array.isArray(parsed.improve)) return { available: false, reason: 'synthesis returned unparseable output' };

  // 7) resolve evidence_id → real {quote, clip_url, call_id} (never LLM-invented) — the subject check and the page facts inside.
  var facts = PF.pageFacts(agg.sections, agg.obj, { minBucket: MIN_BUCKET });
  var synthesis = { working: resolveInsights(parsed.working, byId, { facts: facts, direction: 'working', lossScope: lossScope }), improve: resolveInsights(parsed.improve, byId, { facts: facts, direction: 'improve', lossScope: lossScope }), generated_at: new Date().toISOString() };

  // 8) cache (best-effort).
  var up = await admin.from('objection_synthesis_cache').upsert(
    { user_id: userId, synthesis_type: 'performance', from_ts: ck.from, to_ts: ck.to, analysis_set_hash: hash, synthesis: synthesis, generated_at: synthesis.generated_at },
    { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[perf-synthesis] cache write failed for user ' + userId + ': ' + up.error.message);

  return Object.assign({ available: true, cached: false }, synthesis);
}

module.exports = { computePerformanceSynthesis: computePerformanceSynthesis, _buildPrompt: buildPrompt, _resolveInsights: resolveInsights, _evidenceSubjectMismatch: evidenceSubjectMismatch, _candidateEligible: candidateEligible };
