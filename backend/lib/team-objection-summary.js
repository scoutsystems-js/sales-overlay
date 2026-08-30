/**
 * THE COACHING SUMMARY — step 3 of the team objection drilldown.
 *
 * ⚠⚠ THIS IS THE ONLY PART OF THE DRILLDOWN THAT GENERATES RATHER THAN
 * DISPLAYS, so it is the only part that costs money and the only part that can
 * be WRONG in a way a reader cannot check. Steps 1 and 2 are a view over stored
 * fields; if they are wrong the numbers disagree with each other and someone
 * notices. A paragraph explaining WHY a closer is struggling reads exactly the
 * same whether it is grounded or invented.
 *
 * JUSTIN'S RULING ON WORDING, verbatim:
 *   "John is struggling with the spouse objection, here's why. James is
 *    struggling with timing."
 *
 * ⚠ NAME THE CLOSERS, AT ANY TEAM SIZE. The output is a list of PER-CLOSER
 * findings, never a team generalisation — with one closer on the board it must
 * read "Josh is struggling with…", not a claim about "closers". That is
 * structural here rather than a prompt instruction: there is no team-level
 * paragraph to generate, so the failure mode is unreachable.
 *
 * ⚠⚠ AND IT MUST ANSWER *WHY*, NOT RESTATE THE RATE. "Josh handled 4 of 55
 * timing objections" is the grid he is already looking at. The value is the
 * MECHANISM behind the number — Justin's own example: "because they are not
 * pre-handling it at the beginning. At the end of the call when they are hit
 * with the objection they don't isolate it." That is why the model is fed the
 * actual exchanges and WHERE IN THE CALL each one landed, not the counts.
 */

'use strict';

const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { CLAUDE_MODEL } = require('../config');
const { snapCacheWindow } = require('./cache-window');
const { computeTeamObjections, OBJECTION_CATEGORIES } = require('./team-objections');
/* ⚠ THRESHOLDS ARE IMPORTED, NEVER RE-CHOSEN. A second set of numbers for the
   same question ("is this bucket big enough to rank?") is how one screen ends
   up claiming a focus area the panel beside it calls too thin to judge. */
const { _MIN_BUCKET: MIN_BUCKET, _MIN_GAP_PP: MIN_GAP_PP } = require('./team-needs-work');

const { displayCloserResponse } = require('./closer-side');
const SYNTHESIS_TYPE = 'team_objections';
/** Evidence per closer. Enough to show a pattern, few enough to stay cheap. */
const MAX_FAILED_EVIDENCE = 5;
const MAX_WORKED_EVIDENCE = 2;
/** The whole board in ONE call — never fan out per closer or per category. */
const MAX_CLOSERS_IN_PROMPT = 24;

/**
 * ⚠⚠ THE OUTPUT BUDGET IS THE BINDING CONSTRAINT, AND IT IS MEASURED, NOT
 * GUESSED. A truncated response is not a shorter summary — the JSON fails to
 * parse and the ENTIRE panel returns "unavailable", for every closer at once.
 *
 * MEASURED on the real board (2026-08-22): one closer's answer is why 494 +
 * what_to_do 330 chars ≈ 230 tokens, ~270 with the JSON wrapper. So the ceiling
 * has to clear MAX_CLOSERS_IN_PROMPT × 270 ≈ 6,500.
 *
 * ⚠ A FIRST DRAFT CAPPED THIS AT 4,096 AND WOULD HAVE TRUNCATED FROM ABOUT
 * FIFTEEN CLOSERS UP — invisible on today's one-closer board and a total
 * failure on a real team. Found by measuring how the prompt scales rather than
 * by testing the size we happen to have. Pinned by a test.
 */
const OUT_TOKENS_PER_CLOSER = 350;
const OUT_TOKENS_MIN = 1200;
const OUT_TOKENS_MAX = 8000;
function outputBudget(n) {
  return Math.min(OUT_TOKENS_MAX, Math.max(OUT_TOKENS_MIN, OUT_TOKENS_PER_CLOSER * n));
}

const CATEGORY_LABELS = {
  fear: 'fear', logistical: 'logistical', timing: 'timing', partner: 'partner / spouse',
};

var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  }
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

/** Brace-balanced first-JSON-object extractor — same approach as the worker. */
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

