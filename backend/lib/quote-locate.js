/**
 * Quote locator — attribute an extracted quote to the speaker who actually
 * said it, or REFUSE.
 *
 * WHY THIS EXISTS, AND WHY IT IS SHAPED THIS WAY.
 *
 * The obvious implementation — "find a turn whose text relates to the quote" —
 * is wrong in a way that reviews as correct. The highlight extractor routinely
 * STITCHES a quote across consecutive turns and lightly trims filler, so an
 * exact single-turn match usually fails. A locator that also accepts "the
 * turn's whole text sits inside the quote" appears to fix that, and it is what
 * the first KB repair pass used. It produced wrong speakers on 5 of the 10
 * rows that could be independently re-derived, because for a long quote ANY
 * short turn anywhere in the call whose text happens to sit inside it matches,
 * and the first such turn in transcript order wins — frequently an unrelated
 * "yeah" by the other party.
 *
 * So the contract here is reconstruction, not resemblance:
 *   1. Anchor on the quote's OPENING words — those are unambiguously the
 *      attributee's, whoever else joins in later.
 *   2. Walk forward through CONSECUTIVE turns until the full quote is
 *      reconstructed. If it never reconstructs, refuse.
 *   3. If two DISTINCT speakers can each reconstruct it, refuse. (Live case:
 *      both the closer and the prospect say "I don't care if you're a
 *      multi-millionaire" on the same call — first-wins would decide that on
 *      a coin flip.)
 *
 * The anchor length is adaptive (8 words down to 4) because a quote that
 * begins mid-turn has no single turn holding its first 8 words — "…but my
 * dad's got cancer." + "I just found out." is a real CLOSER moment that a
 * fixed-length anchor refused. Shortening the anchor is safe ONLY because
 * every candidate must still reconstruct the whole quote; that requirement,
 * not the anchor, is what makes this sound.
 *
 * Governing principle: a WRONG attribution is worse than NO attribution. It
 * silently files the prospect's words as the closer's own winning material,
 * and nobody questions a label that reads plausibly.
 *
 * Pure. No DB, no fetch, never throws.
 */

function normalizeText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// How far past the quote's own length we may keep accumulating turns before
// giving up. Generous enough for interjections inside a stitched quote,
// bounded so a runaway walk can't swallow half a call.
var OVERRUN_CHARS = 300;
var MAX_ANCHOR_WORDS = 8;
var MIN_ANCHOR_WORDS = 4;
var MIN_ANCHOR_CHARS = 12;
var MIN_QUOTE_WORDS = 4;
var MIN_QUOTE_CHARS = 16;

/**
 * Find who spoke `quote`.
 *
 * @param {Array<{display_name?: string, speaker?: string, text?: string}>} turns
 * @param {string} quote
 * @returns {{ok: true, speakerName: string, mixed: boolean} |
 *           {ok: false, reason: 'quote_too_short'|'not_reconstructible'|'ambiguous'}}
 */
function locateQuoteSpeaker(turns, quote) {
  if (!Array.isArray(turns) || turns.length === 0) return { ok: false, reason: 'not_reconstructible' };

  var nq = normalizeText(quote);
  var words = nq.split(' ').filter(Boolean);
  if (words.length < MIN_QUOTE_WORDS || nq.length < MIN_QUOTE_CHARS) {
    return { ok: false, reason: 'quote_too_short' };
  }

  // Precompute once — the walk is O(anchors × turns) and normalizing inside
  // the inner loop would redo this work for every anchor length.
  var normTurns = new Array(turns.length);
  for (var n = 0; n < turns.length; n++) {
    normTurns[n] = normalizeText(turns[n] && turns[n].text);
  }

  for (var k = Math.min(MAX_ANCHOR_WORDS, words.length); k >= MIN_ANCHOR_WORDS; k--) {
    var head = words.slice(0, k).join(' ');
    if (head.length < MIN_ANCHOR_CHARS) break;

    var hits = [];
    for (var i = 0; i < turns.length; i++) {
      if (normTurns[i].indexOf(head) === -1) continue;

      var acc = normTurns[i];
      var j = i;
      var speakers = [speakerNameOf(turns[i])];
      while (acc.indexOf(nq) === -1 && j + 1 < turns.length && acc.length < nq.length + OVERRUN_CHARS) {
        j++;
        acc = acc + ' ' + normTurns[j];
        var nm = speakerNameOf(turns[j]);
        if (speakers.indexOf(nm) === -1) speakers.push(nm);
      }
      if (acc.indexOf(nq) !== -1) {
        hits.push({ name: speakerNameOf(turns[i]), mixed: speakers.length > 1 });
      }
    }
    if (hits.length === 0) continue;

    var distinct = [];
    for (var d = 0; d < hits.length; d++) {
      if (distinct.indexOf(hits[d].name) === -1) distinct.push(hits[d].name);
    }
    // Two different people could have produced this quote — refuse rather than
    // pick one. Guessing here is exactly how a prospect's words become the
    // closer's "winning material".
    if (distinct.length > 1) return { ok: false, reason: 'ambiguous' };

    return { ok: true, speakerName: hits[0].name, mixed: hits[0].mixed };
  }

  return { ok: false, reason: 'not_reconstructible' };
}

function speakerNameOf(turn) {
  if (!turn || typeof turn !== 'object') return '';
  if (typeof turn.display_name === 'string' && turn.display_name) return turn.display_name;
  if (typeof turn.speaker === 'string' && turn.speaker) return turn.speaker;
  return '';
}

/**
 * Resolve a quote to a CLOSER/PROSPECT label against ALREADY-LABELLED turns
 * (i.e. turns from a `speaker_confidence='matched'` normalize, where every
 * turn.speaker is already CLOSER or PROSPECT).
 *
 * Returns null when the quote cannot be attributed — callers must treat null
 * as "unverified", never as a default role.
 *
 * @param {Array} turns normalized turns carrying speaker='CLOSER'|'PROSPECT'
 * @param {string} quote
 * @returns {'CLOSER'|'PROSPECT'|null}
 */
function labelForQuote(turns, quote) {
  var r = locateQuoteSpeaker(turns, quote);
  if (!r.ok) return null;
  // On matched turns, display_name is the diarized name while `speaker` is the
  // role — look the role up from the turn we anchored on.
  for (var i = 0; i < turns.length; i++) {
    if (speakerNameOf(turns[i]) === r.speakerName) {
      var role = turns[i] && turns[i].speaker;
      return (role === 'CLOSER' || role === 'PROSPECT') ? role : null;
    }
  }
  return null;
}

module.exports = {
  locateQuoteSpeaker: locateQuoteSpeaker,
  labelForQuote: labelForQuote,
  _normalizeText: normalizeText,
};
