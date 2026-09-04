/**
 * The capture of causes — the closer's ARC behind a buying signal (H718/H719).
 *
 * WHAT THIS IS. A buying signal is an EFFECT: the library stores the prospect's
 * line and, until v41, nothing about what the closer did to earn it. This module
 * is the one place the CAUSE lives: the closer's move from a CLOSED vocabulary,
 * the verbatim closer lines that prove it, the arc's start, and a one-sentence
 * summary in the framework voice. It also carries the third thing Justin added,
 * which is neither cause nor effect: what the closer did with a disclosure —
 * let it slide · dug deeper · banked it and used it later.
 *
 * JUSTIN'S RULINGS (2026-09-03), IN ORDER OF WHAT THEY PROTECT:
 *   1. THE VOCABULARY IS CLOSED. Sixteen moves. A move that does not fit is
 *      `none`, never a new name — free prose produces 400 phrasings of one thing
 *      and is searchable by nothing. An unknown name is stored as `none` with
 *      reason `not_in_vocabulary` and the claimed name kept under `refused`, so
 *      the drift is visible and countable rather than silently renamed.
 *   2. THE UNIT IS THE ARC, NOT THE LINE BEFORE. "You built up the pain with
 *      hard questions like X and Y until he dropped the ego" is the framework;
 *      "you said 'so what are you gonna do'" is a word track. The summary is the
 *      framework sentence; the evidence lines are X and Y.
 *   3. TWO OR THREE VERBATIM CLOSER LINES OR NO MOVE. Everything before a signal
 *      LOOKS causal and a model will tell a story. Every evidence line is located
 *      in the stored transcript by the same reconstruction the quotes use
 *      (lib/quote-locate.js) and must be the CLOSER's; ONE failure refuses the
 *      WHOLE cause, stored as `none — not_evidenced` with the claim under
 *      `refused` — the guard doing its job in public, never a silent drop.
 *   4. `none — arrived_pre_sold` IS A RESULT. The closer did not earn it and is
 *      credited with nothing; the count of `none` per rep is the second most
 *      useful thing a manager can be told (how many closes the rep created).
 *   5. THE WINDOW. Measured on 970 signals: two or more closer questions sit
 *      within three minutes before 83% of signals, five minutes 94%, eight
 *      minutes 98%; the first question in a ten-minute window sits at the
 *      window's EDGE for most signals, so no rule finds where a thread began —
 *      a model reading the window can. Five minutes, widened once to eight when
 *      fewer than two closer questions sit inside, then `none`.
 *   6. THE DISCLOSURE TIER NEEDS BOTH ENDS. `banked_and_used` is stored only
 *      with a located closer callback AFTER the moment; `dug_deeper` only with a
 *      located closer response; `let_it_slide` needs nothing (the absence is the
 *      finding). Same guard, same public refusal.
 *
 * Pure. No DB, no model call. The extractor prompt block below is the ONE text
 * both the write-time capture and the backward pass send — never copied.
 */
'use strict';

var MOVES = {
  discovery:       ['digging for pain', 'uncovering goals', 'establishing why now', 'screening decision makers', 'qualifying financially', 'mapping the current situation'],
  objections:      ['isolating', 'normalising the fear', 'naming the fear', 'reframing', 'booking the follow-up', 'testing the smokescreen'],
  pitch_and_close: ['anchoring price', 'asking for the sale', 'handling the partner', 'confirming understanding'],
};
var ALL_MOVES = [].concat(MOVES.discovery, MOVES.objections, MOVES.pitch_and_close);
var NONE = 'none';
var NONE_REASONS = ['arrived_pre_sold', 'no_closer_work', 'not_evidenced', 'not_in_vocabulary'];
var TIERS = ['let_it_slide', 'dug_deeper', 'banked_and_used'];