function str(x, cap) {
  return (typeof x === 'string' && x.trim()) ? x.trim().slice(0, cap || 600) : null;
}

function pctWhole(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }

/**
 * How far through the call a moment landed, as a whole percent.
 *
 * ⚠ NULL WHEN IT CANNOT BE KNOWN, never 0. A missing duration rendered as "0%
 * through the call" would tell the model every objection arrived in the opening
 * seconds — a fabricated mechanism, stated confidently, from absent data.
 */
function positionPct(ts, duration) {
  if (typeof ts !== 'number' || typeof duration !== 'number' || duration <= 0) return null;
  if (ts < 0) return null;
  return Math.max(0, Math.min(100, Math.round((ts / duration) * 100)));
}

/**
 * Per-closer state, using the model `team-needs-work` established.
 *
 * ⚠⚠ FOUR STATES, NOT TWO, AND THE REASON IS RECORDED THERE: "not enough data
 * to say" and "nothing stands out" MUST NOT render the same. That failure has
 * already been fixed once on the objection surface and must not come back
 * through a new lane. A DATA PROBLEM MUST NEVER RENDER AS GOOD NEWS.
 *
 *   no_volume         — too few objections to say anything. The ONLY state that
 *                       may claim nothing can be determined, and it is a fact
 *                       about the WINDOW, not a verdict on the closer.
 *   thin_types        — enough objections, but no single category big enough to
 *                       compare. NOT "nothing stands out": nothing was ever
 *                       compared, so claiming even handling would assert
 *                       something about data that was never examined.
 *   even_performance  — compared, and handling is level. A FINDING.
 *   rate_gap          — one category is materially below this closer's own
 *                       baseline. The only state that gets a generated WHY.
 */
/* ⚠⚠ THE MOST COMMON CATEGORY, AT ANY SIZE — the input the quiet states never had.
   `no_volume` and `thin_types` used to return `ranking: []`, so the renderer had
   NOTHING to name and fell back to describing our own bar ("no type is more than
   5 points below their own average"). That is the insufficiency-dressed-as-a-
   finding defect: a fact about the THRESHOLD rendered as a statement about the
   closer, identical for every closer with the name swapped.
   ⚠ JUSTIN'S RULING: EVEN ONE OBJECTION IS DATA. Name the type, name the rate,
   say the sample is small. A genuine empty state is reserved for total === 0. */
function topCategory(cats) {
  var best = null;
  OBJECTION_CATEGORIES.forEach(function (c) {
    var b = cats[c];
    if (!b || !b.total) return;
    if (!best || b.total > best.total) {
      var h = (b.handled || 0) + (b.credited || 0);
      best = { category: c, total: b.total, handled: h, rate_pct: pctWhole(h, b.total) };
    }
  });
  return best;
}

function classifyCloser(row) {
  var cats = row.by_category || {};
  var total = (row.total && row.total.total) || 0;
  var handled = ((row.total && row.total.handled) || 0) + ((row.total && row.total.credited) || 0);

  if (total < MIN_BUCKET) {
    return { state: 'no_volume', total: total, handled: handled, ranking: [], top: topCategory(cats) };
  }

  var ranked = [], sizeable = 0;
  OBJECTION_CATEGORIES.forEach(function (c) {
    var b = cats[c];
    if (!b || b.total < MIN_BUCKET) return;
    sizeable++;
    var bHandled = (b.handled || 0) + (b.credited || 0);
    var otherTotal = total - b.total, otherHandled = handled - bHandled;
    // baseline = this closer's OWN handling everywhere else. The comparison is
    // within a person, so a strong closer and a weak one are each measured
    // against themselves — which is what makes "John: spouse, James: timing"
    // possible rather than everyone sharing the team's worst category.
    var baseline = otherTotal > 0 ? otherHandled / otherTotal : 0;
    var rate = bHandled / b.total;
    ranked.push({
      category: c, total: b.total, handled: bHandled,
      rate_pct: pctWhole(bHandled, b.total),
      baseline_pct: otherTotal > 0 ? pctWhole(otherHandled, otherTotal) : null,
      // ⚠ the gap is kept EXACT for ranking and rounded only for display —
      // comparing rounded values collapses distinct gaps into ties and the
      // tie-break then picks deterministically, producing a stable wrong answer.
      _gap: (baseline - rate) * 100,
      gap_pp: Math.round((baseline - rate) * 1000) / 10,
    });
  });

  if (sizeable === 0) return { state: 'thin_types', total: total, handled: handled, ranking: [], top: topCategory(cats) };

  ranked.sort(function (a, b) { return b._gap - a._gap; });
  var ranking = ranked.map(function (r) {
    var o = Object.assign({}, r); delete o._gap; return o;
  });

  if (!ranked.length || ranked[0]._gap < MIN_GAP_PP) {
    return { state: 'even_performance', total: total, handled: handled, ranking: ranking };
  }
  return {
    state: 'rate_gap', total: total, handled: handled, ranking: ranking,
    focus: ranking[0],
  };
}

