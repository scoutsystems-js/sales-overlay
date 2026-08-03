// lib/prospect-name.js — resolving WHO the prospect on a call actually is.
// PROSPECT NAMES, sub-stage 3a.
//
// ── GOVERNING PRINCIPLE (Justin's ruling, 2026-08-03) ─────────────────────
// A WRONG name is worse than NO name. A wrong name silently fabricates a
// prospect identity that later merges and miscounts, invisibly — and nobody
// questions a name that reads plausibly. Device names, phone numbers, hotspot
// names and meeting labels resolve to NULL → "Unknown prospect" at render.
// WHEN IN DOUBT, REFUSE. Every rejection rule below exists because returning
// something readable would be actively harmful.
//
// ── Why three sources, none authoritative ─────────────────────────────────
// Measured on 83 live analyzed calls:
//   • meeting TITLE — the BOOKED name. Wrong person on ~34% of the calls whose
//     prose reliably names the prospect (title "Tasha Presberry" ↔ attendee
//     "Jamie Ellis"), and 13 titles are bare meeting labels — 11 of which all
//     collapsed to the single fake prospect "Impromptu Zoom Meeting".
//   • diarized display_name — who DIALLED IN. Best available signal, but 8 of 83
//     were devices, 1 a phone number, 11 lowercase, 15 calls had 3+ speakers.
//   • grader prose — who ACTUALLY SPOKE. Most accurate, but nickname-prone and
//     sometimes absent ("Spoke with a prospect out of Wilmington"). Not yet a
//     field — that arrives in 3b, and this resolver already prefers it.
// Hence precedence + a recorded source, never "pick one winner".
//
// Pure and total. No I/O, never throws.

// ── Rejection vocabulary ──────────────────────────────────────────────────
// Device / client / room identifiers. Matched as substrings because the live
// data contains compounds ("BophanoHotspot", "OnePlus CPH2551", "Margaret's iPhone").
var DEVICE_PATTERNS = [
  'iphone', 'ipad', 'ipod', 'macbook', 'imac', 'android', 'galaxy', 'pixel',
  'oneplus', 'huawei', 'xiaomi', 'redmi', 'samsung', 'hotspot', 'laptop',
  'desktop', 'tablet', 'chromebook', 'conference room', 'meeting room',
  'room 1', 'room 2', 's phone', 'phone)', 'webcam',
];

// Meeting labels. These are the values that must NEVER become a prospect.
var LABEL_PATTERNS = [
  'zoom meeting', 'impromptu', 'google meet', 'teams meeting', 'meet meeting',
  'webinar', 'huddle', 'standup', 'stand-up', 'all hands', 'all-hands',
  'discovery call', 'sales call', 'strategy call', 'onboarding call',
  'training', 'interview', 'demo call',
];

// Whole-string labels — rejected only when they ARE the entire name, so a real
// person called e.g. "Mia Sync" is not caught by a substring rule.
var EXACT_LABELS = [
  'meeting', 'new meeting', 'my meeting', 'call', 'sync', 'weekly sync',
  'daily sync', 'check in', 'check-in', 'catch up', 'catch-up', 'session',
];

var PLACEHOLDERS = [
  'x', 'xx', 'xxx', 'tbd', 'tba', 'n/a', 'na', 'none', 'null', 'unknown',
  'test', 'testing', 'guest', 'user', 'anonymous', 'anon', 'prospect',
  'client', 'customer', 'attendee', 'participant', '?', '-', '--', '...', '.',
];

// Generic client-supplied participant labels. Found live as "Zoom user" (415
// turns on a real call) — it reads like a name at a glance, which is exactly the
// silent-wrong-name failure mode, so it is matched as a substring.
var GENERIC_PARTICIPANT_PATTERNS = [
  'zoom user', 'teams user', 'meet user', 'unknown user', 'guest user',
  'unnamed', 'participant ', 'caller ',
];

function norm(v) {
  return (typeof v === 'string') ? v.replace(/[‘’]/g, "'").trim() : '';
}

