// lib/selling-budget.js — how the grader's selling-context character budget is
// divided between competing sources.
//
// ── The bug this replaces (measured on live data, 2026-08-10) ─────────────
// The old selection was a single pool filled breadth-first across sources, with
// `break outer` the moment a chunk didn't fit. Simulating Josh's real upload:
// the offer document's first chunk took 3,348 of the 5,000 budget, the script's
// first chunk needed ~3,000 and could not fit the remaining 1,652 — so ALL
// 14,721 characters of his script were dropped, silently. Uploading a script
// would have appeared to do nothing at all.
//
// ── The fix: lanes with reserves, then redistribution ─────────────────────
// Each source is a LANE with a priority and a reserved minimum.
//   Phase 1 — in priority order, each lane takes whole chunks up to its reserve.
//             A lane with no content simply takes nothing, which frees its
//             reserve for everyone else.
//   Phase 2 — the remainder is handed out round-robin to lanes that still have
//             content, so nothing is wasted and long sources absorb the slack.
//
// Whole chunks only, ever. A partial chunk is a truncated sentence presented to
// the grader as if it were complete.
//
// ── Why the priority order is what it is ──────────────────────────────────
//   1 qualifications — tiny (Josh's is 69 chars) and the single highest-value
//     item in the system: the explicit, human-authored bar a prospect must
//     clear. It must NEVER be crowded out by prose.
//   2 offer          — short and dense; what is being sold and to whom.
//   3 script         — long; the closer's intended questions. Valuable but
//     inherently partial, so it takes a guaranteed slice and absorbs slack.
//   4 kb uploads     — offer docs/scripts uploaded to the knowledge base. Same
//     kind of material, but the profile fields are the authored source.
//
// Pure and total. No I/O, never throws.

// Roughly 180 words. Deliberately smaller than the KB's 500-word chunks: a lane
// reserve of ~1,500 chars cannot accept a 3,000-char chunk, which is exactly how
// the script got dropped. Finer granularity lets an allocation actually be used.
var CONTEXT_CHUNK_WORDS = 180;

// A profile field is only usable if it looks like content rather than a stray
// value. The demo accounts store offer = "Ava" / "Ben" / "Cara" — names left by
// seeding — and those must never be presented to the grader as an offer.
var MIN_PROFILE_FIELD_CHARS = 15;

function usableProfileField(v, minLen) {
  if (typeof v !== 'string') return false;
  var s = v.trim();
  if (s.length < (typeof minLen === 'number' ? minLen : MIN_PROFILE_FIELD_CHARS)) return false;
  // A single token is a name or a placeholder, not a description.
  if (s.indexOf(' ') === -1) return false;
  return true;
}

// Split text into allocatable pieces on word boundaries.
function chunkForContext(text, wordsPerChunk) {
  var per = (typeof wordsPerChunk === 'number' && wordsPerChunk > 0) ? wordsPerChunk : CONTEXT_CHUNK_WORDS;
  if (typeof text !== 'string') return [];
  var words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  var out = [];
  for (var i = 0; i < words.length; i += per) {
    out.push(words.slice(i, i + per).join(' '));
  }
  return out;
}

// lanes: [{ key, priority, reserve, chunks: [string] }]
// returns { [key]: [chunk, …] } — whole chunks only, total length <= budget.
function allocate(lanes, budget) {
  var arr = Array.isArray(lanes) ? lanes.filter(function (l) { return l && l.key; }) : [];
  var out = {};
  arr.forEach(function (l) { out[l.key] = []; });
  var total = (typeof budget === 'number' && budget > 0) ? budget : 0;
  if (!arr.length || !total) return out;

  var ordered = arr.slice().sort(function (a, b) { return (a.priority || 99) - (b.priority || 99); });
  var next = {};          // per-lane cursor into its chunk list
  ordered.forEach(function (l) { next[l.key] = 0; });
  var used = 0;

  // ── Phase 1: reserves, in priority order ───────────────────────────────
  ordered.forEach(function (l) {
    var chunks = Array.isArray(l.chunks) ? l.chunks : [];
    var laneUsed = 0;
    var cap = (typeof l.reserve === 'number') ? l.reserve : 0;
    while (next[l.key] < chunks.length) {
      var c = chunks[next[l.key]];
      if (typeof c !== 'string') { next[l.key]++; continue; }
      var cost = c.length + (used > 0 ? 2 : 0);   // '\n\n' join
      if (laneUsed + c.length > cap) break;        // this lane's reserve is spent
      if (used + cost > total) break;              // global budget is spent
      out[l.key].push(c);
      laneUsed += c.length;
      used += cost;
      next[l.key]++;
    }
  });

  // ── Phase 2: redistribute the remainder, round-robin ───────────────────
  // Long lanes absorb the slack freed by short or empty ones.
  var progress = true;
  while (progress && used < total) {
    progress = false;
    for (var i = 0; i < ordered.length; i++) {
      var l2 = ordered[i];
      var ch = Array.isArray(l2.chunks) ? l2.chunks : [];
      if (next[l2.key] >= ch.length) continue;
      var c2 = ch[next[l2.key]];
      if (typeof c2 !== 'string') { next[l2.key]++; progress = true; continue; }
      var cost2 = c2.length + (used > 0 ? 2 : 0);
      if (used + cost2 > total) continue;          // skip; a later smaller chunk may still fit
      out[l2.key].push(c2);
      used += cost2;
      next[l2.key]++;
      progress = true;
    }
  }

  return out;
}

module.exports = {
  allocate: allocate,
  usableProfileField: usableProfileField,
  chunkForContext: chunkForContext,
  CONTEXT_CHUNK_WORDS: CONTEXT_CHUNK_WORDS,
  MIN_PROFILE_FIELD_CHARS: MIN_PROFILE_FIELD_CHARS,
};