var WINDOW_SECONDS = 300;          // five minutes — 94% of signals hold two closer questions
var WIDENED_WINDOW_SECONDS = 480;  // eight minutes — 98%; widened ONCE, then none
var MIN_EVIDENCE = 2;
var MAX_EVIDENCE = 3;
var SUMMARY_MAX_CHARS = 240;
var CAUSE_TEXT_MAX_CHARS = 300;    // the KB text gains a FIELD, never a longer chunk (the 3,100-char defect)

function isMove(m) { return typeof m === 'string' && ALL_MOVES.indexOf(m) !== -1; }

function cleanLine(e) {
  if (!e || typeof e !== 'object') return null;
  var ts = (typeof e.timestamp_seconds === 'number' && isFinite(e.timestamp_seconds)) ? Math.floor(e.timestamp_seconds) : null;
  var q = (typeof e.quote === 'string') ? e.quote.trim().slice(0, 400) : '';
  if (ts == null || ts < 0 || !q) return null;
  return { timestamp_seconds: ts, quote: q };
}

// Shape-only coercion at the sanitize boundary. Returns null when the model
// offered nothing usable (NULL in the column = not offered / not assessed,
// which is a different fact from `none`).
function sanitizeCause(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var move = (typeof raw.move === 'string') ? raw.move.trim().toLowerCase() : '';
  if (!move) return null;
  var ev = Array.isArray(raw.evidence) ? raw.evidence.map(cleanLine).filter(Boolean) : [];
  return {
    move: move,
    none_reason: (typeof raw.none_reason === 'string') ? raw.none_reason.trim().toLowerCase() : null,
    evidence: ev,
    summary: (typeof raw.summary === 'string') ? raw.summary.trim().slice(0, SUMMARY_MAX_CHARS) : null,
  };
}

function sanitizeDisclosure(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var tier = (typeof raw.tier === 'string') ? raw.tier.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (!tier) return null;
  return { tier: tier, response: cleanLine(raw.response), callback: cleanLine(raw.callback) };
}

function refusedCause(claimed, reason, extra) {
  return Object.assign({ move: NONE, none_reason: reason, evidence: null, arc_start_seconds: null,
    summary: (claimed && claimed.summary) || null, refused: { move: claimed ? claimed.move : null } }, extra || {});
}

/**
 * Verify a sanitized cause against the transcript. `labelForQuote(turns, q)`
 * returns 'CLOSER' | 'PROSPECT' | null (lib/quote-locate.js).
 * @returns the STORED shape — never throws, never returns null for a claim.
 */
function verifyCause(cause, turns, signalTs, labelForQuote) {
  var c = sanitizeCause(cause);
  if (!c) return null;
  if (c.move === NONE) {
    var reason = (NONE_REASONS.indexOf(c.none_reason) !== -1 && c.none_reason !== 'not_evidenced' && c.none_reason !== 'not_in_vocabulary')
      ? c.none_reason : 'no_closer_work';
    return { move: NONE, none_reason: reason, evidence: null, arc_start_seconds: null, summary: c.summary, refused: null };
  }
  if (!isMove(c.move)) return refusedCause(c, 'not_in_vocabulary');
  var lines = c.evidence.slice(0, MAX_EVIDENCE);
  if (lines.length < MIN_EVIDENCE) return refusedCause(c, 'not_evidenced', { refused: { move: c.move, unlocated: 0, offered: lines.length } });
  var ts = (typeof signalTs === 'number') ? signalTs : null;
  var unlocated = 0;
  var checked = lines.map(function (e) {
    var inArc = ts == null || (e.timestamp_seconds <= ts && e.timestamp_seconds >= ts - WIDENED_WINDOW_SECONDS);
    var label = inArc ? labelForQuote(turns, e.quote) : null;
    var ok = inArc && label === 'CLOSER';
    if (!ok) unlocated++;
    return { timestamp_seconds: e.timestamp_seconds, quote: e.quote, located: ok };
  });
  if (unlocated > 0) return refusedCause(c, 'not_evidenced', { refused: { move: c.move, unlocated: unlocated, offered: lines.length } });
  var start = checked.reduce(function (m, e) { return Math.min(m, e.timestamp_seconds); }, Infinity);
  return { move: c.move, none_reason: null, evidence: checked, arc_start_seconds: isFinite(start) ? start : null, summary: c.summary, refused: null };
}

