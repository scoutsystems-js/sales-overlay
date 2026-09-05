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
const { CHUNK } = require('./chunk');   // ⚠ the one `.in()` chunk size (③-6) — never a literal here
const createWithUsage = require('./model-usage').usageFor('team-synthesis');
const { displayNameFromEmail } = require('./display-name');
const { isHandled } = require('./objection-handled');
const { snapCacheWindow } = require('./cache-window');
// ⚠ ONE definition of 'synthetic', shared with the objection drilldown.
const { realCallsOnly } = require('./real-calls');
const crypto = require('crypto');
const { CLAUDE_MODEL } = require('../config');
const { fetchSellingContext, SYNTHESIS_CATEGORIES } = require('./selling-context');
const { EVIDENCE_RULE, EVIDENCE_RULE_VERSION } = require('./evidence-rule');

const { clipHref } = require('./clip-link');
const { provenCloserResponse } = require('./closer-side');
/* ⚠ ONE tone rule, four lanes — see lib/coaching-tone.js. Four copies drift, and a
   drifted tone rule is INVISIBLE: nothing fails, the wording just softens in one
   lane and not another. */
const TONE = require('./coaching-tone.js');
const SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];
const OBJ_CATEGORIES = require('./objection-categories').STORED_OBJECTION_CATEGORIES;   /* ⚠ ONE SOURCE (fix #7, H680): the ruled set in its stored order — never a literal copy here (sweep ③-3) */
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

/* ⚠⚠ THE CAP MUST BOUND A RUNAWAY, NOT NORMAL OUTPUT (2026-09-01).
   Measured on a live board: FIVE OF SIX `data` fields landed EXACTLY on the old
   200-char cap and one `claim` exactly on 400 — so every one of them was cut by
   US, mid-phrase, while the model was fine throughout. Same defect as the digest
   coaching.
   ⚠ THE DIGEST FIX DERIVED ITS CAP FROM THE PROMPT'S OWN LENGTH RULE. This
   prompt had NO length rule, so there was nothing to derive from — the rule is
   added there (see buildPrompt) and these caps sit ABOVE it, which is the whole
   point: a cap you can reach in normal use is a truncator, not a guard.
   ⚠ AND IT CUTS AT A SENTENCE BOUNDARY, so if it ever does fire the text still
   ends as a complete thought rather than on a conjunction. */
/* ⚠ Bump this whenever the recommendations PROMPT or the shape of a stored
   insight changes — the generated text lives inside the cached payload, so a
   key that does not move means the change is invisible indefinitely. */
const RECS_LANE_VERSION = 'v13-2026-09-05-doctrine';   /* v13 (H732): Scout's doctrine in the prompt as a constraint. Was v12-2026-09-05-kb-material */ //   /* v12 (H731): the ONE knowledge-base retrieval before the prompt; nothing relevant → the lane says nothing. Was v11-2026-09-05-page-facts */ //   /* v11 (H728): the page facts block in the prompt; a claim whose direction contradicts them is dropped. Was v10-2026-09-04-candidates-pass-the-bar */ //   /* v10 (H725): a moment becomes EVIDENCE only if it passes the selectivity bar — a payment confirmation with no earned move is not a candidate. Was v9: */ // 'v9-2026-09-04-evidence-subject'   /* v9 (H724): every insight declares its SUBJECT and a cited moment whose stored type/category/section disagrees loses its quote — the claim stands; a count claim carries no quote. Was v8: */ // const RECS_LANE_VERSION = 'v8-2026-09-02-category-order-canonical';   /* v8: the "OBJECTIONS by category" line now iterates the ruled stored order — prompt text changed, cache key changes (fix #7, H680). v7 was the manager-notes lane. */   /* the prompt gained the MANAGER NOTES lane — a prompt edit and its bump are one atomic change */   /* v5 rows were written without the id (column not selected) — bumped again so they regenerate */   /* ⚠ PAYLOAD SHAPE: each insight now carries the highlight id it cites (Fine Tune Coaching surface ② needs a moment to record what it was given on). A shape change earns a bump exactly as a prompt change does. */
/* ⚠⚠ WHO SPOKE THE QUOTE — READ, NEVER INFERRED (2026-09-01).
   THE BUG THIS REPLACES: `spoke` was derived from WHICH FIELD the caller fell
   back to — `closer_response ? 'closer' : 'prospect'`. `closer_response` IS
   definitionally the closer, but `quote` is EITHER, so the fallback carries no
   information at all about who spoke. Measured: 1,548 of 8,998 moments are
   CLOSER-spoken (17%), so roughly one in six quote-fallback insights could
   carry the wrong label — and one did, rendering "The prospect, on Josh P's
   call" over "I'll give you $1,000 off for doing that, for doing cash."
   ⚠ SCOUT HAD RECORDED THE ANSWER: that row reads speaker='CLOSER',
   speaker_verified=true. The database knew; the derivation ignored it.
   ⚠⚠ AN UNVERIFIED SPEAKER RETURNS null, WHICH RENDERS UNLABELLED. That is the
   fallback's entire purpose — it previously defaulted to 'prospect', i.e. to a
   CLAIM, which is the opposite of a fallback. `speaker_verified` is three-valued
   (null = never assessed, false = assessed and not provable), and only `true`
   may attribute. */