/**
 * Pick the moments the model reasons from.
 *
 * ⚠ FAILED MOMENTS ARE THE POINT. The question is "why is this closer losing
 * this objection", and a handled example cannot answer it. The worked examples
 * are included only as contrast — what they do when it lands — and are capped
 * far lower for that reason.
 *
 * ⚠ A CREDITED-BUT-UNHANDLED MOMENT COUNTS AS HANDLED IN THE RATE AND IS STILL
 * A FAILURE HERE. Justin's ruling credits an objection on a closed call because
 * the deal closed anyway; that says nothing about whether the closer handled the
 * moment, so it must not be held up as an example of good handling. This is the
 * same two-questions-one-row split lib/objection-synthesis.js already makes.
 */
function pickEvidence(instances, userId, category) {
  var failed = [], worked = [];
  instances.forEach(function (m) {
    if (!m.closer || m.closer.user_id !== userId) return;
    if (m.category !== category) return;
    if (m.resolution === 'handled') {
      if (worked.length < MAX_WORKED_EVIDENCE && displayCloserResponse(m.closer_response)) worked.push(m);
    } else if (failed.length < MAX_FAILED_EVIDENCE) {
      failed.push(m);
    }
  });
  return { failed: failed, worked: worked };
}

function evidenceLine(m) {
  var pos = positionPct(m.timestamp_seconds, m.duration_seconds);
  var where = (pos === null) ? 'position in call unknown' : (pos + '% through the call');
  var parts = ['    - [' + where + '] prospect: "' + (m.quote || m.surface || '').slice(0, 220) + '"'];
  var shown = displayCloserResponse(m.closer_response);   // ⚠ never a sentinel in a prompt
  parts.push('      closer replied: ' + (shown ? '"' + shown.slice(0, 300) + '"' : '(no reply captured)'));
  if (m.observation) parts.push('      what happened: ' + m.observation.slice(0, 240));
  parts.push('      outcome of the moment: ' + (m.resolution || 'not recorded')
    + (m.credited && m.resolution !== 'handled' ? ' (the CALL closed anyway — the moment itself was not handled)' : ''));
  return parts.join('\n');
}

function buildPrompt(subjects) {
  var lines = [
    'You are a high-ticket sales coach reviewing a manager\'s team.',
    '',
    'For EACH closer below, explain WHY they are losing their weakest objection category.',
    '',
    'THE ONE RULE THAT MATTERS: do NOT restate the numbers. The manager is already',
    'looking at a grid of counts and rates. "Josh handled 4 of 55 timing objections"',
    'is worthless to him. Tell him the MECHANISM — what the closer is actually doing,',
    'or failing to do, that produces that number. Read the exchanges and the point in',
    'the call where each one landed, and name the behaviour.',
    '',
    'Examples of the KIND of answer wanted (do not copy these — they are shape, not content):',
    '  - "He is not pre-handling it. Every one of these lands after the price, and by',
    '     then he is arguing rather than isolating."',
    '  - "He accepts the first reason given and moves on, so he never finds out whether',
    '     the timing objection is real or a polite exit."',
    '',
    'Ground every claim in the moments provided. If the evidence does not support a',
    'confident mechanism, say what the evidence DOES show and no more — a vague honest',
    'answer is worth more than a confident invented one.',
    '',
    'Write about each closer BY NAME, in the third person. Never write about "closers"',
    'or "the team" collectively.',
    '',
    'CLOSERS:',
  ];

  subjects.forEach(function (s) {
    lines.push('');
    lines.push('### ' + s.name + ' — weakest category: ' + (CATEGORY_LABELS[s.category] || s.category));
    lines.push('  (context, for your reasoning only — do NOT quote these figures back: '
      + s.handled + ' of ' + s.total + ' handled in this category, against '
      + (s.baseline_pct === null ? 'no comparable baseline' : s.baseline_pct + '% across their other categories') + ')');
    lines.push('  MOMENTS THAT DID NOT LAND:');
    if (s.evidence.failed.length) {
      s.evidence.failed.forEach(function (m) { lines.push(evidenceLine(m)); });
    } else {
      lines.push('    (none captured — say so rather than guessing a mechanism)');
    }
    if (s.evidence.worked.length) {
      lines.push('  MOMENTS THAT DID LAND (contrast — what works for them):');
      s.evidence.worked.forEach(function (m) { lines.push(evidenceLine(m)); });
    }
  });

  lines.push('');
  lines.push('Respond with ONLY this JSON — no markdown, no code fences:');
  lines.push('{"closers":[{"name":"<exact name as given>","why":"2-3 sentences naming the mechanism",'
    + '"what_to_do":"1-2 sentences, a concrete change to make on the next call"}]}');
  return lines.join('\n');
}

