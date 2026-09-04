/**
 * The missed-signal pair (H720) — Justin's own coachable example, computed on
 * stored rows, no model call.
 *
 *   "When she said she was living paycheck to paycheck you rolled over it, and
 *    later after the pitch you realised she was a financial DQ. When red flags
 *    like that pop up you gotta explore it and find out if it's a pain point or
 *    a DQ."
 *
 * The pair is TWO POINTS ON A CALL AND THE GAP BETWEEN THEM: an early
 * `risk_signal` or `barrier` the closer IGNORED or DEFLECTED, and a LATER
 * `disqualify_signal` on the same call. It is the same move as tying back in,
 * inverted — there a disclosure used well at the close, here a disclosure
 * missed and paid for. One vocabulary, two outcomes.
 *
 * WHAT "IGNORED OR DEFLECTED" IS DERIVED FROM. The extractor's v8a `handling`
 * field, written at analysis time on risk_signal/barrier rows only — a model
 * judgement with a stated test: did the closer engage with the SUBSTANCE of
 * what the prospect raised, or acknowledge it and move on? Warmth, length and
 * sympathy are not engagement. NULL (pre-v8a) is NOT "ignored": absence is not a
 * verdict, and a row with no handling never pairs.
 *
 * THE FLOOR. A signal seconds before the DQ is the DQ surfacing, not a miss —
 * the closer had no room to explore it. MIN_GAP_SECONDS is five minutes, set
 * from the live pairs read by hand (H720): every drawn pair under three minutes
 * was the DQ surfacing across consecutive answers or the closer acting on it
 * within the same exchange; every pair over nine minutes stood. Unfloored, the
 * median gap was 380 s and 47 of 103 pairs sat under five minutes. Pairs at or above the floor stand; below it they are dropped, and
 * the count dropped is reported by the caller, never hidden.
 *
 * Pure. Carries the stored fields of both ends and the gap; composes no
 * coaching text (that is a lane's job, and none reads this yet — H720 reports
 * the shape before anything is wired).
 */
'use strict';

var MIN_GAP_SECONDS = 300;   // five minutes — see H720 for the measured distribution
var MISS_HANDLING = ['ignored', 'deflected'];
var SIGNAL_TYPES = ['risk_signal', 'barrier'];

function pickSignal(h) {
  return {
    id: h.id, type: h.type, handling: h.handling, section: h.section || null,
    timestamp_seconds: h.timestamp_seconds, quote: h.quote, observation: h.observation || null,
    closer_response: (typeof h.closer_response === 'string') ? h.closer_response : null,
    closer_response_verified: (typeof h.closer_response_verified === 'boolean') ? h.closer_response_verified : null,
  };
}
function pickDq(h) {
  return { id: h.id, section: h.section || null, timestamp_seconds: h.timestamp_seconds, quote: h.quote, observation: h.observation || null };
}

/**
 * @param {Array} rows — one call's call_highlights rows (any order)
 * @param {{minGapSeconds?: number}} [opts]
 * @returns {Array<{signal, dq, gap_seconds}>} in DQ order, each signal paired at most once
 */
function findMissedSignalPairs(rows, opts) {
  var minGap = (opts && typeof opts.minGapSeconds === 'number') ? opts.minGapSeconds : MIN_GAP_SECONDS;
  var arr = (Array.isArray(rows) ? rows : []).filter(function (h) { return h && typeof h.timestamp_seconds === 'number'; });
  var signals = arr.filter(function (h) {
    return SIGNAL_TYPES.indexOf(h.type) !== -1 && MISS_HANDLING.indexOf(h.handling) !== -1 && h.speaker !== 'CLOSER';
  }).sort(function (a, b) { return a.timestamp_seconds - b.timestamp_seconds; });
  /* A DQ the CLOSER speaks ("our conversation's a little premature") is the closer
     ACTING on the flag — the behaviour Justin is coaching towards — so it is never the
     paid-for end of a miss. Read by hand (H720): two of ten drawn pairs were exactly this. */
  var dqs = arr.filter(function (h) { return h.type === 'disqualify_signal' && h.speaker !== 'CLOSER'; })
    .sort(function (a, b) { return a.timestamp_seconds - b.timestamp_seconds; });
  var used = {}; var out = [];
  dqs.forEach(function (dq) {
    signals.forEach(function (s) {
      if (used[s.id]) return;
      var gap = dq.timestamp_seconds - s.timestamp_seconds;
      if (gap < minGap) return;
      used[s.id] = true;
      out.push({ signal: pickSignal(s), dq: pickDq(dq), gap_seconds: gap });
    });
  });
  return out;
}

function gapLabel(sec) {
  var s = Math.max(0, Math.floor(sec || 0));
  var m = Math.floor(s / 60), r = s % 60;
  if (m >= 10 || r === 0) return m + ' min';
  return m + ' min ' + r + ' s';
}

module.exports = { findMissedSignalPairs: findMissedSignalPairs, gapLabel: gapLabel, MIN_GAP_SECONDS: MIN_GAP_SECONDS, MISS_HANDLING: MISS_HANDLING, SIGNAL_TYPES: SIGNAL_TYPES };