function spokeOf(row, provenReply, quoteText) {
  if (provenReply) return 'closer';          // definitionally the closer
  if (!quoteText) return null;               // nothing to attribute
  if (!row || row.speaker_verified !== true) return null;   // unverified -> UNLABELLED
  if (row.speaker === 'CLOSER') return 'closer';
  if (row.speaker === 'PROSPECT') return 'prospect';
  return null;
}

/* ⚠⚠ THE EVIDENCE MUST BELONG TO A REP THE CLAIM IS ABOUT (2026-09-01).
   The model makes TWO independent choices — the prose, and an evidence_id — and
   only the prose was ever validated (a model-invented NAME is dropped). The id
   was looked up blindly. Measured on the live board: 2 of 6 insights cited a rep
   the prose never named, and all three mismatches were in `improve` — the
   what-to-improve prose names whoever did badly and the id is unconstrained.
   Live example: a claim naming Godwin and Nick, evidenced by a GABRIEL quote
   about money under a claim about next steps.
   ⚠⚠ MISMATCHED EVIDENCE IS DROPPED, NOT RE-SELECTED, and that is the ruling.
   Re-selecting would pick some other moment belonging to a named rep — but
   nothing would make that moment SUPPORT the claim, so it manufactures a
   binding rather than verifying one. A quote that contradicts the claim above it
   is worse than no quote; an INVENTED binding is worse than both.
   ⚠ THE CONSTRAINT ONLY APPLIES WHEN THE PROSE NAMES SOMEONE. A team-level
   claim that names nobody is legitimately evidenced by any rep's moment. */
function firstToken(name) {
  return String(name || '').trim().split(/\s+/)[0].toLowerCase();
}
function proseNamesRep(text, rep) {
  var t = firstToken(rep);
  if (!t || t.length < 3) return false;   // never match on an initial
  return new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(String(text || ''));
}
/** null when the evidence may stand; a reason string when it must be dropped. */
function evidenceMismatch(claimText, evRep, allReps) {
  if (!evRep) return null;
  var named = (allReps || []).filter(function (r) { return proseNamesRep(claimText, r); });
  if (!named.length) return null;                       // names nobody -> unconstrained
  var ok = named.some(function (n) { return firstToken(n) === firstToken(evRep); });
  return ok ? null : 'evidence rep "' + evRep + '" is not named in the claim';
}

const { evidenceSubjectMismatch, candidateEligible } = require('./evidence-subject');   // H724/H725/H728: ONE module for every citing lane
const PF = require('./page-facts');
const { MIN_BUCKET } = require('./team-needs-work');   // the ONE comparison floor   // H728 step 2: the same facts to every lane on the page
const CLAIM_CAP = 520;   // the prompt asks for <= 45 words (~290 chars)
const DATA_CAP  = 520;
function capAtSentence(x, cap) {
  const v = (typeof x === 'string' && x.trim()) ? x.trim() : null;
  if (!v || v.length <= cap) return v;
  const cut = v.slice(0, cap);
  const m = cut.match(/^[\s\S]*[.!?](?=\s|$)/);        // greedy -> the LAST sentence end
  if (m && m[0].length >= Math.floor(cap * 0.5)) return m[0].trim();
  const sp = cut.lastIndexOf(' ');                       // no usable sentence end: word boundary
  return (sp > 0 ? cut.slice(0, sp) : cut).trim() + '\u2026';
}
// ⚠ delegates to lib/clip-link.js — the ONE place a deep link is built.
// Building it here would mean labelling it here, and this module does not
// know the provider. Pinned by test/clip-link-single-source.test.js.
function clipUrl(rec, ts) { return clipHref(rec, ts); }
function avg(sum, n) { return n > 0 ? Math.round(sum / n) : null; }
function apiFail(e) { return { available: false, reason: 'Anthropic API failure' + ((e && e.status) ? ' (HTTP ' + e.status + ')' : '') + ': ' + ((e && e.message) || 'unknown') }; }