function refusedTier(claimed, reason) {
  return { tier: null, none_reason: reason, response: null, callback: null, refused: { tier: claimed ? claimed.tier : null } };
}

/** Verify a disclosure tier: both ends or nothing. */
function verifyDisclosure(d, turns, momentTs, labelForQuote) {
  var s = sanitizeDisclosure(d);
  if (!s) return null;
  if (TIERS.indexOf(s.tier) === -1) return refusedTier(s, 'not_in_vocabulary');
  var ts = (typeof momentTs === 'number') ? momentTs : null;
  function locatedCloser(line, after) {
    if (!line) return false;
    if (ts != null && after && line.timestamp_seconds <= ts) return false;
    return labelForQuote(turns, line.quote) === 'CLOSER';
  }
  if (s.tier === 'banked_and_used') {
    if (!locatedCloser(s.callback, true)) return refusedTier(s, 'not_evidenced');
    var resp = (s.response && locatedCloser(s.response, false)) ? s.response : null;
    return { tier: s.tier, none_reason: null, response: resp, callback: s.callback, refused: null };
  }
  if (s.tier === 'dug_deeper') {
    if (!locatedCloser(s.response, false)) return refusedTier(s, 'not_evidenced');
    return { tier: s.tier, none_reason: null, response: s.response, callback: null, refused: null };
  }
  return { tier: 'let_it_slide', none_reason: null, response: null, callback: null, refused: null };
}

/** The sentence the KB text gains. A field, never a chunk. */
function causeContentText(cause) {
  if (!cause || typeof cause !== 'object' || !cause.move) return '';
  var out;
  if (cause.move === NONE) {
    var why = { arrived_pre_sold: 'arrived pre-sold', no_closer_work: 'no closer work found', not_evidenced: 'not evidenced', not_in_vocabulary: 'not in the vocabulary' }[cause.none_reason] || 'none';
    out = 'The closer’s move: none (' + why + ').';
    if (cause.summary && cause.none_reason === 'arrived_pre_sold') out += ' ' + cause.summary;
  } else {
    out = 'The closer’s move: ' + cause.move + '.' + (cause.summary ? ' ' + cause.summary : '');
  }
  return out.length > CAUSE_TEXT_MAX_CHARS ? out.slice(0, CAUSE_TEXT_MAX_CHARS - 1).replace(/\s+\S*$/, '') + '…' : out;
}

function isQuestion(t) { return /\?/.test(String(t.text || '')); }

/** The turns a model reads to find the arc: five minutes, widened once to eight. */
function windowTurns(turns, signalTs) {
  var arr = Array.isArray(turns) ? turns : [];
  function slice(sec) {
    return arr.filter(function (t) {
      return typeof t.start_seconds === 'number' && t.start_seconds <= signalTs && t.start_seconds >= signalTs - sec;
    });
  }
  var five = slice(WINDOW_SECONDS);
  var closerQs = five.filter(function (t) { return t.speaker === 'CLOSER' && isQuestion(t); }).length;
  if (closerQs >= MIN_EVIDENCE) return { seconds: WINDOW_SECONDS, turns: five, closer_questions: closerQs };
  var eight = slice(WIDENED_WINDOW_SECONDS);
  return { seconds: WIDENED_WINDOW_SECONDS, turns: eight, closer_questions: eight.filter(function (t) { return t.speaker === 'CLOSER' && isQuestion(t); }).length };
}