// Should this string be refused as a prospect name? Fail-closed: anything we
// are not confident is a person's name is rejected.
function isRejectedName(v) {
  var s = norm(v);
  if (!s) return true;

  var lower = s.toLowerCase();

  // Digits-only / phone-shaped (allow + ( ) - . and spaces around digits).
  if (/^[\d\s+().-]+$/.test(s)) return true;
  // Any run of 7+ digits is a phone/dial-in id regardless of surrounding text.
  if (/\d{7,}/.test(s.replace(/[\s+().-]/g, ''))) return true;

  if (PLACEHOLDERS.indexOf(lower) !== -1) return true;
  if (EXACT_LABELS.indexOf(lower) !== -1) return true;

  var i;
  for (i = 0; i < DEVICE_PATTERNS.length; i++) {
    if (lower.indexOf(DEVICE_PATTERNS[i]) !== -1) return true;
  }
  for (i = 0; i < LABEL_PATTERNS.length; i++) {
    if (lower.indexOf(LABEL_PATTERNS[i]) !== -1) return true;
  }
  for (i = 0; i < GENERIC_PARTICIPANT_PATTERNS.length; i++) {
    if (lower.indexOf(GENERIC_PARTICIPANT_PATTERNS[i]) !== -1) return true;
  }

  // Emails / URLs are identifiers, not display names.
  if (lower.indexOf('@') !== -1) return true;
  if (/^(https?:\/\/|www\.)/.test(lower)) return true;

  // Must contain at least one letter — "..." or "42" are not names.
  if (!/[a-zÀ-ɏ]/i.test(s)) return true;

  // Absurdly long strings are sentences or labels, not names.
  if (s.length > 80) return true;

  return false;
}

// A diarized display_name → a usable name, or null. Trims and normalises
// punctuation ONLY. Deliberately does NOT title-case: "isaac" and "bopha" are
// how those people appear, and re-casing invents a presentation we can't verify.
function cleanDiarizedName(v) {
  var s = norm(v).replace(/\s+/g, ' ');
  if (isRejectedName(s)) return null;
  return s;
}

// The meeting title → a candidate name, or null.
// Takes the last pipe-delimited segment (the established convention:
// "PS Sober Living Riches | Amanda Law"). An unpiped title is only accepted if
// it survives the rejection rules — which is what stops "Impromptu Zoom Meeting"
// becoming a prospect, the bug that opened this stage.
function nameFromTitle(title) {
  var s = norm(title);
  if (!s) return null;
  var parts = s.split('|').map(function (p) { return p.trim(); }).filter(Boolean);
  var candidate = parts.length ? parts[parts.length - 1] : '';
  if (isRejectedName(candidate)) return null;
  return candidate.replace(/\s+/g, ' ');
}