// Load the team's calls in a window + their done analyses + objection/highlight
// rows, once. Returns everything both synthesizers need.
async function loadTeamWindow(admin, repIds, from, to) {
  var calls = [], PAGE = 1000, start = 0;
  while (true) {
    /* ⚠⚠ THE NOT-A-SALES-CALL EXCLUSION, AND THIS IS THE CHOKEPOINT. Do not add
       a second filter downstream of this — it would be redundant and drift.

       ⚠ IT IS SIX CONSUMERS, NOT THREE. This comment said "three lanes" until
       2026-08-24; enumerated by capability, every caller of loadTeamWindow is:
         computeTeamNeedsWork      — the team "Objection Handling Focus" card
         computeTeamRecommendations— team recommendations
         computeDailyDigest        — the manager's daily digest
         computeWeeklyHighlights   — Call Highlights of the Week
         loadBucketEvidence        — the per-call evidence behind a bucket
         computePersonalNeedsWork  — ⚠ a CLOSER'S OWN coaching page, not a team
                                      surface at all
       The last two were missed by the old count. That is the argument for
       filtering HERE rather than per panel: a per-panel filter would have been
       applied to the three someone remembered.

       ⚠⚠ `.not(col,'is',true)`, NEVER `.eq(col,false)`. The column is nullable
       with three states (NULL never assessed / false confirmed / true excluded).
       `= false` is NULL for an unassessed row and NULL is not true, so it would
       SILENTLY EXCLUDE almost the entire corpus. Two silent-null bugs of this
       exact shape have already shipped here. test/not-a-sales-call.test.js scans
       every consumer and fails on the wrong form. */
    /* ⚠ `fathom_call_id` IS SELECTED FOR THE SYNTHETIC FILTER BELOW — it was not
       in this select before, which is why the filter could not be applied here
       until now. Same failure family as the Part-1b missing-`section` bug: the
       predicate was fine, the column never arrived. */
    var cq = await admin.from('fathom_calls').select('id, user_id, fathom_call_id, recording_url, call_date, title, source, call_kind')
      .in('user_id', repIds).gte('call_date', from).lte('call_date', to)
      .not('not_a_sales_call', 'is', true)
      .is('duplicate_of', null)
      .order('call_date', { ascending: false }).range(start, start + PAGE - 1);
    if (cq.error) throw new Error('fathom_calls: ' + cq.error.message);
    var b = cq.data || []; calls = calls.concat(b);
    if (b.length < PAGE) break; start += PAGE;
  }

  /* ⚠⚠ THE SYNTHETIC EXCLUSION, AT THE CHOKEPOINT (2026-08-24). Measured before
     this landed: ~38% of what this loader returned for Josh's board was
     fabricated — 102 seeded rows and 33 demo rows against 177 real objection
     moments. The objection drilldown filtered them and read 20%; the team card
     drew from here and read something else. The same metric, two numbers, one
     product, nothing on screen saying which was right.

     ⚠ ONE RULE, IMPORTED — `lib/real-calls.js`, the SAME predicate the drilldown
     uses. A second definition of "fake" is exactly the divergence this fixes.

     ⚠⚠ AND IT IS THE ID PREFIX, WHICH IS A CONVENTION AND NOT A PROPERTY — said
     plainly because the alternative looks better and is WRONG. Owner identity
     seems more robust ("exclude the demo accounts"), but measured on live data
     `reviewer@scoutsystems.io` owns 18 SYNTHETIC rows AND 6 REAL ones, so a
     user-level rule would delete real calls from every team metric. Nothing
     else discriminates either: `recording_url IS NULL` and the seed
     prompt_version separate the seeded rows but not the demo copies (which
     carry real recording URLs and real grader versions, being copies of real
     analyses), and the created_at clusters sit INSIDE the range of real calls.
     The prefix is the only signal covering both kinds. The durable fix — an
     `is_synthetic` column written at insert time — is filed, not built. */
  calls = realCallsOnly(calls);
  var meta = {}, callIds = [];
  calls.forEach(function (c) { meta[c.id] = c; callIds.push(c.id); });
  async function inChunks(table, cols, refine) {
    var out = [];
    for (var i = 0; i < callIds.length; i += CHUNK) {
      var qb = admin.from(table).select(cols).in('fathom_call_id', callIds.slice(i, i + CHUNK));
      if (refine) qb = refine(qb);
      var r = await qb; if (r.error) throw new Error(table + ': ' + r.error.message);
      out = out.concat(r.data || []);
    }
    return out;
  }
  return { meta: meta, callIds: callIds, inChunks: inChunks };
}