/** The ONE cause block — the extractor (write time) and the backward pass both send it. */
function causePromptBlock() {
  return [
    'FOR type="buying_signal" MOMENTS, also include cause — WHAT THE CLOSER DID TO EARN THIS SIGNAL. This is the closer\'s ARC over the minutes before the signal, not the single line before it:',
    '  - cause.move: exactly one of these, or "none". The set is CLOSED — if what the closer did is not one of these, write "none"; never invent a name.',
    '      DISCOVERY: ' + MOVES.discovery.map(function (m) { return '"' + m + '"'; }).join(' · '),
    '      OBJECTIONS: ' + MOVES.objections.map(function (m) { return '"' + m + '"'; }).join(' · '),
    '      PITCH AND CLOSE: ' + MOVES.pitch_and_close.map(function (m) { return '"' + m + '"'; }).join(' · '),
    '  - cause.evidence: TWO OR THREE lines the CLOSER said in the minutes before the signal that show the move — each an object {timestamp_seconds, quote}, the quote copied under the HOW TO QUOTE rule above (a contiguous span of ONE closer line). Every line is checked against the transcript; if any one cannot be found, the whole cause is discarded. Fewer than two real closer lines means the move is "none".',
    '  - cause.summary: ONE sentence, the FRAMEWORK not the word track — what the closer was doing and what it produced ("built up the pain with hard questions about the family and the cost of staying put until the prospect admitted he needs to change"), never "you said \'so what are you gonna do\'". Under 40 words. Never name the prospect.',
    '  - cause.none_reason: only when move is "none": "arrived_pre_sold" when the prospect brought the intent with them (research done, notes taken, already decided — the closer did not earn it), otherwise "no_closer_work". Saying "none" is a real finding, not a failure.',
  ].join('\n');
}

/** The disclosure-tier block — the extractor sends it after the cause block; the backward cause pass does not (it asks one question). */
function disclosurePromptBlock() {
  return [
    'FOR EVERY PROSPECT-SPOKEN MOMENT (buying_signal, risk_signal, barrier, rapport_moment, disqualify_signal), also include disclosure_handling — WHAT THE CLOSER DID WITH WHAT HE WAS HANDED:',
    '  - disclosure_handling.tier: exactly one of "let_it_slide" (acknowledged and moved on — "oh nice"), "dug_deeper" (asked into it — "a year? what took you so long to book a call?"), "banked_and_used" (brought it back later in the call, usually at the close — "you told me earlier you\'ve been watching for a year; now you want to think about it").',
    '  - disclosure_handling.response: for "dug_deeper", the closer\'s question that dug — {timestamp_seconds, quote}, verbatim from ONE closer line.',
    '  - disclosure_handling.callback: for "banked_and_used", the closer\'s LATER line that used the disclosure — {timestamp_seconds, quote}, verbatim from ONE closer line, AFTER this moment. Without a real later line the tier is not "banked_and_used".',
    '  - Both quoted lines are checked against the transcript like every other quote; a line that cannot be found discards the tier.',
  ].join('\n');
}

module.exports = {
  MOVES: MOVES, ALL_MOVES: ALL_MOVES, NONE: NONE, NONE_REASONS: NONE_REASONS, TIERS: TIERS,
  WINDOW_SECONDS: WINDOW_SECONDS, WIDENED_WINDOW_SECONDS: WIDENED_WINDOW_SECONDS,
  MIN_EVIDENCE: MIN_EVIDENCE, MAX_EVIDENCE: MAX_EVIDENCE, CAUSE_TEXT_MAX_CHARS: CAUSE_TEXT_MAX_CHARS,
  isMove: isMove, sanitizeCause: sanitizeCause, sanitizeDisclosure: sanitizeDisclosure,
  verifyCause: verifyCause, verifyDisclosure: verifyDisclosure,
  causeContentText: causeContentText, windowTurns: windowTurns, causePromptBlock: causePromptBlock, disclosurePromptBlock: disclosurePromptBlock,
};