/**
 * The board's coaching summary.
 *
 * @param opts.force  skip the cache read (still writes). For measuring a miss.
 */
async function computeTeamObjectionSummary(admin, memberIds, from, to, opts) {
  opts = opts || {};
  var keyId = opts.keyId || (memberIds && memberIds[0]);

  /* ⚠⚠ READS THROUGH computeTeamObjections — THIS IS WHERE THREE REQUIREMENTS
     ARE MET AT ONCE, AND ALL THREE ARE INHERITED RATHER THAN REBUILT:
       · not_a_sales_call is already excluded from the call list, so the
         fingerprint below is computed over the filtered set and a marked call
         genuinely stops influencing the summary;
       · demo and seed rows are already gone (lib/real-calls.js), so the
         summary cannot describe Josh three times and call it a team pattern;
       · the grid the manager is reading and the paragraph beneath it come from
         ONE fetch, so they cannot disagree on the same screen.
     instanceCap is lifted because the summary must see every moment, not the
     first page of the feed. */
  var data = await computeTeamObjections(admin, memberIds, from, to, {
    emailMap: opts.emailMap, nameMap: opts.nameMap, instanceCap: 100000,
  });

  var generated_at = new Date().toISOString();
  var base = {
    board_size: data.board_size,
    totals: data.totals,
    generated_at: generated_at,
  };

  // ── board-level shortfall: nobody has anything to say anything about ──
  var classified = (data.grid || []).map(function (row) {
    return Object.assign({ user_id: row.user_id, name: row.name }, classifyCloser(row));
  });
  var speakable = classified.filter(function (c) { return c.state === 'rate_gap'; });

  if (classified.length === 0) {
    return Object.assign({ available: true, cached: false, state: 'no_volume', closers: [],
      card_text: 'No analysed objections on this board in the selected dates. '
        + 'Widen the range, or wait for new analysed calls.' }, base);
  }

  /* ⚠ A BOARD WHERE NOBODY CLEARS THE BAR STILL REPORTS PER CLOSER. The states
     differ between closers — one may be thin, another genuinely even — and
     collapsing them into a single board-level sentence would reintroduce
     exactly the conflation the four states exist to prevent. */
  if (speakable.length === 0) {
    return Object.assign({ available: true, cached: false, state: 'no_focus',
      closers: classified.map(function (c) { return withoutInternals(c); }),
      card_text: null }, base);
  }

  // ── cache ──
  // Key: (board owner, snapped window, analysis fingerprint). The fingerprint
  // comes from computeTeamObjections, computed over the already-filtered call
  // list — see the note there for why the placement is the mechanism.
  var ck = snapCacheWindow(from, to);
  var hash = crypto.createHash('md5')
    .update(data.analysis_fingerprint + '|' + memberIds.slice().sort().join(',')).digest('hex');

  if (!opts.force) {
    var cq = await admin.from('objection_synthesis_cache')
      .select('synthesis').eq('user_id', keyId).eq('synthesis_type', SYNTHESIS_TYPE)
      .eq('from_ts', ck.from).eq('to_ts', ck.to).eq('analysis_set_hash', hash).maybeSingle();
    if (!cq.error && cq.data && cq.data.synthesis) {
      return Object.assign({ available: true, cached: true }, base, cq.data.synthesis);
    }
  }

  // ── one Claude call for the whole board ──
  var subjects = speakable.slice(0, MAX_CLOSERS_IN_PROMPT).map(function (c) {
    return {
      user_id: c.user_id, name: c.name, category: c.focus.category,
      total: c.focus.total, handled: c.focus.handled, baseline_pct: c.focus.baseline_pct,
      evidence: pickEvidence(data.instances, c.user_id, c.focus.category),
    };
  });

  var resp;
  try {
    resp = await getAnthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: outputBudget(subjects.length),
      messages: [{ role: 'user', content: buildPrompt(subjects) }],
    });
  } catch (apiErr) {
    // ⚠ NEVER CACHE A FAILURE. A cached "unavailable" would persist until the
    // analysis set changed, which on a quiet week is days.
    return Object.assign({ available: false, reason: 'Anthropic API failure'
      + ((apiErr && apiErr.status) ? ' (HTTP ' + apiErr.status + ')' : '')
      + ': ' + ((apiErr && apiErr.message) || 'unknown') }, base);
  }

  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed || !Array.isArray(parsed.closers)) {
    return Object.assign({ available: false, reason: 'summary returned unparseable output' }, base);
  }

  /* ⚠⚠ THE MODEL SUPPLIES PROSE AND NOTHING ELSE. Names, categories, counts and
     every quote are re-attached from the rows we fetched, matched by the name we
     gave it. A model-supplied name that matches no closer is DROPPED rather than
     rendered — a plausible-looking name for a person who is not on the board is
     the wrong-label-worse-than-none failure, and on a coaching surface it would
     be read as a finding about a real rep. */
  var byName = {};
  parsed.closers.forEach(function (g) {
    if (g && typeof g.name === 'string') byName[g.name.trim().toLowerCase()] = g;
  });

  var closers = classified.map(function (c) {
    var out = withoutInternals(c);
    if (c.state !== 'rate_gap') return out;
    var g = byName[String(c.name).trim().toLowerCase()] || {};
    out.why = str(g.why, 700);
    out.what_to_do = str(g.what_to_do, 400);
    var subject = subjects.filter(function (s) { return s.user_id === c.user_id; })[0];
    out.evidence = subject ? subject.evidence.failed.slice(0, 3).map(publicMoment) : [];
    return out;
  });

  var synthesis = { state: 'per_closer', closers: closers, card_text: null, generated_at: generated_at };

  var up = await admin.from('objection_synthesis_cache').upsert({
    user_id: keyId, synthesis_type: SYNTHESIS_TYPE, from_ts: ck.from, to_ts: ck.to,
    analysis_set_hash: hash, synthesis: synthesis, generated_at: generated_at,
  }, { onConflict: 'user_id,synthesis_type,from_ts,to_ts,analysis_set_hash' });
  if (up.error) console.error('[team-objection-summary] cache write failed for ' + keyId + ': ' + up.error.message);

  return Object.assign({ available: true, cached: false }, base, synthesis);
}

