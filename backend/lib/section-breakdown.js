// lib/section-breakdown.js — ONE call section, aggregated across a period.
// Stage 4a/4b (section drilldown).
//
// Justin's scope: clicking "Discovery" shows the MOMENTS over the selected
// period that reveal what the closer is doing to earn that score, plus how to
// improve — drawn from calls that went well.
//
// ── The close-score trap (ruling 1) ───────────────────────────────────────
// Migration 027 forces `close_score = 100` on every CLOSED call and preserves
// the real value in `close_score_earned`. On live data that is 21 of 55 calls.
// A distribution built on the displayed value grows a fake spike covering 38%
// of calls, and its "trend" is really a close-rate trend wearing a section's
// name. So this file reads EARNED for close, everywhere. The displayed 68 vs
// earned 60 discrepancy is surfaced with a label rather than hidden.
//
// ── What does NOT aggregate (ruling 2) ────────────────────────────────────
// Section NOTES are per-call prose. Averaging prose is meaningless, so they are
// exposed as exactly two labelled EXAMPLES — the highest- and lowest-scoring
// call in the window. No third LLM synthesis lane: performance-synthesis and
// team-needs-work already occupy that ground, and this screen's value is
// concrete quotes.
//
// Pure and total. No I/O, never throws.

var { highlightGroup } = require('./highlight-section');

var SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];

var HISTOGRAM_BUCKETS = [
  { label: '0-39', lo: 0, hi: 39 },
  { label: '40-54', lo: 40, hi: 54 },
  { label: '55-69', lo: 55, hi: 69 },
  { label: '70-84', lo: 70, hi: 84 },
  { label: '85-100', lo: 85, hi: 100 },
];

// The score to USE for a section on one analysis row. Close is special — see
// the header. Everything else reads its own column.
function sectionScoreOf(row, section) {
  if (!row || !section) return null;
  if (section === 'close') {
    var earned = row.close_score_earned;
    if (typeof earned === 'number') return earned;
    // Pre-migration-027 rows have no earned value; the displayed score IS the
    // earned score for those, so falling back is correct rather than lossy.
    return (typeof row.close_score === 'number') ? row.close_score : null;
  }
  var v = row[section + '_score'];
  return (typeof v === 'number') ? v : null;
}

function buildHistogram(scores) {
  var arr = Array.isArray(scores) ? scores : [];
  var out = HISTOGRAM_BUCKETS.map(function (b) { return { label: b.label, lo: b.lo, hi: b.hi, count: 0 }; });
  arr.forEach(function (s) {
    if (typeof s !== 'number') return;
    for (var i = 0; i < out.length; i++) {
      if (s >= out[i].lo && s <= out[i].hi) { out[i].count++; return; }
    }
  });
  return out;
}

// Rank sections by average, 1 = strongest. A section with NO score is left
// UNRANKED (null) rather than ranked last — telling a closer their intro is
// their weakest section when they simply have no intro data would be a lie.
function rankSections(averages) {
  var avg = averages || {};
  var scored = Object.keys(avg).filter(function (k) { return typeof avg[k] === 'number'; });
  scored.sort(function (a, b) { return avg[b] - avg[a]; });
  var out = {};
  Object.keys(avg).forEach(function (k) { out[k] = null; });
  scored.forEach(function (k, i) { out[k] = i + 1; });
  return out;
}

function num(v) { return (typeof v === 'number') ? v : null; }

// Assemble the whole view for one section.
//
// input: { analyses: [call_analyses rows], highlights: [call_highlights rows],
//          callMeta: { [fathom_call_id]: { prospect_name, recording_url, call_date } } }
// The prospect line a closer moment is answering: the LATEST prospect moment
// that comes BEFORE it, in the SAME call. Nearest-preceding rather than
// first-in-section, because a section can hold several exchanges and the
// earliest line is usually about something else entirely. Returns null rather
// than reaching for a later line — a reply cannot be context for the thing
// that prompted it.
function nearestPrecedingProspect(prospectLines, moment) {
  if (moment.timestamp_seconds === null) return null;
  var best = null;
  for (var i = 0; i < prospectLines.length; i++) {
    var p = prospectLines[i];
    if (p.fathom_call_id !== moment.fathom_call_id) continue;
    if (p.timestamp_seconds === null) continue;
    if (p.timestamp_seconds > moment.timestamp_seconds) continue;
    if (!best || p.timestamp_seconds > best.timestamp_seconds) best = p;
  }
  return best ? { quote: best.quote, speaker: 'PROSPECT', timestamp_seconds: best.timestamp_seconds, verified: best.verified } : null;
}

