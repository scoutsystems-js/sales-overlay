/**
 * ITEM (j) — WHEN DID THE CLOSER DROP THE PRICE?
 *
 * Pure, deterministic, NO MODEL CALL. Given a call's normalized turns and the
 * seller's own stored price, returns the first moment the closer stated that
 * price as the total for the offer — or null.
 *
 * ⚠⚠ THIS IS A LOOKUP, NOT A DETECTOR, AND THAT DISTINCTION IS THE WHOLE DESIGN.
 * A previous attempt tried to RECOGNISE a price from patterns ($n,nnn, "the
 * price is", …) and failed completely: measured across 170 real calls the
 * earliest money-shaped closer line landed at a MEDIAN OF 3.8 MINUTES, and four
 * reasonable detectors disagreed with each other by a median of 11 minutes.
 * Read by hand, the early matches are market rates per bed, grants a third party
 * received, students' monthly revenue, and what it cost the SELLER to produce a
 * document. Every one of them is money-shaped; none is the price.
 *
 * The property that separates them is SEMANTIC, not lexical:
 *     a decoy is a number about someone or something ELSE
 *     the price is what THIS prospect pays THIS seller for THIS offer
 * "$30,000 document" and "$9,800 for the whole thing" occur in the SAME SENTENCE
 * on real calls. No regex can tell them apart. Knowing the seller's own price
 * collapses the semantic question into an identity check, which is why this
 * works and why nothing pattern-based ever could.
 *
 * ⚠ NEVER `price_2pay`. The plan figure (Josh's is 400) shows up constantly as
 * "a couple hundred bucks", "$300 to $500 a month", "about $400 max" — it is a
 * decoy generator. ONLY the pay-in-full total identifies the drop.
 */

/**
 * ⚠⚠ THE FREQUENCY HYPOTHESIS WAS TESTED AND DOES NOT HOLD — recorded because
 * the idea is a natural one and someone will have it again.
 *
 * The proposal was: a distinctive price appears once or twice, a ROUND price
 * appears repeatedly because round numbers are what people use for examples, so
 * count occurrences and refuse above a threshold. Measured over 139-140 real
 * calls, occurrences per call when present:
 *
 *      9800  (the real price)   mean 1.93   max 7
 *      5000  (round decoy)      mean 1.78   max 5
 *     10000  (round decoy)      mean 1.66   max 6
 *     30000  (the doc, decoy)   mean 2.60   max 6
 *
 * The real price occurs MORE often than the round decoys and LESS often than the
 * document. The distributions overlap almost entirely. **No threshold separates
 * them, and any number chosen would have looked principled and done nothing.**
 *
 * First-occurrence TIMING separates better but still overlaps (real median 31.5
 * min vs decoys 18-22; decoy p90 reaches 32-40).
 *
 * ⚠ WHAT ACTUALLY SEPARATES THEM IS TOTAL-FRAMING LANGUAGE, and it is close to
 * clean. Share of first closer occurrences whose turn also states a TOTAL:
 *
 *      9800  (the real price)   118/139 = 85%
 *     10000  (round decoy)        1/97  =  1%
 *      5000  (round decoy)        0/107 =  0%
 *     30000  (the doc, decoy)     0/140 =  0%
 *
 * So the round-price collision is handled by the SAME mechanism as everything
 * else rather than by a special rule: a round decoy is almost never framed as
 * the total for the offer, so requiring the framing makes the collision
 * self-limiting. That is a property of how people speak, not a tuned constant.
 */
const PRICE_FRAME_RE = new RegExp(
  '(' + [
    'for (the )?(whole|everything|entire)',
    'the total', 'total price',
    'one[- ]time',
    'all (of )?the services',
    'pay (at )?one time',
    'the regular price',
    'the (one[- ]time )?investment',
  ].join('|') + ')', 'i');

/**
 * How far ahead to look for the framing when the number lands in its own short
 * turn. On a real call the closer said "And it was $9,800." and then "So one
 * time ever, 9,800." — two turns 0.4 SECONDS apart.
 *
 * ⚠⚠ BOUNDED IN BOTH TURNS **AND** TIME, and the time bound is not belt-and-
 * braces — a turn bound alone is wrong. A unit test caught it: with the decoy
 * "$5,000 in their bank account" at 11:40 and the genuine "$5,000 for
 * everything, one time" at 35:00, "the next closer turn" reached forward
 * TWENTY-THREE MINUTES and certified the decoy. Nothing errors; the metric just
 * reports a price drop at 11 minutes that never happened.
 * Adjacency in a transcript is a property of TIME, not of array position — the
 * next element can be an hour later.
 */