// ⚠ from/to are snapped to UTC day boundaries HERE, in the one place both the
// read and the write pass through, so a get and a put can never disagree about
// the key. See lib/cache-window.js for the measurement that motivated it and
// why analysis_set_hash makes the collapse safe. Callers keep passing exact
// timestamps — only the KEY is coarsened, never the data window.
async function cacheGet(admin, keyId, type, from, to, hash) {
  var k = snapCacheWindow(from, to);
  var q = await admin.from('objection_synthesis_cache').select('synthesis')
    .eq('user_id', keyId).eq('synthesis_type', type).eq('from_ts', k.from).eq('to_ts', k.to).eq('analysis_set_hash', hash).maybeSingle();
  return (!q.error && q.data && q.data.synthesis) ? q.data.synthesis : null;
}
async function cachePut(admin, keyId, type, from, to, hash, synthesis) {
  var k = snapCacheWindow(from, to);
  var up = await admin.from('objection_synthesis_cache').upsert(
    { user_id: keyId, synthesis_type: type, from_ts: k.from, to_ts: k.to, analysis_set_hash: hash, synthesis: synthesis, generated_at: synthesis.generated_at },
    { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[team-synthesis] cache write failed (' + type + ', key ' + keyId + '): ' + up.error.message);
}

// ── Team recommendations ─────────────────────────────────────────────────────
/* H724: the resolve step, module-level so a test can EXECUTE it with a planted payload. */
function resolveInsights(arr, byId, allRepNames, opts) {
  var facts = opts && opts.facts; var direction = opts && opts.direction;
    return arr.slice(0, 3).map(function (it) {
      var ev = (it && it.evidence_id && byId[it.evidence_id]) || null;
      /* ⚠ BIND THE EVIDENCE TO THE CLAIM, or drop it. See evidenceMismatch. */
      var mism = ev ? evidenceMismatch(String((it && it.claim) || '') + ' ' + String((it && it.data) || ''), ev.rep, allRepNames) : null;
      if (mism) { console.warn('[team-synthesis] evidence dropped: ' + mism); ev = null; }
      /* H724: WHOSE quote passed; now WHAT it is about. The claim stands either way. */
      var subj = ev ? evidenceSubjectMismatch(it && it.subject, ev) : null;
      if (subj) { console.warn('[team-synthesis] evidence dropped (subject): ' + subj); ev = null; }
      /* H728 step 2: a claim whose DIRECTION contradicts the page facts is dropped — two lanes on one
         page may generalise, never assert opposites. */
      var contra = facts ? PF.claimContradictsFacts(it, direction, facts) : null;
      if (contra) { console.warn('[team-synthesis] claim dropped (contradicts the page facts): ' + contra); return null; }
      return { claim: capAtSentence(it && it.claim, CLAIM_CAP), data: capAtSentence(it && it.data, DATA_CAP), rep: ev ? ev.rep : null, quote: ev ? ev.quote : null, spoke: ev ? (ev.spoke || null) : null, clip_url: ev ? ev.clip_url : null, source: ev ? ev.source : null, call_id: ev ? ev.call_id : null, highlight_id: ev ? ev.highlight_id : null };
    }).filter(function (it) { return it && it.claim; });
  }

async function computeTeamRecommendations(admin, keyId, repIds, from, to, emailMap, nameMap) {
  if (!repIds || repIds.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };
  var w = await loadTeamWindow(admin, repIds, from, to);
  if (w.callIds.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

  var analyses = await w.inChunks('call_analyses',
    'fathom_call_id, analyzed_at, outcome, overall_score, intro_score, discovery_score, pitch_score, objection_score, close_score, one_thing',
    function (q) { return q.eq('status', 'done'); });
  if (analyses.length === 0) return { available: true, working: [], improve: [], generated_at: new Date().toISOString() };

  // KB-grounded: the manager/owner's team selling context (cap 3000), folded into
  // the set-hash so a KB upload invalidates the cached team recommendations.
  /* H731: THE KNOWLEDGE BASE, BEFORE THE ADVICE. One retrieval (lib/kb-material): the team's offer, qualifications,
     script, uploads and coaching notes, scoped by the relationship rules. Nothing relevant → nothing said. */
  var material = await loadKbMaterial(admin, { userId: keyId, teamKey: keyId, lane: 'team-synthesis', maxChars: 3000 });
  var selling = { contextText: material.contextText, kbHash: material.kbHash, qualifications: material.qualifications };
  /* FINE TUNE COACHING (2026-09-02): this team's corrections join the KEY (a new
     note invalidates the next load) and the PROMPT, through the one shared lane. */
  var corr = material.notes;
  var hash = crypto.createHash('md5').update(analyses.map(function (a) { return a.fathom_call_id + ':' + a.analyzed_at; }).sort().join('|') + '||kb:' + selling.kbHash + '||notes:' + corr.hash
    /* ⚠⚠ THE RULE VERSION IS DELIBERATELY *NOT* IN THIS KEY — see CLAUDE.md.
       Adding it forces every cached synthesis to regenerate at real cost, and
       the rule was MEASURED not to work: 67% mismatched before, 75% after. A
       version bump is how you make a change take effect; spending on one for a
       change that does not help would be paying to look busy.
       ⚠ New syntheses pick the rule up naturally. Put the version back the day a
       fix demonstrably moves the number. */
    /* ⚠⚠ RECS_LANE_VERSION *IS* IN THE KEY, AND THE CONTRAST WITH THE RULE
       ABOVE IS THE WHOLE REASONING — the two are not inconsistent.
       The evidence rule was measured NOT to change the output, so paying to
       regenerate would have bought nothing. Option A changes THREE things that
       live INSIDE the cached payload:
         · the prompt gained a LENGTH RULE, so the text itself differs
         · the caps moved, so the stored text is no longer cut mid-phrase
         · the payload gained `spoke`, and WITHOUT IT EVERY INSIGHT FALLS BACK
           TO THE UNATTRIBUTED FORM FOREVER
       ⚠ So with no bump this change ships NOTHING on any cached window — the
       exact failure already recorded for NEEDS_WORK_LANE_VERSION. A prompt edit
       and its lane version bump are ONE atomic change. */
    + '||recs:' + RECS_LANE_VERSION).digest('hex');
  var cached = await cacheGet(admin, keyId, 'team', from, to, hash);
  if (cached) return Object.assign({ available: true, cached: true }, cached);
  if (!material.hasMaterial) return nothingToSay({ working: [], improve: [], generated_at: new Date().toISOString() });   // H731: silence beats a guess

  var repOf = function (cid) { return w.meta[cid] ? w.meta[cid].user_id : null; };
  var secSum = {}, secN = {}; SECTIONS.forEach(function (s) { secSum[s] = 0; secN[s] = 0; });
  var winSum = 0, winN = 0, lossSum = 0, lossN = 0, outcomeByCall = {};
  var oneThings = [];
  analyses.forEach(function (a) {
    outcomeByCall[a.fathom_call_id] = a.outcome;
    SECTIONS.forEach(function (s) { var v = a[s + '_score']; if (typeof v === 'number') { secSum[s] += v; secN[s]++; } });
    if (typeof a.overall_score === 'number') { if (a.outcome === 'closed') { winSum += a.overall_score; winN++; } else if (a.outcome === 'lost') { lossSum += a.overall_score; lossN++; } }
    if (typeof a.one_thing === 'string' && a.one_thing.trim() && oneThings.length < MAX_ONE_THINGS) {
      var rid0 = repOf(a.fathom_call_id); var nm0 = nameMap && nameMap[rid0]; var em = emailMap && emailMap[rid0]; oneThings.push((nm0 ? nm0 + ': ' : em ? displayNameFromEmail(em) + ': ' : '') + a.one_thing.trim());
    }
  });
  var sections = {}, strongest = null, weakest = null;
  SECTIONS.forEach(function (s) { sections[s] = avg(secSum[s], secN[s]); });
  SECTIONS.forEach(function (s) { if (sections[s] == null) return; if (strongest === null || sections[s] > sections[strongest]) strongest = s; if (weakest === null || sections[s] < sections[weakest]) weakest = s; });

  var objRows = await w.inChunks('call_highlights', 'objection_category, resolution', function (q) { return q.eq('type', 'objection'); });
  var obj = {}; OBJ_CATEGORIES.forEach(function (c) { obj[c] = { total: 0, handled: 0 }; });
  // Ruling 2026-08-17 — the SAME definition the UI shows, so the prose cannot
  // contradict the rate rendered next to it.
  objRows.forEach(function (r) { var bk = obj[r.objection_category]; if (bk) { bk.total++; if (isHandled(r, outcomeByCall[r.fathom_call_id])) bk.handled++; } });

  /* ⚠ `id` IS SELECTED because the candidate carries it as highlight_id — a field
     read at the consumer and selected nowhere is undefined everywhere with no
     error, which is exactly what shipped for twenty minutes on 2026-09-02. */
  var hlRows = await w.inChunks('call_highlights', 'id, fathom_call_id, timestamp_seconds, quote, speaker, speaker_verified, closer_response, closer_response_verified, type, objection_category, section, resolution, handling, cause');   // H725: the bar reads resolution, handling and the cause   // H724: category and section are what the subject check reads
  function cls(o) { return o === 'closed' ? 'win' : (o === 'lost' ? 'loss' : 'other'); }
  var candidates = hlRows.filter(candidateEligible).map(function (r) {
    var c = cls(outcomeByCall[r.fathom_call_id]); var rid = repOf(r.fathom_call_id);
    var reply = capAtSentence(provenCloserResponse(r), 200);   // null unless PROVEN to be the closer
    return { cls: c, type: r.type, objection_category: r.objection_category || null, section: r.section || null, rep: (nameMap && nameMap[rid]) || (emailMap && emailMap[rid]) || rid,
      /* ⚠⚠ WHO SPOKE IS RECORDED HERE, BECAUSE THIS `||` IS WHERE IT IS DECIDED
         and nothing downstream can recover it. Without it `rep` means "whose
         CALL", not "who SPOKE" — and labelling a prospect's line with the rep's
         name is the misattribution this project has spent whole blocks on.
         ⚠ THE VERIFIED GATE, NOT THE SENTINEL ONE. This lane was the SIXTH with
         that defect and the only one that BOTH feeds a model prompt AND renders
         to a manager. An unproven reply is now neither quoted nor attributed. */
      quote: reply || str(r.quote, 200) || '',
      spoke: spokeOf(r, reply, str(r.quote, 200)),
      clip_url: clipUrl(w.meta[r.fathom_call_id] && w.meta[r.fathom_call_id].recording_url, r.timestamp_seconds),
      source: (w.meta[r.fathom_call_id] && w.meta[r.fathom_call_id].source) || null,
      call_id: r.fathom_call_id,
      highlight_id: r.id,   // the moment itself — Fine Tune Coaching on the insight records what it was given on
      _s: (c === 'win' && (r.type === 'strong_moment' || r.type === 'buying_signal')) ? 5 : (c === 'loss' && (r.type === 'objection' || r.type === 'missed_opportunity')) ? 4 : (r.type === 'strong_moment') ? 3 : 1 };
  }).filter(function (c) { return c.quote; }).sort(function (a, b) { return b._s - a._s; }).slice(0, MAX_CANDIDATES);
  candidates.forEach(function (c, i) { c.id = 'm' + (i + 1); });
  var byId = {}; candidates.forEach(function (c) { byId[c.id] = c; });

  var promptLines = [
    'You are a sales manager coach. Synthesize a TEAM performance review across ' + repIds.length + ' reps for this period. Be specific, grounded, and cite reps by name where relevant. No generic praise.',
    '',
    TONE.NEVER_DIMINISH,
    'TEAM SECTION AVERAGES (0-100): ' + SECTIONS.map(function (s) { return s + ' ' + (sections[s] == null ? 'n/a' : sections[s]); }).join(', ') + '. Strongest: ' + (strongest || 'n/a') + '. Weakest: ' + (weakest || 'n/a') + '.',
    'WIN-class avg ' + (avg(winSum, winN) || 'n/a') + ' (' + winN + '), LOSS-class avg ' + (avg(lossSum, lossN) || 'n/a') + ' (' + lossN + ').',
    'OBJECTIONS by category (handled/total): ' + OBJ_CATEGORIES.map(function (c) { return c + ' ' + obj[c].handled + '/' + obj[c].total; }).join(', ') + '.',
    '',
    'GRADER one-thing notes across reps (synthesize the recurring TEAM theme; names prefixed):',
  ].concat(oneThings.map(function (t) { return '  - ' + t.slice(0, 200); })).concat([
    '',
    /* ⚠ THE RULE SITS DIRECTLY ABOVE THE LIST it governs. The type was already
       on every candidate line and the model cited positives for gaps anyway —
       what was missing is what the types MEAN for a claim. */
    EVIDENCE_RULE,
    '',
    PF.factsBlock(PF.pageFacts(sections, obj, { minBucket: MIN_BUCKET })),
    '',
    material.doctrineBlock ? material.doctrineBlock('team-synthesis') : '',   // H732
    '',
    'EVIDENCE MOMENTS (cite one by id in evidence_id; do not invent quotes). Each is tagged with the rep, its TYPE (and objection category), and the SECTION of the call it came from:',
  ]).concat(candidates.map(function (c) { return '  [' + c.id + '] (' + c.cls.toUpperCase() + ', rep ' + c.rep + ') ' + c.type + (c.objection_category ? '/' + c.objection_category : '') + (c.section ? ' in ' + c.section : '') + ': "' + c.quote + '"'; })).concat([
    '',
    'A QUOTE MUST PROVE THE CLAIM IT SITS UNDER. For each item declare its subject: {"kind": one of buying_signal | objection | risk_signal | barrier | missed_opportunity | strong_moment | rapport_moment | disqualify_signal | section | count, "category": the objection category when kind is objection (fear | timing | partner | logistical | other) or null, "section": the section when kind is section, else null}. Cite ONLY a moment of that kind (and category); a claim built on counts is kind "count" with evidence_id null — it needs no quote. A quote that does not prove its claim is discarded downstream.',
    '',
    'Produce: WHATS WORKING (2-3 team strengths, each grounded in an evidence_id + a number), WHAT TO IMPROVE (2-3 team gaps: the team-wide weakest section, the most-lost objection category, and the synthesized one-thing theme; cite the rep(s) it most applies to and a representative evidence_id).',
    /* ⚠ THE LENGTH RULE THE CAPS SIT ABOVE. Without one there was nothing to
       derive a cap from, so the cap was a number nobody could defend — and it
       cut five of six data fields off mid-phrase. */
    'LENGTH: keep each "claim" to ONE sentence of at most 45 words, and each "data" to at most two sentences totalling 45 words. Finish your sentences — never trail off mid-clause.',
    'Respond with ONLY this JSON — no markdown: {"working":[{"claim":"...","data":"...","evidence_id":"m1","subject":{"kind":"strong_moment","category":null,"section":null}}],"improve":[{"claim":"...","data":"...","evidence_id":"m2","subject":{"kind":"objection","category":"partner","section":null}}]}',
  ]);
  if (selling.contextText && selling.contextText.trim()) {
    promptLines.splice(1, 0,
      'SELLING CONTEXT (the team\'s actual offer / sales approach — ground your assessment in it; judge against THIS offer and selling style, do not penalize approaches it endorses):',
      selling.contextText.trim(), '');
  }
  if (corr.text) promptLines.splice(1, 0, require('./coaching-corrections').promptLane(corr.text), '');
  var prompt = promptLines.join('\n');

  var resp;
  try { resp = await createWithUsage({ model: CLAUDE_MODEL, max_tokens: 2600, messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { return apiFail(e); }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed || !Array.isArray(parsed.working) || !Array.isArray(parsed.improve)) return { available: false, reason: 'synthesis returned unparseable output' };
  var allRepNames = [];
  candidates.forEach(function (c) { if (c.rep && allRepNames.indexOf(c.rep) === -1) allRepNames.push(c.rep); });
  var facts = PF.pageFacts(sections, obj, { minBucket: MIN_BUCKET });
  function resolve(arr, direction) { return resolveInsights(arr, byId, allRepNames, { facts: facts, direction: direction }); }
  var synthesis = { working: resolve(parsed.working, 'working'), improve: resolve(parsed.improve, 'improve'), generated_at: new Date().toISOString() };
  await cachePut(admin, keyId, 'team', from, to, hash, synthesis);
  return Object.assign({ available: true, cached: false }, synthesis);
}

/* ⚠⚠⚠ CALL HIGHLIGHTS OF THE WEEK — RETIRED 2026-09-01 (Justin's ruling).
   ARCHIVED IN PLACE, NOT DELETED, in case it returns.

   THE ONE-LINE REASON, because a commented block with no reason gets
   uncommented by someone who assumes it was tidying:
   ⚠⚠ UNUSEFUL, HARD TO REACH, AND 87% OF ITS QUOTES WERE THE PROSPECT RATHER
      THAN THE CLOSER. Justin's words: "while cool they're unuseful and
      difficult to navigate to."

   THE MEASUREMENT THAT MADE SCRAPPING BETTER THAN FIXING:
     candidate moments (strong_moment + handled objections)   1160
       ...carrying a real closer_response                      156   (13%)
       ...of those, UNPROVEN (no closer_response_verified)      19   (12% of 156)
   So a section called CALL HIGHLIGHTS was showing what the PROSPECT said on
   1,004 of 1,160 candidates, and quoting an unproven closer reply on 19 more.
   The open question was what fallback to design; removing the feature removed
   the question — this was the SIXTH unproven-reply lane and the only one that
   both fed a model prompt AND rendered to a manager. Closed by REMOVAL, not by
   a gate. Do not read the BUGS row as "the proven gate was applied here".

   ⚠⚠ IF THIS EVER RETURNS, ITS CSS MUST RETURN WITH IT. Three hours before this
   was written, `.review-kb-btn` was found rendering as a BROWSER-DEFAULT button
   for three days because its rule was archived with an earlier removal and the
   control was re-added without it. REMOVING A CONTROL ARCHIVES ITS STYLING, AND
   RE-ADDING THE CONTROL DOES NOT BRING THE STYLING BACK. The rules to revive
   live in web/dashboard.html under `body[data-view="team-expanded"]` and
   `.team-lane`, and the renderer is archived beside them.

   ⚠ AND IF IT RETURNS, IT NEEDS `closer_response_verified` IN ITS SELECT — the
   column is absent below, which is why the proven gate could not have worked
   here even if it had been called, and why a per-file grep reported this file
   as already fixed.

var LANES = ['objection_handling', 'challenging', 'pain_excavation'];
// ── Call Highlights of the Week ──────────────────────────────────────────────
async function computeWeeklyHighlights(admin, keyId, repIds, from, to, emailMap, nameMap) {
  if (!repIds || repIds.length === 0) return { available: true, lanes: {}, generated_at: new Date().toISOString() };
  var w = await loadTeamWindow(admin, repIds, from, to);
  if (w.callIds.length === 0) return { available: true, lanes: {}, generated_at: new Date().toISOString() };

  // Candidates: strong_moment + handled objections (the raw material for the 3 lanes).
  var hlRows = await w.inChunks('call_highlights', 'fathom_call_id, timestamp_seconds, quote, observation, closer_response, type, resolution',
    function (q) { return q.in('type', ['strong_moment', 'objection']); });
  // ⚠ DELIBERATELY NOT the shared isHandled() predicate (ruling 2026-08-17).
  // This asks "was this a GOOD MOMENT?", not "what is the rate?". A moment
  // inside a closed call is not automatically a good moment, and crediting it
  // here would file weak handling under "what worked" — the opposite of
  // coaching. The rate surfaces credit closed calls; these five do not.
  var cands = hlRows.filter(function (r) { return r.type === 'strong_moment' || r.resolution === 'handled'; }).map(function (r) {
    var rid = w.meta[r.fathom_call_id] ? w.meta[r.fathom_call_id].user_id : null;
    return { type: r.type, rep: (nameMap && nameMap[rid]) || (emailMap && emailMap[rid]) || rid, rep_id: rid,
      quote: str(displayCloserResponse(r.closer_response), 220) || str(r.quote, 220) || '', observation: str(r.observation, 200) || '',
      clip_url: clipUrl(w.meta[r.fathom_call_id] && w.meta[r.fathom_call_id].recording_url, r.timestamp_seconds),
      source: (w.meta[r.fathom_call_id] && w.meta[r.fathom_call_id].source) || null,
      call_id: r.fathom_call_id };
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
  try { resp = await createWithUsage({ model: CLAUDE_MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { return apiFail(e); }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed) return { available: false, reason: 'synthesis returned unparseable output' };
  var lanes = {};
  LANES.forEach(function (lane) {
    var pick = parsed[lane]; var ev = (pick && pick.id && byId[pick.id]) || null;
    if (ev) lanes[lane] = { rep: ev.rep, quote: ev.quote, clip_url: ev.clip_url, source: ev.source || null, call_id: ev.call_id, why: str(pick.why, 200) };
  });
  var synthesis = { lanes: lanes, generated_at: new Date().toISOString() };
  await cachePut(admin, keyId, 'highlights', from, to, hash, synthesis);
  return Object.assign({ available: true, cached: false }, synthesis);
}

*/

module.exports = {
  _spokeOf: spokeOf,
  _evidenceMismatch: evidenceMismatch,
  _evidenceSubjectMismatch: evidenceSubjectMismatch,
  _candidateEligible: candidateEligible,
  _resolveInsights: resolveInsights,
  _proseNamesRep: proseNamesRep,
  computeTeamRecommendations: computeTeamRecommendations,
  /* computeWeeklyHighlights — RETIRED 2026-09-01, archived above. */
  // shared with lib/team-digest.js (same cache table + window loader)
  loadTeamWindow: loadTeamWindow,
  cacheGet: cacheGet,
  cachePut: cachePut,
};