function byDateDescThenTime(a, b) {
  var d = String(b.call_date || '').localeCompare(String(a.call_date || ''));
  if (d !== 0) return d;
  return (a.timestamp_seconds || 0) - (b.timestamp_seconds || 0);
}

function buildSectionBreakdown(section, input) {
  var d = input || {};
  var analyses = Array.isArray(d.analyses) ? d.analyses : [];
  var highlights = Array.isArray(d.highlights) ? d.highlights : [];
  var meta = d.callMeta || {};

  // ── score aggregate ────────────────────────────────────────────────────
  var scores = [];
  analyses.forEach(function (a) {
    var s = sectionScoreOf(a, section);
    if (typeof s === 'number') scores.push(s);
  });
  var average = scores.length
    ? Math.round(scores.reduce(function (x, y) { return x + y; }, 0) / scores.length)
    : null;
  // ACTUAL min/max, not bucket edges. The plain-language read quotes these, and
  // quoting bucket boundaries instead overstated the range ("0 to 84" for a
  // section whose real spread was 15-75).
  var lo = scores.length ? Math.min.apply(null, scores) : null;
  var hi = scores.length ? Math.max.apply(null, scores) : null;

  // ── moments ────────────────────────────────────────────────────────────
  var good = [], bad = [];
  var callsWithMoments = {};
  highlights.forEach(function (h) {
    if (!h || h.section !== section) return;
    var m = meta[h.fathom_call_id] || {};
    var ts = num(h.timestamp_seconds);
    var rec = m.recording_url;
    var moment = {
      highlight_id: h.id || null,
      fathom_call_id: h.fathom_call_id,
      quote: h.quote || null,
      observation: h.observation || null,
      type: h.type || null,
      resolution: h.resolution || null,
      speaker: h.speaker || null,
      timestamp_seconds: ts,
      call_date: m.call_date || null,
      prospect_name: m.prospect_name || null,
      // Null rather than a half-built href when there is no recording.
      clip_url: (rec && ts !== null) ? rec + (rec.indexOf('?') === -1 ? '?' : '&') + 't=' + ts : null,
      saved_to_kb: false, // set by the route from knowledge_base.source_quote_hash
      // 6a/6d: true = speaker proven from the transcript, false = assessed but
      // not provable (model's guess), null = never assessed. Carried through so
      // the closer view can require proof; the good/bad groups ignore it.
      speaker_verified: (typeof h.speaker_verified === 'boolean') ? h.speaker_verified : null,
    };
    callsWithMoments[h.fathom_call_id] = true;
    if (highlightGroup(h) === 'good') good.push(moment); else bad.push(moment);
  });

  // ── closer view (6d) ───────────────────────────────────────────────────
  // "What worked", told from the rep's side: what THEY said, with the
  // prospect's preceding line as context.
  //
  // The bar is PROOF, not plausibility. This feature sat blocked because a
  // closer-only filter over model-inferred labels hands the rep the PROSPECT's
  // words as their own winning material — measured, not hypothetical. So an
  // unproven label is excluded, and a never-assessed one (no closer identity
  // exists for that call) is excluded outright rather than shown as a guess.
  //
  // The two exclusion reasons are counted SEPARATELY and surfaced, because
  // "we could not prove this" and "we never had the means to check" are
  // different messages to a user staring at a thin screen.
  var closerCounts = { verified: 0, hidden_unverified: 0, hidden_unassessed: 0 };
  var closerMoments = [];
  var prospectLines = [];

  highlights.forEach(function (h) {
    if (!h || h.section !== section) return;
    if (h.speaker === 'PROSPECT') {
      prospectLines.push({
        fathom_call_id: h.fathom_call_id,
        quote: h.quote || null,
        timestamp_seconds: num(h.timestamp_seconds),
        verified: (typeof h.speaker_verified === 'boolean') ? h.speaker_verified : null,
      });
    }
  });

  good.forEach(function (m) {
    if (m.speaker !== 'CLOSER') return;
    if (m.speaker_verified === null)  { closerCounts.hidden_unassessed++; return; }
    if (m.speaker_verified !== true)  { closerCounts.hidden_unverified++; return; }
    closerCounts.verified++;
    closerMoments.push(Object.assign({}, m, { context: nearestPrecedingProspect(prospectLines, m) }));
  });

  // ── 6e: the closer's objection handling ────────────────────────────────
  // An objection is the PROSPECT's row with the rep's reply in `closer_response`,
  // so without this the rep's objection work is invisible to a CLOSER filter —
  // 257 responses in the data against 1 moment on screen.
  //
  // The field NAME is not evidence: of 53 responses that reconstruct from the
  // transcript, 3 were actually the prospect speaking. So the response is only
  // the rep's words when `closer_response_verified` is true (reconstructed AND
  // spoken by the closer). Refuse otherwise.
  //
  // Only HANDLED objections reach this lane — the lane is "what worked", and a
  // partial or unhandled objection is what to fix. The row itself still appears
  // in the ordinary good/bad groups either way.
  highlights.forEach(function (h) {
    if (!h || h.section !== section) return;
    if (String(h.type || '').toLowerCase() !== 'objection') return;
    var resp = (typeof h.closer_response === 'string') ? h.closer_response.trim() : '';
    if (!resp) return;                                   // no response is not a withheld response
    if (h.resolution !== 'handled') return;              // belongs in "what to fix"

    var verdict = (typeof h.closer_response_verified === 'boolean') ? h.closer_response_verified : null;
    if (verdict === null)  { closerCounts.hidden_unassessed++; return; }
    if (verdict !== true)  { closerCounts.hidden_unverified++; return; }

    var m = meta[h.fathom_call_id] || {};
    var ts = num(h.timestamp_seconds);
    var rec = m.recording_url;
    closerCounts.verified++;
    closerMoments.push({
      highlight_id: h.id || null,
      fathom_call_id: h.fathom_call_id,
      quote: resp,                                       // the REP's line leads
      observation: h.observation || null,
      type: h.type || null,
      resolution: h.resolution || null,
      speaker: 'CLOSER',
      speaker_verified: true,
      timestamp_seconds: ts,
      call_date: m.call_date || null,
      prospect_name: m.prospect_name || null,
      clip_url: (rec && ts !== null) ? rec + (rec.indexOf('?') === -1 ? '?' : '&') + 't=' + ts : null,
      saved_to_kb: false,
      // EXACT context, not a nearest-preceding guess: the objection this reply
      // answers is on the same row.
      context: { quote: h.quote || null, speaker: 'PROSPECT', timestamp_seconds: ts, verified: (typeof h.speaker_verified === 'boolean') ? h.speaker_verified : null },
      from_closer_response: true,
    });
  });

  closerMoments.sort(byDateDescThenTime);

  var byDateDesc = function (a, b) { return String(b.call_date || '').localeCompare(String(a.call_date || '')); };
  good.sort(byDateDesc);
  bad.sort(byDateDesc);

  // ── notes as two labelled EXAMPLES (never an aggregate) ────────────────
  var withNotes = analyses
    .map(function (a) {
      return {
        fathom_call_id: a.fathom_call_id,
        score: sectionScoreOf(a, section),
        notes: a[section + '_notes'] || null,
        call_date: (meta[a.fathom_call_id] || {}).call_date || a.call_date || null,
        prospect_name: (meta[a.fathom_call_id] || {}).prospect_name || null,
      };
    })
    .filter(function (x) { return typeof x.score === 'number' && x.notes; })
    .sort(function (a, b) { return b.score - a.score; });

  var examples = {
    best: withNotes.length ? withNotes[0] : null,
    worst: withNotes.length > 1 ? withNotes[withNotes.length - 1] : null,
  };

  return {
    section: section,
    average: average,
    scored_calls: scores.length,
    min_score: lo,
    max_score: hi,
    histogram: buildHistogram(scores),
    good: good,
    bad: bad,
    // 6d — "What worked", from the rep's own side. PROVEN closer moments only.
    // Deliberately a SEPARATE field, not a filter on `good`: the call-review
    // section breakdown must keep showing every moment regardless of proof.
    closer_moments: closerMoments,
    closer_counts: closerCounts,
    // Objection reads thin on live data (33 moments from 16 of 55 calls). That
    // is information about the closer's calls, not a defect in the screen.
    coverage: {
      moments: good.length + bad.length,
      calls_with_moments: Object.keys(callsWithMoments).length,
      calls_total: analyses.length,
    },
    // Live: objection is the only section where bad outnumbers good (20 v 13).
    bad_outnumber_good: bad.length > good.length,
    examples: examples,
    // Surfaced so the UI can label the close discrepancy honestly.
    uses_earned_close_score: section === 'close',
  };
}

module.exports = {
  SECTIONS: SECTIONS,
  HISTOGRAM_BUCKETS: HISTOGRAM_BUCKETS,
  sectionScoreOf: sectionScoreOf,
  buildHistogram: buildHistogram,
  rankSections: rankSections,
  buildSectionBreakdown: buildSectionBreakdown,
};
