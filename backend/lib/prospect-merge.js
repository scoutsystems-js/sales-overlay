// lib/prospect-merge.js — merge PROPOSALS for human review.
// PROSPECT NAMES, sub-stage 3d-2.
//
// ── Why this proposes and never decides ───────────────────────────────────
// Close rate is `closed PROSPECTS / TOTAL prospects`, so every unmerged
// duplicate moves the headline number. That pressure is exactly why merging
// must stay manual: a WRONG merge silently fuses two people, and unlike a wrong
// name it is invisible in the aggregate — the number just quietly drifts.
//
// Proven on live data during 3d-1: the TITLE generator proposed
// "Mark-Anthony ~ Forb" because both calls carried the same booked title. The
// Forb call's own summary said he "got routed into the wrong Zoom meeting".
// No automatic rule could have caught that; a human reading the evidence could.
//
// ── The four generators ───────────────────────────────────────────────────
//   name  — containment / initial+surname, via prospect-name.sameIdentity
//   first — same first name (the "Towana / Towana Joseph" class)
//   inits — initials vs full name ("TJ" ↔ "Towana Joseph")
//   title — the same DISTINCTIVE meeting title across both prospects
//
// The title generator is the only one that can join prospects whose names share
// nothing, which is precisely the Mark-Anthony/Forb case. It carries one
// mandatory constraint: a title is a KEY only when DISTINCTIVE. Generic labels
// ("Impromptu Zoom Meeting") are shared by many unrelated calls — treating one
// as a key cross-matched 7 prospects into 18 junk proposals on live data.
// nameFromTitle already encodes "real booked title vs meeting label", so this
// reuses it rather than inventing a second rule.
//
// Pure and total. No I/O, never throws.

var { sameIdentity, nameFromTitle } = require('./prospect-name');
var { prospectOutcome } = require('./prospect-entity');

var MERGE_REASONS = ['name', 'first', 'inits', 'title'];

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[.,'’-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function initialsOf(s) {
  return norm(s).split(' ').filter(Boolean).map(function (w) { return w[0]; }).join('');
}

// Titles usable as an identity key: distinctive booked titles only.
function keyTitles(p) {
  var out = {};
  (p.calls || []).forEach(function (c) {
    if (c && c.title && nameFromTitle(c.title)) out[c.title] = true;
  });
  return out;
}

// Why might these two be the same prospect? Returns a reason or null.
function proposalReason(a, b) {
  if (sameIdentity(a.display_name, b.display_name)) return 'name';

  var fa = norm(a.display_name).split(' ')[0];
  var fb = norm(b.display_name).split(' ')[0];
  if (fa && fb && fa === fb) return 'first';

  var na = norm(a.display_name), nb = norm(b.display_name);
  if (na.length <= 3 && initialsOf(b.display_name) === na.replace(/\s/g, '')) return 'inits';
  if (nb.length <= 3 && initialsOf(a.display_name) === nb.replace(/\s/g, '')) return 'inits';

  var ta = keyTitles(a), tb = keyTitles(b);
  var titles = Object.keys(ta);
  for (var i = 0; i < titles.length; i++) {
    if (tb[titles[i]]) return 'title';
  }
  return null;
}

// What merging these two would do to the close rate. Reported per proposal
// because the direction is NOT obvious: merging two CLOSED prospects drops the
// numerator as well as the denominator, so it can LOWER the rate. An earlier
// estimate assumed merges only shrink the denominator and was wrong by ~3 pts.
function rateImpact(a, b) {
  var aClosed = prospectOutcome((a.calls || []).map(function (c) { return c.outcome; })) === 'closed';
  var bClosed = prospectOutcome((b.calls || []).map(function (c) { return c.outcome; })) === 'closed';
  var beforeClosed = (aClosed ? 1 : 0) + (bClosed ? 1 : 0);
  var afterClosed = (aClosed || bClosed) ? 1 : 0;
  return {
    closed_delta: afterClosed - beforeClosed,   // 0 or -1
    total_delta: -1,                            // two prospects become one
  };
}

// Generate every proposal over a user's prospects. Already-merged prospects are
// excluded — they are no longer independent rows.
function generateCandidates(prospects) {
  var arr = Array.isArray(prospects) ? prospects : [];
  var live = arr.filter(function (p) { return p && p.id && !p.merged_into; });
  var out = [];
  for (var i = 0; i < live.length; i++) {
    for (var j = i + 1; j < live.length; j++) {
      var a = live[i], b = live[j];
      if (a.id === b.id) continue;
      var reason = proposalReason(a, b);
      if (!reason) continue;
      out.push({ a: a, b: b, reason: reason, rate_impact: rateImpact(a, b) });
    }
  }
  return out;
}

module.exports = {
  generateCandidates: generateCandidates,
  proposalReason: proposalReason,
  rateImpact: rateImpact,
  MERGE_REASONS: MERGE_REASONS,
};