/** Evidence as the client sees it — resolved from the DB row, never the model. */
function publicMoment(m) {
  return {
    quote: str(m.quote, 300), closer_response: str(displayCloserResponse(m.closer_response), 400),
    observation: str(m.observation, 300), clip_url: m.clip_url || null,
    source: m.source || null, call_date: m.call_date || null,
    resolution: m.resolution || null,
    position_pct: positionPct(m.timestamp_seconds, m.duration_seconds),
  };
}

function withoutInternals(c) {
  return {
    user_id: c.user_id, name: c.name, state: c.state,
    total: c.total, handled: c.handled,
    focus: c.focus || null, ranking: c.ranking || [], top: c.top || null,
    why: null, what_to_do: null, evidence: [],
  };
}

module.exports = {
  computeTeamObjectionSummary: computeTeamObjectionSummary,
  SYNTHESIS_TYPE: SYNTHESIS_TYPE,
  _classifyCloser: classifyCloser,
  _positionPct: positionPct,
  _pickEvidence: pickEvidence,
  _buildPrompt: buildPrompt,
  _MIN_BUCKET: MIN_BUCKET,
  _MIN_GAP_PP: MIN_GAP_PP,
  _outputBudget: outputBudget,
  _MAX_CLOSERS_IN_PROMPT: MAX_CLOSERS_IN_PROMPT,
};
