// lib/kb-harvest.js — auto-population of a closed call's winning moments into
// the REP'S OWN knowledge base. KB Part 2, sub-stage 2d.
//
// Runs as its own fire-and-forget pass AFTER persistHighlights, deliberately NOT
// inline in the analysis drain: the drain is already documented as dying on a
// Railway redeploy (it has stranded batches twice), and adding Voyage round-trips
// inside it would lengthen the window where a deploy kills a call mid-analysis.
// Nothing here can fail, stall, or slow an analysis. Embedding is ONE batched
// request per call (see the embedding block below for why batching, not delays).
//
// ── The rulings this file implements ──────────────────────────────────────
// RULING 4 — the gate is `outcome === 'closed'` ALONE. NOT cash_collected > 0.
//   The grader records cash by payment structure (v8: payment_plan = only what
//   was collected ON the call), so a plan close with nothing due at signing
//   legitimately shows zero. Gating on cash would systematically drop plan
//   closes — exactly the wins a coaching KB most wants. shouldHarvest takes
//   only the outcome so cash cannot leak into the decision via a later edit.
// RULING 3 — cap ~2 per SECTION per call, and cap `close` rather than excluding
//   it. Live data: on section-tagged closed calls the good-group split is
//   close 62 / discovery 11 / pitch 14 / objection 6 / intro 6. Uncapped, close
//   would be ~63% of every harvest — and close is the section whose score is
//   synthetically 100 (migration 027), so it carries the least earned signal.
//   But the extractor flags moments on merit independently of that score, so
//   close moments are worth keeping; they just must not swamp the rest.
// RULING 1 — harvested rows use the same shape as the manual button
//   (category column 'learned_pattern' + metadata.category 'call_moment'), so
//   the grader exclusion holds automatically with nothing extra to remember.
// RULING 2 — writes go through lib/kb-entry.js buildMomentRow + insertMoment,
//   the SAME functions POST /kb/from-highlight uses. One insert implementation,
//   two callers. No internal HTTP hop inside the worker.
//
// Idempotency with the manual button is by CONSTRUCTION, not by checking: both
// paths write with uploaded_by = the rep, so they produce an identical dedupe
// key and the partial unique index (migration 030) makes whichever runs second
// a no-op. Order doesn't matter.

var { highlightGroup } = require('./highlight-section');
var { buildMomentRow, insertMoment, quoteHash } = require('./kb-entry');
var { getVoyageEmbeddings } = require('./voyage');

// Ruling 3. Per SECTION, per call.
var HARVEST_SECTION_CAP = 2;

// The gate. Takes ONLY the outcome — see RULING 4 above for why cash is absent.
// Pass the manual-override-aware effectiveOutcome, never the raw grader value.
function shouldHarvest(outcome) {
  return outcome === 'closed';
}

// Which moments to file. Good-group + section-tagged + non-blank quote, capped
// per section, order-stable (the extractor already returns chronological order,
// so the first N of a section are the earliest — a deterministic, explainable
// choice rather than an arbitrary one).
function selectHarvestMoments(highlights, cap) {
  var limit = (typeof cap === 'number' && cap > 0) ? cap : HARVEST_SECTION_CAP;
  var arr = Array.isArray(highlights) ? highlights : [];
  var perSection = {};
  var picked = [];

  for (var i = 0; i < arr.length; i++) {
    var h = arr[i];
    if (!h || typeof h !== 'object') continue;
    // Untagged moments have no section to file them under. Common by design —
    // only v10+ analyses carry tags — so this is a skip, not an error.
    if (!h.section) continue;
    // A blank quote hashes to null, which opts the row out of the dedupe index
    // entirely; storing it would allow unbounded duplicates of the same moment.
    if (!quoteHash(h.quote)) continue;
    if (highlightGroup(h) !== 'good') continue;

    var n = perSection[h.section] || 0;
    if (n >= limit) continue;
    perSection[h.section] = n + 1;
    picked.push(h);
  }
  return picked;
}

// Harvest one closed call. NEVER throws and never reports failure upward — the
// caller is the analysis worker, and the standing house rule is that a KB
// problem can never fail or stall an analysis. Returns a summary for logging.
async function harvestClosedCall(admin, opts) {
  var summary = { attempted: 0, added: 0, duplicate: 0, failed: 0, unembedded: 0, skipped_reason: null };
  try {
    if (!shouldHarvest(opts && opts.outcome)) {
      summary.skipped_reason = 'not_closed';
      return summary;
    }
    var moments = selectHarvestMoments(opts.highlights, opts.cap);
    if (moments.length === 0) {
      summary.skipped_reason = 'no_qualifying_moments';
      return summary;
    }

    // The rep's OWN KB. Personal scope, no team key — this is what makes the
    // key identical to a manual self-add and therefore idempotent with it.
    var target = { scope: 'personal', team_owner_id: null, uploaded_by: opts.userId };

    // Build every row first, then embed them in ONE batched Voyage request.
    //
    // This used to be N sequential single embeds, which rate-limited partway
    // through (observed 2026-08-03: 3 of 5, then HTTP 429). Because
    // selectHarvestMoments preserves chronological order, the dropouts were
    // always the LATE-call sections — `close` above all — so the defect
    // systematically left the most search-worthy moments unsearchable. One
    // request removes the per-item limit exposure; a delay would not have.
    var rows = moments.map(function (h) {
      return buildMomentRow({
        highlight: h,
        target: target,
        fathomCallId: opts.fathomCallId,
        source: 'auto_closed_call',
        sourceUserId: opts.userId,
        addedBy: null, // no human actor
        // 6a: record whether the CLOSER/PROSPECT label was matched
        // deterministically or inferred by the model. Fails closed — an
        // inferred label is never filed as verified material.
        speakerConfidence: opts.speakerConfidence || null,
      });
    });

    // Contract: same length as the input, each slot a vector or null. A partial
    // or total embedding failure must never lose the harvest — every row is
    // still written, just unembedded (and still keyword-searchable).
    var embeddings = await getVoyageEmbeddings(rows.map(function (r) { return r.content; }), 'kb-harvest');
    for (var e = 0; e < rows.length; e++) {
      rows[e].embedding = embeddings[e] || null;
      if (rows[e].embedding === null) summary.unembedded++;
    }

    for (var i = 0; i < rows.length; i++) {
      summary.attempted++;
      var res = await insertMoment(admin, rows[i]);
      if (res.added) summary.added++;
      else if (res.duplicate) summary.duplicate++;
      else { summary.failed++; console.warn('[kb-harvest] insert failed for call ' + opts.fathomCallId + ': ' + res.error); }
    }
    return summary;
  } catch (err) {
    // Belt-and-braces: insertMoment already swallows its own errors, so reaching
    // here means something structural. Still non-fatal by design.
    console.error('[kb-harvest] harvest failed for call ' + (opts && opts.fathomCallId) + ': ' + ((err && err.message) || 'unknown'));
    summary.skipped_reason = 'error';
    return summary;
  }
}

module.exports = {
  shouldHarvest: shouldHarvest,
  selectHarvestMoments: selectHarvestMoments,
  harvestClosedCall: harvestClosedCall,
  HARVEST_SECTION_CAP: HARVEST_SECTION_CAP,
};
