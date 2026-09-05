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
const createWithUsage = require('./model-usage').usageFor('team-objection-summary');
const { CLAUDE_MODEL } = require('../config');
const { snapCacheWindow } = require('./cache-window');
const { computeTeamObjections, OBJECTION_CATEGORIES } = require('./team-objections');
/* ⚠ THRESHOLDS ARE IMPORTED, NEVER RE-CHOSEN. A second set of numbers for the
   same question ("is this bucket big enough to rank?") is how one screen ends
   up claiming a focus area the panel beside it calls too thin to judge. */
const { _MIN_BUCKET: MIN_BUCKET, _MIN_GAP_PP: MIN_GAP_PP } = require('./team-needs-work');

const { displayCloserResponse, provenCloserResponse } = require('./closer-side');
/* ⚠ ONE tone rule, four lanes — see lib/coaching-tone.js. Four copies drift, and a
   drifted tone rule is INVISIBLE: nothing fails, the wording just softens in one
   lane and not another. */
const TONE = require('./coaching-tone.js');
const SYNTHESIS_TYPE = 'team_objections';

/* ⚠⚠ THE PROMPT VERSION IS PART OF THE CACHE KEY, AND IT IS LOAD-BEARING.
   The generated COPY lives inside the cached payload, so a prompt change alone
   moves nothing on screen: every existing entry keeps serving the old wording
   until the underlying analyses happen to change. There are 20 cached entries
   for this lane today — all of them would have gone on rendering the rejected
   third-person copy while the change looked shipped.
   ⚠ THIS IS THE SAME LESSON AS NEEDS_WORK_LANE_VERSION. Bump it on EVERY change
   to buildPrompt, in the SAME commit — a prompt edit and its version bump are
   one atomic change, exactly as they are for the grader. */
const PROMPT_VERSION = 'v14-2026-09-05-kb-material';   /* v14 (H731): the offer/qualifications/script join the notes in the prompt through the one retrieval; nothing relevant → nothing said. Was v13-2026-09-02-never-diminish-manager-notes-moment-ids */ //   /* payload shape: each evidence moment now carries highlight_id + fathom_call_id (Fine Tune Coaching surface ③) */   /* the prompt gained the MANAGER NOTES lane (Fine Tune Coaching) */   /* ⚠ THE PAYLOAD SHAPE CHANGED, NOT THE PROMPT: publicMoment now carries `ts`, and it runs BEFORE the cache write — so without this bump every cached window keeps rendering "57% through the call" indefinitely. A shape change earns a bump exactly as a prompt change does. */
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
const OUT_TOKENS_PER_CLOSER = 420;
const OUT_TOKENS_MIN = 1800;
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

/* \u26a0\u26a0 THE PROSE CAPS ARE DERIVED FROM THE PROMPT'S OWN LENGTH RULE, AND THEY
   SIT ABOVE IT ON PURPOSE. The prompt asks for ~60 words a beat: `what_to_do` is
   ONE beat (~350 chars), `why` is TWO (~700). A cap set AT the intended maximum
   fires on normal output rather than on a runaway \u2014 which is exactly what
   happened: measured on seven real cards, what_to_do ran 345-465 against a 400
   cap, so SIX OF SEVEN were cut mid-word and shipped to a manager that way.
   These bound a genuine runaway (~1.7x observed max) and are never reached by
   output that obeys the rule.
   \u26a0 AND THE SHAPE MATTERS MORE THAN THE NUMBER, because the number will drift
   again the next time the contract changes: capProse cuts at a SENTENCE boundary,
   so if it ever does fire the note still ends as a complete thought. A mid-word
   cut is how "losing it to a link she may never" reached the panel. */
const WHY_CAP = 1200;
const WHAT_TO_DO_CAP = 800;
function capProse(x, cap) {
  var t = (typeof x === 'string' && x.trim()) ? x.trim() : null;
  if (!t || t.length <= cap) return t;
  var cut = t.slice(0, cap);
  var end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > cap * 0.5) return cut.slice(0, end + 1);
  var sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut) + '\u2026';
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
/* hh:mm:ss, or null. ⚠ ONE definition — the prompt builder and the client
   payload both call it, so the time a manager reads is the same time the model
   was given. */