const FRAME_LOOKAHEAD_TURNS = 1;
const FRAME_LOOKAHEAD_SECONDS = 30;

/**
 * ⚠ EXPECTED NULL RATE — RECORD THIS SO GAPS ARE NOT READ AS BREAKAGE.
 * Roughly **1 in 5 closed calls has no price moment at all**, and that is
 * correct rather than a miss. Hand-read example: a closed call whose own grader
 * notes say "No pitch occurred. The program was referenced only in logistical
 * terms" — a second conversation on a deal already agreed. It contains zero
 * occurrences of the price, from either speaker.
 * A chart over this field MUST exclude nulls and say how many it excluded.
 *
 * ⚠⚠ A TIME FLOOR WAS PROPOSED AND DECLINED (ruling 2026-08-18) — the reasoning
 * matters more than the verdict, because the idea will come back:
 *   - Rule A does the work. The residual is ONE bad call in 124, which cannot
 *     move a 32.4-minute median.
 *   - A threshold that removes exactly one call does not earn its maintenance.
 *   - EARLY IS NOT WRONG. A hand-verified genuine drop sits at 11.0 minutes, on
 *     a call where the prospect pushed for price early and the closer gave the
 *     whole value case first. A floor set anywhere useful would have discarded
 *     it, and the next customer may legitimately price early too.
 *
 * ⚠ THE KNOWN RESIDUAL, RECORDED RATHER THAN PAPERED OVER: exactly one
 * continuation call survives Rule A — the prospect asks for the total "again"
 * without naming the figure, so nothing in the transcript marks the price as
 * already known, and the closer restates it at 1.3 minutes. We know it is there
 * and we know it is one.
 */
const EXPECTED_NULL_SHARE_CLOSED = 0.2;

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * The spoken/written forms of a price, as ONE regex.
 * 9800 → /(?<![\d.])\$?9[ ,]?800(?![\d])/
 *
 * ⚠ The lookarounds are load-bearing: without them 9800 matches inside 19800 and
 * 98000, which are different numbers and appear on real calls.
 * ⚠ STATED LIMIT: written-out forms ("nine thousand eight hundred", "ninety-eight
 * hundred") are NOT matched. They did not occur in the hand-read sample, and
 * refusing them yields a null — the safe direction — rather than a wrong minute.
 */
function priceRegex(price) {
  var n = Number(price);
  if (!isFinite(n) || n <= 0) return null;
  var digits = String(Math.round(n));
  var parts = [], s = digits;
  while (s.length > 3) { parts.unshift(s.slice(-3)); s = s.slice(0, -3); }
  parts.unshift(s);
  var body = parts.map(escapeRe).join('[ ,]?');
  return new RegExp('(?<![\\d.])\\$?' + body + '(?![\\d])');
}

function isCloser(turn) {
  return !!turn && String(turn.speaker || '').toUpperCase() === 'CLOSER';
}
function textOf(turn) { return (turn && typeof turn.text === 'string') ? turn.text : ''; }
function secondsOf(turn) {
  var v = turn && turn.start_seconds;
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

/**
 * The price-drop moment, or null.
 *
 * ⚠ FIRST CLOSER OCCURRENCE, and every part of that phrase earns its place:
 *   - CLOSER, because the price is stated BY the seller. Prospects echo it
 *     later ("so 9,800", "it's saying pay total $9,800") and never first.
 *   - FIRST, because the price recurs: financing follow-ups ("your payments on
 *     $9,800 is like $100 a month") and possession claims ("you paid $9,800 for
 *     this") all come after. Measured: 12 occurrences across 5 calls.
 *   - and it must be FRAMED AS THE TOTAL — see the frequency note above.
 */
function findPriceMoment(turns, price) {
  var list = Array.isArray(turns) ? turns : [];
  var re = priceRegex(price);
  if (!re || !list.length) return null;

  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!isCloser(t)) continue;
    var txt = textOf(t);
    if (!re.test(txt)) continue;

    // Framing in this turn, or in the next closer turn (the number sometimes
    // lands in a four-word turn of its own).
    var secs = secondsOf(t);
    if (secs === null) continue;   // no timestamp → nothing to plot

    var framed = PRICE_FRAME_RE.test(txt);
    if (!framed) {
      var looked = 0;
      for (var j = i + 1; j < list.length && looked < FRAME_LOOKAHEAD_TURNS; j++) {
        if (!isCloser(list[j])) continue;
        var ns = secondsOf(list[j]);
        // ⚠ TIME bound as well as turn bound — see the note on the constants.
        if (ns === null || ns - secs > FRAME_LOOKAHEAD_SECONDS) break;
        looked++;
        if (PRICE_FRAME_RE.test(textOf(list[j]))) { framed = true; break; }
      }
    }
    if (!framed) continue;

    /**
     * ⚠⚠ RULE A — PROSPECT-FIRST EXCLUSION (ruled 2026-08-18). If the PROSPECT
     * stated the figure before the closer did, the closer is ANSWERING A
     * QUESTION, not dropping a price. That is a continuation call — the price
     * was already on the table.
     *
     * Hand-verified failures this removes, verbatim from real transcripts:
     *   PROSPECT "What is the total amount that way I know what I'm working
     *             It was the $9,800."      -> CLOSER 6s later: "The $9,800."
     *   PROSPECT "I think it's $9,800 or $10,000, I think you guys charge?"
     *             -> CLOSER 6s later: "It's $9,800 for all our services..."
     *
     * ⚠ IT IS A PROPERTY, NOT A THRESHOLD — nothing to tune, nothing to
     * maintain. The detector was never matching a decoy on these calls; it
     * correctly found the closer saying the price and could not see that the
     * price was already known.
     */
    var priorProspect = false;
    for (var k = 0; k < i; k++) {
      var pt = list[k];
      if (!pt || String(pt.speaker || '').toUpperCase() !== 'PROSPECT') continue;
      var ps = secondsOf(pt);
      if (ps === null || ps >= secs) continue;
      if (re.test(textOf(pt))) { priorProspect = true; break; }
    }
    if (priorProspect) return null;   // continuation call — no drop happened here

    return { seconds: Math.round(secs), quote: txt.trim().slice(0, 400), turn_index: i };
  }
  return null;
}