// Loose identity comparison for excluding the closer. Case-insensitive, and a
// containment match in either direction counts (mirrors the normalizer's
// recorded_by matching: "Josh" ↔ "Joshua Pinner").
function sameIdentity(a, b) {
  // Strip punctuation before comparing: diarization abbreviates ("Carolyn T."
  // for "Carolyn Tolbert"), and a trailing period was defeating containment.
  var strip = function (s) { return norm(s).toLowerCase().replace(/[.,'’-]/g, '').replace(/\s+/g, ' ').trim(); };
  var x = strip(a), y = strip(b);
  if (!x || !y) return false;
  if (x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return true;

  // Initial + surname agreement: "L. Williams" ↔ "Lisa Williams". Containment
  // misses this (neither string contains the other), and without it the
  // abbreviated diarized form WINS over the fuller title — losing the given
  // name that 3d's grouping needs. Requires the surname to match exactly AND
  // one first name to be an initial/prefix of the other, so "J. Smith" can
  // still never merge with "Jane Smith" AND "John Smith" simultaneously
  // without a human seeing it (that ambiguity is 3d's merge review, not ours).
  var xs = x.split(' '), ys = y.split(' ');
  if (xs.length >= 2 && ys.length >= 2) {
    var xSur = xs[xs.length - 1], ySur = ys[ys.length - 1];
    if (xSur === ySur) {
      var xf = xs[0], yf = ys[0];
      if (xf === yf) return true;
      if (xf.length === 1 && yf.indexOf(xf) === 0) return true;
      if (yf.length === 1 && xf.indexOf(yf) === 0) return true;
    }
  }
  return false;
}

// Tally distinct speakers by turn count, preserving first-appearance order.
function speakerTally(turns) {
  var order = [], counts = {};
  if (!Array.isArray(turns)) return [];
  for (var i = 0; i < turns.length; i++) {
    var t = turns[i];
    if (!t || typeof t !== 'object') continue;
    var dn = norm(t.display_name || t.speaker);
    if (!dn) continue;
    if (counts[dn] === undefined) { counts[dn] = 0; order.push(dn); }
    counts[dn] += 1;
  }
  return order.map(function (n) { return { name: n, turns: counts[n] }; });
}

// Resolve the prospect for one call.
//
// input: { graderName, turns, closerName, closerCandidates, title }
// returns { name: string|null, source: 'grader'|'diarized'|'title'|null,
//           confidence: 'high'|'low' }
function resolveProspectName(input) {
  var opts = input || {};
  var REFUSED = { name: null, source: null, confidence: 'low' };

  // ── 1. Grader field (3b). Most accurate source: who actually spoke, under
  // the transcript-only contract. Still subject to the rejection rules.
  var grader = cleanDiarizedName(opts.graderName);
  if (grader) return { name: grader, source: 'grader', confidence: 'high' };

  // ── 2. Diarized speakers, minus the closer.
  var speakers = speakerTally(opts.turns);
  if (speakers.length > 0) {
    var closerIds = [];
    if (opts.closerName) closerIds.push(opts.closerName);
    if (Array.isArray(opts.closerCandidates)) closerIds = closerIds.concat(opts.closerCandidates);

    var closerKnown = closerIds.length > 0;
    var nonCloser = speakers.filter(function (s) {
      return !closerIds.some(function (c) { return sameIdentity(s.name, c); });
    });

    // No closer identity at all → we cannot tell closer from prospect, so we
    // REFUSE rather than guess. The turn-count heuristic ("the closer talks
    // most") is true on 77 of 83 live calls but WRONG on 6, and on those it
    // returns the CLOSER as the prospect — a confidently wrong name, which is
    // the exact failure the governing principle exists to prevent. Verified on
    // real rows: "AF … | Sherrita Hall" is Donna (637 turns) + Joshua Pinner
    // (585), so turn-count alone would have named the closer as the prospect.
    // Every real synced user has a connection email; in practice only the
    // copied demo rows reach this branch.
    if (!closerKnown) return REFUSED;

    var valid = [];
    for (var i = 0; i < nonCloser.length; i++) {
      var c = cleanDiarizedName(nonCloser[i].name);
      if (c) valid.push({ name: c, turns: nonCloser[i].turns });
    }

    if (valid.length === 1) {
      // CORROBORATION. Diarization is more ACCURATE about who attended, but
      // often less COMPLETE than the title: live examples are "Towana Joseph" →
      // "Towana", "Sam Walker" → "Sam", "Cameel Bernard" → "Ca". When the two
      // independent sources agree on the person, prefer the FULLER string and
      // treat the agreement itself as the strongest signal available.
      // When they DISAGREE (title "Kay Rapple" vs attendee "Khari"), diarization
      // wins — the title is the booked name, wrong ~34% of the time.
      var titleCandidate = nameFromTitle(opts.title);
      if (titleCandidate && sameIdentity(valid[0].name, titleCandidate)) {
        var fuller = (titleCandidate.length >= valid[0].name.length) ? titleCandidate : valid[0].name;
        return { name: fuller, source: 'diarized', confidence: 'high' };
      }
      return { name: valid[0].name, source: 'diarized', confidence: 'high' };
    }
    // RULING 1: a couple is ONE prospect — combine two speakers into one name.
    // Ordered by turn count so the dominant speaker leads, which keeps the
    // combined string stable across re-analysis.
    if (valid.length === 2) {
      var pair = valid.slice().sort(function (a, b) { return b.turns - a.turns; });
      return { name: pair[0].name + ' and ' + pair[1].name, source: 'diarized', confidence: 'low' };
    }
    // Three or more distinct prospect-side speakers is not a couple and not one
    // prospect. Combining would invent an identity.
    //
    // BUT: if the meeting title corroborates EXACTLY ONE of those speakers, that
    // agreement between two independent sources identifies the prospect and the
    // others are incidental attendees. Live cases this recovers: "IH … | Ty
    // Downey" (speakers: David Summers, Ty Downey, Amanda Jolley) and "PS … |
    // LaTanya Giles" (Tanya Giles, Brianna M, Dr. B. Gibson, Nekesha McCarter).
    // Refusing those discarded a title that literally names one of the people in
    // the room. Requires exactly one match — two would be ambiguous, and
    // ambiguity refuses.
    if (valid.length > 2) {
      var tName = nameFromTitle(opts.title);
      if (tName) {
        var matches = valid.filter(function (x) { return sameIdentity(x.name, tName); });
        if (matches.length === 1) {
          var fullest = (tName.length >= matches[0].name.length) ? tName : matches[0].name;
          return { name: fullest, source: 'diarized', confidence: 'low' };
        }
      }
      return REFUSED;
    }
  }

  // ── 3. Title, last resort. It is the BOOKED name — wrong person ~34% of the
  // time — so it is always LOW confidence even when it looks like a person.
  var fromTitle = nameFromTitle(opts.title);
  if (fromTitle) return { name: fromTitle, source: 'title', confidence: 'low' };

  return REFUSED;
}

module.exports = {
  isRejectedName: isRejectedName,
  cleanDiarizedName: cleanDiarizedName,
  nameFromTitle: nameFromTitle,
  resolveProspectName: resolveProspectName,
  sameIdentity: sameIdentity,
  speakerTally: speakerTally,
};