function hmsOf(ts) {
  if (typeof ts !== 'number' || !isFinite(ts) || ts < 0) return null;
  var t = Math.floor(ts);
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
    .map(function (n) { return String(n).padStart(2, '0'); }).join(':');
}

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

/* THE CATEGORY TO COACH ON. `rate_gap` already names one; every other state has
   a populated `ranking` sorted weakest-first, so its head is the same answer by
   the same measure. Returns null only when nothing was rankable at all — which
   is what keeps a closer with no comparable category out of the prompt rather
   than sending the model a subject it cannot say anything about. */
function focusOf(c) {
  if (!c) return null;
  if (c.focus) return c.focus;
  var r = c.ranking;
  if (Array.isArray(r) && r.length) return r[0];
  /* ⚠⚠ THE `top` FALLBACK (Justin, 2026-09-01). Without it this returned null
     for `thin_types` — no single category is big enough to RANK — and that
     silently withheld coaching from closers who plainly have objections.
     Josh N sat at 0 of 4 on fear and got nothing.
     ⚠ It contradicted a standing ruling: "regardless if they handle 0/50 or
     50/50 you can still give coaching moments like this." Ranking is about
     whether one category STANDS OUT; that is a different question from whether
     there is anything worth saying.
     ⚠⚠ AND baseline_pct IS NORMALISED TO null DELIBERATELY. `top` has no such
     field, and the prompt builder tests `s.baseline_pct === null` STRICTLY — so
     an `undefined` here would emit "undefined% across their other categories"
     INTO A MODEL PROMPT. A placeholder that is a valid value of its own type is
     exactly what that check cannot see. */
  var t = c.top;
  if (t && t.category && t.total) {
    return {
      category: t.category, total: t.total, handled: t.handled,
      baseline_pct: (typeof t.baseline_pct === 'number') ? t.baseline_pct : null,
    };
  }
  return null;   // genuinely no categories at all — nothing to point at
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
      if (worked.length < MAX_WORKED_EVIDENCE && provenCloserResponse(m)) worked.push(m);
    } else if (failed.length < MAX_FAILED_EVIDENCE) {
      failed.push(m);
    }
  });
  return { failed: failed, worked: worked };
}

function evidenceLine(m) {
  var pos = positionPct(m.timestamp_seconds, m.duration_seconds);
  var where = (pos === null) ? 'position in call unknown' : (pos + '% through the call');
  // ⚠ THE CLOCK TIME, not just the position — the copy must LEAD with a timestamp
  // and the model cannot write one it was never given.
  var hms = hmsOf(m.timestamp_seconds);   // ⚠ the SAME helper the payload uses
  var parts = ['    - at ' + (hms || 'time unknown') + ' (' + where + ') prospect: "'
    + (m.quote || m.surface || '').slice(0, 220) + '"'];
  var shown = provenCloserResponse(m);   // ⚠ never a sentinel, never unproven, in a prompt
  parts.push('      closer replied: ' + (shown ? '"' + shown.slice(0, 300) + '"' : '(no reply captured)'));
  if (m.observation) parts.push('      what happened: ' + m.observation.slice(0, 240));
  parts.push('      outcome of the moment: ' + (m.resolution || 'not recorded')
    + (m.credited && m.resolution !== 'handled' ? ' (the CALL closed anyway — the moment itself was not handled)' : ''));
  return parts.join('\n');
}