/* ⚠⚠⚠ THE PRICELESS FINDER — Justin's ruling, twice: "we are supposed to use
   logic to find these times without needing the actual dollar amount."

   THE PROBLEM WITH REQUIRING A STORED PRICE: findPriceMoment only runs when the
   rep has saved price_pif, and only 2 of 13 users ever did — both the same
   person. Every other rep showed ZERO price moments across 750+ graded calls,
   so the graph drew one line. And an offer usually has SEVERAL packages, so
   matching one stored number is brittle by construction.

   ⚠⚠ WHAT MAKES THIS WORK IS THAT THE DISCRIMINATOR WAS NEVER THE NUMBER. It is
   PRICE_FRAME_RE — total-framing language — measured in the header above at 85%
   of real-price first mentions against 0-1% of round decoys. The stored price
   only collapsed a semantic question into an identity check; the framing is
   what separates "the price" from "a number about something else".

   ⚠ SO THIS INVERTS THE ORDER AND CHANGES NOTHING ELSE: find the FRAMING first,
   then take the money in that turn as the candidate, then run the SAME Rule A
   prospect-first exclusion on it. Rule A is not weakened — it is applied to the
   number actually found instead of to a number supplied in advance.

   ⚠ Measured against the stored lookup as ground truth over 60 calls: same
   moment 58 times, within 60s once, different once, never missed. */

/* ⚠ BOUNDED, AND THE BOUNDS ARE THE ONLY TUNED THING HERE. Below MIN a figure is
   a monthly instalment or a fee rather than a total for the offer; above MAX it
   is a portfolio, a property or a revenue figure. Both were read from real
   transcripts, not chosen for roundness. A number outside them yields null —
   the safe direction — rather than a wrong minute. */
const CANDIDATE_MIN = 900;
const CANDIDATE_MAX = 200000;

/* ⚠ ONE turn-level exclusion, not two. "$500 a month ... average for the total"
   carries total-framing and is an INSTALMENT, not a price.

   ⚠⚠ A DISCOUNT EXCLUSION WAS TRIED AND REMOVED — MEASURED, AND IT WAS COSTING
   FOUR REAL PRICES TO CATCH ONE DECOY. Closers state the FULL price precisely
   when they mention a discount ("the total price was $9,800 before the
   discount", "we are doing a discount, the price was $9,800 for the life"), so
   a turn-level /\b(off|discount|save)\b/ killed the very moment it should
   find — and it also matched "tax write-OFF". That is the module's own rule
   from the header: an exclusion that removes one call does not earn its keep.
   The discount case is handled by taking the LARGEST candidate instead, since
   a discount is always smaller than the price it reduces. */
const PER_PERIOD_RE = /(?<!\bnot\s)(?<!\bnot\s\w{1,12}\s)\b(a|per|each|every)\s+(month|week|year|mo\b)/i;

function moneyCandidates(text) {
  var out = [];
  var re = /\$\s?([0-9][0-9,]{2,}(?:\.\d+)?)|\b([0-9]{1,3},[0-9]{3})\b|\b([0-9]{4,6})\b/g;
  var m;
  while ((m = re.exec(text))) {
    var v = Number(String(m[1] || m[2] || m[3]).replace(/,/g, ''));
    if (isFinite(v) && v >= CANDIDATE_MIN && v <= CANDIDATE_MAX && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}

/**
 * The price-drop moment WITHOUT a stored price, or null.
 * Same contract as findPriceMoment: { seconds, quote, turn_index } (+ price).
 */
function findPriceMomentByFraming(turns) {
  var list = Array.isArray(turns) ? turns : [];
  if (!list.length) return null;

  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!isCloser(t)) continue;
    var txt = textOf(t);
    var secs = secondsOf(t);
    if (secs === null) continue;                       // no timestamp → nothing to plot
    if (PER_PERIOD_RE.test(txt)) continue;

    var cands = moneyCandidates(txt);
    if (!cands.length) continue;

    // framing here, or in the next closer turn — the SAME bounded lookahead
    var framed = PRICE_FRAME_RE.test(txt);
    if (!framed) {
      var looked = 0;
      for (var j = i + 1; j < list.length && looked < FRAME_LOOKAHEAD_TURNS; j++) {
        if (!isCloser(list[j])) continue;
        var ns = secondsOf(list[j]);
        if (ns === null || ns - secs > FRAME_LOOKAHEAD_SECONDS) break;
        looked++;
        if (PRICE_FRAME_RE.test(textOf(list[j]))) { framed = true; break; }
      }
    }
    if (!framed) continue;

    /* ⚠⚠ RULE A, UNCHANGED, applied to the candidate we just found. If the
       PROSPECT said this figure first, the closer is ANSWERING rather than
       dropping a price — a continuation call. Losing this would re-admit the
       exact moments the rule was written to exclude ("The $9,800." six seconds
       after the prospect asked for the total). */
    var kept = cands.filter(function (v) {
      var re = priceRegex(v);
      if (!re) return false;
      for (var k = 0; k < i; k++) {
        var pt = list[k];
        if (!pt || String(pt.speaker || '').toUpperCase() !== 'PROSPECT') continue;
        var ps = secondsOf(pt);
        if (ps === null || ps >= secs) continue;
        if (re.test(textOf(pt))) return false;
      }
      return true;
    });
    if (!kept.length) continue;   // this figure was already on the table — keep looking

    /* ⚠ THE LARGEST SURVIVING CANDIDATE, NOT THE FIRST. On "$9,800 for
       everything, but we're doing a discount right now for $1,000 off" both
       numbers are in one turn — and a discount, a deposit or an instalment is
       always SMALLER than the total it relates to. This is a property of what
       the numbers mean, not a tuned preference. */
    var price = kept.reduce(function (a, b) { return b > a ? b : a; }, kept[0]);
    return { seconds: Math.round(secs), quote: txt.trim().slice(0, 400), turn_index: i, price: price };
  }
  return null;
}

module.exports = {
  PRICE_FRAME_RE: PRICE_FRAME_RE,
  findPriceMomentByFraming: findPriceMomentByFraming,
  moneyCandidates: moneyCandidates,
  CANDIDATE_MIN: CANDIDATE_MIN,
  CANDIDATE_MAX: CANDIDATE_MAX,
  FRAME_LOOKAHEAD_TURNS: FRAME_LOOKAHEAD_TURNS,
  FRAME_LOOKAHEAD_SECONDS: FRAME_LOOKAHEAD_SECONDS,
  EXPECTED_NULL_SHARE_CLOSED: EXPECTED_NULL_SHARE_CLOSED,
  priceRegex: priceRegex,
  findPriceMoment: findPriceMoment,
};