function buildPrompt(subjects, managerNotes, sellingContext) {
  var lines = [
    'You are a high-ticket sales coach writing to ONE closer at a time.',
    '',
    '⚠ THERE MAY BE SEVERAL CLOSERS BELOW. WRITE ONE ENTRY FOR EVERY SINGLE ONE OF',
    'THEM — one object in the array per closer, using their name exactly as given.',
    'Never merge two closers into one entry and never skip one.',
    '',
    '⚠ THE MANAGER READS THIS, BUT YOU ARE WRITING TO THE CLOSER. Their name is',
    'already the heading above your text, so write in the SECOND PERSON — "you",',
    'not their name and not "the closer". A manager should be able to forward what',
    'you write, unchanged, to the person it is about.',
    '',
    TONE.NEVER_DIMINISH,
    '',
    'WRITE EXACTLY THREE SHORT PARAGRAPHS, in this order.',
    '',
    '1. WHAT HAPPENED. Lead with the moment: the timestamp and what the prospect',
    '   actually said. Then the miss, in one plain sentence. Say what it cost.',
    '2. THE PRINCIPLE. The general rule this is an instance of — the thing that will',
    '   be true on the next call and the one after. One or two sentences.',
    '3. WHAT TO DO NEXT TIME. A concrete move. This paragraph IS the coaching, and',
    '   without it you have written an assessment, not a coaching note.',
    '',
    '⚠⚠ THE TEST, AND APPLY IT TO YOUR OWN THIRD PARAGRAPH BEFORE YOU FINISH: STRIP',
    'THE QUOTED LINE OUT. If what remains still tells them what to do and why, you',
    'have written coaching. If nothing is left, you have written a script. Give the',
    'MOVE and what it achieves — never a sentence to recite.',
    '',
    'HOW TO WRITE IT — this matters as much as what you say:',
    '  - Plain words a closer uses out loud. If you would not say it on a call, cut it.',
    '  - ⚠ NO ABSTRACT NOUNS STACKED TOGETHER. "relational equity", "a handled',
    '    variable", "a hard structural block" are all rejected copy. Say the thing.',
    '  - No buzzwords: leverage, holistic, robust, seamless, streamline, alignment.',
    '  - Be specific — the actual timestamp, the actual words, the actual number.',
    '  - ⚠ If you cannot picture it happening in a real conversation, rewrite it.',
    '  - ⚠⚠ SHORT. Each paragraph is TWO OR THREE SENTENCES. The third one is the',
    '    coaching, not an essay — give the move and stop. If a paragraph runs past',
    '    about 60 words you are explaining rather than coaching, and the note stops',
    '    being read. "So wordy" is the single most common complaint about this text.',
    '',
    '⚠⚠ GIVE THE MOVE AND WHAT IT ACHIEVES — NEVER A LINE TO RECITE.',
    '   THE TEST, and apply it to your own third paragraph before you finish: STRIP',
    '   THE QUOTED LINE OUT. If what remains still tells them what to do and why,',
    '   you have written coaching. If nothing is left, you have written a script.',
    '   ⚠ A closer who achieves the same thing in different words has done it right.',
    '   Coaching them to say exact words makes them read a teleprompter, and a rep',
    '   who is handed a line that is not how they talk stops trusting the note.',
    '⚠ NAME WHAT THE ANSWER TELLS THEM — both possible replies and what each opens.',
    '   That is what lets them handle the NEXT one alone rather than the next',
    '   identical one. ⚠ But do not decay into vagueness: "dig deeper, isolate the',
    '   objection" with no substance is WORSE than a script. Name the exact',
    '   information to get.',
    '⚠⚠ DO NOT STATE A ROLE FOR ANYONE WHO MERELY APPEARS IN A QUOTE. A name being',
    '   real does not make a claim about that person real: you were told what was',
    '   said, never who they are. "Henry was the second decision-maker" is exactly',
    '   the kind of confident invented detail that destroys the whole note.',
        '⚠⚠ NEVER INVENT, AND HOW TO QUOTE IS AN OPERATION, NOT AN ADJECTIVE: COPY A',
    'CONTIGUOUS RUN OF CHARACTERS FROM ONE LINE BELOW. You may shorten by cutting',
    'from the START or the END. You may NEVER join a beginning to a later ending,',
    'and you may never bridge a gap with a dash or an ellipsis — that produces a',
    'sentence the prospect never said. If the full line is too long, quote LESS of',
    'it, not a stitched-together version of it.',
    '⚠ If a claim is not supported by a moment here, do not make it.',
    '⚠⚠ YOU DO NOT KNOW HOW ANY CALL ENDED. You are shown ONE exchange per',
    '   moment and whether that objection was resolved — nothing else. "unhandled"',
    '   means THAT OBJECTION was not resolved in THAT exchange. It does NOT mean the',
    '   call was lost, the prospect walked, or the deal died: an unhandled objection',
    '   happens on calls that close. Never write "you lost the sale", "the call',
    '   ended without", "they walked", or any other claim about the outcome. Say',
    '   what happened in the exchange and stop there.',
    '⚠⚠ DO NOT NAME ANYONE — NOT THE PROSPECT AND NOT ANY THIRD PARTY. Write "they",',
    '"the prospect", "their partner". A name may appear inside a quote you were given,',
    'but you have NOT been told who that person is or what role they played, so any',
    'claim about them is a guess. "Henry was the second decision-maker" is exactly the',
    'kind of confident invented detail that destroys the whole note.',
    '\u26a0\u26a0 YOU DO NOT KNOW THE PROSPECT\u0027S GENDER. Say "they", never "he" or "she"',
    '   \u2014 AND THE MOMENTS BELOW MAY USE "he" OR "she" FOR THEM. Those observations',
    '   were written ABOUT the call, not TO the closer. Do not copy their pronouns.',
    '   \u26a0 THE ONE EXCEPTION IS A THIRD PARTY WHOSE RELATIONSHIP THE PROSPECT',
    '   THEMSELVES STATED IN A QUOTE \u2014 if they said "my husband", you may write',
    '   "her husband" is wrong but "their husband" and "him" are fine, because THEY',
    '   told you that. THE PROSPECT IS STILL "they", even in the same sentence.',
    '⚠ do NOT restate the numbers. The manager is already looking at a grid of',
    'counts and rates. Tell them the MECHANISM — what this closer is actually doing,',
    'or failing to do, that produces that number.',
    '⚠ Never write about "closers" or "the team" collectively. One closer is not the',
    'team, and a note about everyone is a note to no one.',
    '',
    'TONE FOLLOWS THE OBJECTION. Fear wants a gentler read — the prospect is hesitant,',
    'not blocked. A real logistical constraint wants directness. Do not flatten them.',
    '',
    'WHAT GOOD LOOKS LIKE (shape, not content — do not copy these words):',
    '  "The husband was never on your radar because you never asked. That is a',
    '   discovery miss, and it cost you the close."',
    '  "When someone gives you a real constraint, pushing makes you the problem. Find',
    '   out which kind you are facing before you decide how hard to press."',
    '  "Next time isolate the objection to make sure the partner is not a smokescreen.',
    '   If it is a real blocker, get a timeline and book the follow-up ON THE CALL."',
    '',
    '⚠ THAT THIRD LINE IS DRAWN FROM THIS TEAM\'S OWN OBJECTION FRAMEWORK, AND SO',
    'SHOULD YOURS BE: isolate first to find out whether a partner objection is a',
    'smokescreen or real. You cannot overcome a genuine logistical blocker — so',
    'identify it, get a timeline, and book the next call while you still have them on',
    'the phone rather than leaving it to a text that may never come.',
    '',
    'Ground every claim in the moments provided. If the evidence does not support a',
    'confident mechanism, say what the evidence DOES show and no more — a vague honest',
    'answer is worth more than a confident invented one.',
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
  lines.push('⚠⚠ THE THREE PARAGRAPHS ARE SPLIT ACROSS TWO FIELDS AND EACH APPEARS ONCE.');
  lines.push('   "why" holds paragraph 1 AND paragraph 2, separated by a blank line.');
  lines.push('   "what_to_do" holds paragraph 3 and NOTHING ELSE.');
  lines.push('   ⚠ DO NOT put paragraph 3 in "why" as well — they are rendered one after the');
  lines.push('   other, so a repeat shows up twice on screen and doubles the length.');
  lines.push('');
  /* FINE TUNE COACHING (2026-09-02): the team's corrections, through the one
     shared lane. This lane carried NO knowledge-base context before, so the
     notes are ADDED here, not appended: +~150 tokens of header when any note
     exists, +~40 tokens per note, nothing when the team has none. */
  if (managerNotes && String(managerNotes).trim()) { lines.push(require('./coaching-corrections').promptLane(managerNotes)); lines.push(''); }
  if (sellingContext && String(sellingContext).trim()) { lines.push('SELLING CONTEXT (this team\'s offer, qualifications and approach — ground the coaching in it, never in invented doctrine):'); lines.push(String(sellingContext).trim()); lines.push(''); }   // H731
  lines.push('Respond with ONLY this JSON — no markdown, no code fences:');
  lines.push('{"closers":[{"name":"<exact name as given>",'
    + '"why":"paragraph 1 (what happened — lead with the timestamp and their words) then a blank line then paragraph 2 (the principle)",'
    + '"what_to_do":"paragraph 3 ONLY: the concrete move for next time"}]}');
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
  /* ⚠⚠ EVERY CLOSER ON THE BOARD APPEARS (Justin's ruling 2026-08-30). `data.grid`
     only carries closers who HAVE objection data, so a rep with none in range was
     absent from the panel entirely — two of nine on the live board. A manager
     reading a list of seven on a team of nine cannot tell whether the other two
     are fine, missing, or not on the team.
     ⚠ `no_data` is its own state, not `no_volume`: "no objections came up" and
     "too few to say anything" are different facts, and this project has paid
     twice for collapsing two meanings into one sentence. */
  var present = {};
  classified.forEach(function (c) { present[c.user_id] = 1; });
  /* ⚠⚠ ONLY CLOSERS WHO TOOK A REAL CALL. Adding every memberId put a DEMO
     account on the board — caught by the guard that exists for exactly that.
     `real_call_owners` is derived from the already-filtered call list, so the
     synthetic exclusion is inherited rather than re-implemented here. */
  var tookCalls = {};
  (data.real_call_owners || []).forEach(function (id) { tookCalls[id] = 1; });
  (memberIds || []).forEach(function (id) {
    if (present[id]) return;
    if (!tookCalls[id]) return;
    var nm = (opts.nameMap && opts.nameMap[id]) || (opts.emailMap && opts.emailMap[id]) || null;
    if (!nm) return;                       // ⚠ never render an unnamed row — a uuid is not a person
    classified.push({ user_id: id, name: nm, state: 'no_data', total: 0, handled: 0, ranking: [] });
  });

  /* ⚠⚠ EVERY CLOSER WITH OBJECTIONS GETS COACHED (Justin's ruling 2026-08-30):
     "regardless if they handle 0/50 or 50/50 you can still give coaching moments
     like this." This filter used to be `state === 'rate_gap'`, which withheld
     evidence and prose from FIVE closers of seven on the live board — not for
     want of material (pickEvidence has the quotes, timestamps and replies all
     along) but because the state model decides whether one category stands out
     from the others, and that is a different question from whether there is
     anything worth saying.
     ⚠ THERE IS ALWAYS SOMETHING WORTH SAYING. A rep at 0 of 32 has a specific
     moment that went wrong and a specific thing to do next time, exactly like a
     rep at 12 of 30.
     ⚠ `no_data` is the ONE exception BY INTENT: genuinely no objections is the
     only case with nothing to coach from.
     ⚠⚠ AND IT WAS NOT THE ONLY ONE IN PRACTICE UNTIL 2026-09-01. `focusOf(c)
     !== null` on the next line was a SECOND exception nobody declared, and it
     withheld coaching from every `thin_types` closer. Fixed by giving focusOf a
     `top` fallback — see focusOf. Do not re-narrow it. */
  /* ⚠⚠ TWO CONDITIONS, AND BOTH ARE DECLARED — the comment above used to claim
     `no_data` was "the ONE exception" while this filter had a second, silent
     one: focusOf returned null whenever `ranking` was empty, which is exactly
     what `thin_types` MEANS. A comment asserting a single exception above a
     filter with two is how the next reader inherits the wrong model.
     ⚠ NOW: focusOf falls back to `top`, so the only closers still excluded are
     `no_data` (no objections at all) and the vanishing case of a closer whose
     categories are all empty. Both genuinely have nothing to coach from. */
  var speakable = classified.filter(function (c) {
    return c.state !== 'no_data' && focusOf(c) !== null;
  });

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
  var material = await require('./kb-material').loadKbMaterial(admin, { userId: keyId, teamKey: keyId, lane: 'team-objection-summary', maxChars: 2500 });   // H731
  var corr = material.notes;
  var hash = crypto.createHash('md5')
    .update(PROMPT_VERSION + '|' + data.analysis_fingerprint + '|' + memberIds.slice().sort().join(',') + '|kb:' + material.kbHash)
    .digest('hex');

  if (!material.hasMaterial) return Object.assign({ available: true, cached: false, state: 'no_material', closers: [], card_text: null, generated_at: new Date().toISOString(), no_material: true, copy: require('./kb-material').NO_MATERIAL_COPY }, base);   // H731
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
    var f = focusOf(c);
    return {
      user_id: c.user_id, name: c.name, category: f.category,
      total: f.total, handled: f.handled, baseline_pct: f.baseline_pct,
      evidence: pickEvidence(data.instances, c.user_id, f.category),
    };
  });

  var resp;
  try {
    resp = await createWithUsage({
      model: CLAUDE_MODEL,
      max_tokens: outputBudget(subjects.length),
      messages: [{ role: 'user', content: buildPrompt(subjects, corr.text, material.contextText) }],
    });
  } catch (apiErr) {
    // ⚠ NEVER CACHE A FAILURE. A cached "unavailable" would persist until the
    // analysis set changed, which on a quiet week is days.
    return Object.assign({ available: false, reason: 'Anthropic API failure'
      + ((apiErr && apiErr.status) ? ' (HTTP ' + apiErr.status + ')' : '')
      + ': ' + ((apiErr && apiErr.message) || 'unknown') }, base);
  }

  /* \u26a0\u26a0 TRUNCATION AND JUNK REACH THE SAME BRANCH AND ARE OTHERWISE
     INDISTINGUISHABLE \u2014 a cap grown too small looks exactly like a model
     returning nonsense, and only one of those is fixed by changing a number.
     Worse here: extractJson can RECOVER a cut response, so a partial note ships
     with no signal at all. Log the stop reason so the two are separable. */
  if (resp && resp.stop_reason === 'max_tokens') {
    console.error('[team-objection-summary] output hit max_tokens ('
      + outputBudget(subjects.length) + ') for ' + subjects.length
      + ' closers \u2014 notes may be cut mid-sentence');
  }
  var parsed = extractJson(resp.content && resp.content[0] ? resp.content[0].text : '');
  if (!parsed || !Array.isArray(parsed.closers)) {
    /* \u26a0 A failure that records no reason is a failure nobody can diagnose.
       Log the shape, never the content (the response carries prospect quotes). */
    var _raw = (resp.content && resp.content[0] && resp.content[0].text) || '';
    console.error('[team-objection-summary] unparseable output: stop_reason='
      + (resp && resp.stop_reason) + ' chars=' + _raw.length
      + ' out_tokens=' + ((resp && resp.usage && resp.usage.output_tokens) || '?')
      + '/' + outputBudget(subjects.length) + ' closers=' + subjects.length);
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
    // ⚠ was `c.state !== 'rate_gap'` — the same narrowing, one layer down. Every
    // subject that reached the model gets its prose and its evidence back.
    if (speakable.indexOf(c) === -1) return out;
    var g = byName[String(c.name).trim().toLowerCase()] || {};
    out.why = capProse(g.why, WHY_CAP);
    out.what_to_do = capProse(g.what_to_do, WHAT_TO_DO_CAP);
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
    /* FINE TUNE COACHING surface ③ (2026-09-02): the moment itself, so the control
       can record what it was given on. Ids only — nothing else about the row. */
    highlight_id: m.id || null, fathom_call_id: m.fathom_call_id || null,
    quote: str(m.quote, 300), closer_response: str(provenCloserResponse(m), 400),
    observation: str(m.observation, 300), clip_url: m.clip_url || null,
    source: m.source || null, call_date: m.call_date || null,
    resolution: m.resolution || null,
    /* ⚠⚠ THE TIMESTAMP, NOT A PERCENTAGE. "57% through the call" is not a place
       in a conversation — a closer cannot go there, and the rest of the product
       says 00:41:08. The hh:mm:ss was ALREADY being built for the model's own
       prompt a few hundred lines up; the payload simply never carried it.
       ⚠ position_pct STAYS: the model still reads it, and it is the honest
       fallback for a call with no usable duration. */
    ts: hmsOf(m.timestamp_seconds),
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
  _PROMPT_VERSION: PROMPT_VERSION,
  _publicMoment: publicMoment,
  _classifyCloser: classifyCloser,
  _focusOf: focusOf,
  _positionPct: positionPct,
  _hmsOf: hmsOf,
  _pickEvidence: pickEvidence,
  _buildPrompt: buildPrompt,
  _MIN_BUCKET: MIN_BUCKET,
  _MIN_GAP_PP: MIN_GAP_PP,
  _outputBudget: outputBudget,
  _capProse: capProse,
  _MAX_CLOSERS_IN_PROMPT: MAX_CLOSERS_IN_PROMPT,
};
