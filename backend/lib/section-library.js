'use strict';
/**
 * "Discovery is your weakest section — here are your best discovery moments."
 *
 * The section drilldown already shows what happened IN THE SELECTED WINDOW.
 * This is the other half: the rep's own proven lines in that section, harvested
 * from calls they CLOSED (lib/kb-harvest.js, ruling 4). It is the surfacing that
 * KB Part 2 sub-stage 2c(iii) deliberately deferred until it had a home.
 *
 * ⚠⚠ IT SELECTS BY SECTION AND SCOPE, NOT BY EMBEDDING SIMILARITY — and that is
 * a design choice, not a shortcut. A section filter is deterministic and
 * explainable ("these are your discovery moments"), needs no model call, and
 * cannot silently omit a row. Similarity ranking would have made an unembedded
 * chunk PERMANENTLY INVISIBLE to the feature built to find it, which is exactly
 * the precondition that blocked this work until the backfill landed.
 *
 * ⚠⚠ PROVEN CLOSER LINES ONLY. Harvested moments include PROSPECT-spoken ones —
 * objections, buying signals — because the extractor flags them on merit. This
 * panel says "here is what YOU said that worked", so showing a prospect's words
 * would file them as the rep's own winning material. 6b had to REPAIR exactly
 * that in the KB once already. Both conditions are required and both fail
 * closed: an unproven speaker is a guess, and a guess is what caused the repair.
 */

/** A coaching aid, not a dump. Six is enough to see a pattern and few enough to read. */
var LIBRARY_CAP = 6;

/**
 * @param rows knowledge_base rows for ONE section and ONE owner
 * @returns the moments worth showing, newest first
 */
function selectLibraryMoments(rows, cap) {
  var limit = (typeof cap === 'number' && cap > 0) ? cap : LIBRARY_CAP;
  var arr = Array.isArray(rows) ? rows : [];
  var keep = [];

  for (var i = 0; i < arr.length; i++) {
    var r = arr[i];
    if (!r || typeof r !== 'object') continue;
    var m = r.metadata || {};
    // ⚠ === true / === 'CLOSER', never truthiness: an ABSENT verdict is not a
    // positive one, and a row predating the speaker work must not be promoted
    // into "your best moments" on the strength of a missing field.
    if (m.speaker !== 'CLOSER') continue;
    if (m.speaker_verified !== true && m.speaker_verified !== 'true') continue;
    var quote = (m.quote || '').trim();
    if (!quote) continue;                       // nothing to show
    keep.push({
      /* ⚠⚠ THE MANAGER'S NOTE, AND IT IS NOT ATTRIBUTED — Justin's standing
         ruling on the related case: coaching reads "here's what you should try
         next time", NOT "this is how your manager handles it". Naming the
         manager turns coaching into a directive, and a rep reading a directive
         argues with it instead of trying it. */
      note: (typeof m.note === 'string' && m.note.trim()) ? m.note.trim() : null,
      quote: quote,
      observation: (m.observation || '').trim() || null,
      type: m.type || null,
      section: r.source_section || m.section || null,
      timestamp_seconds: (typeof m.timestamp_seconds === 'number') ? m.timestamp_seconds : null,
      fathom_call_id: r.source_fathom_call_id || m.source_fathom_call_id || null,
      created_at: r.created_at || null,
    });
  }

  /* Newest first. The harvest writes in call order, so without an explicit sort
     the panel would silently drift toward whatever happened to be inserted
     first — which is the oldest material, the opposite of what is useful. */
  keep.sort(function (a, b) {
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return keep.slice(0, limit);
}

module.exports = {
  selectLibraryMoments: selectLibraryMoments,
  LIBRARY_CAP: LIBRARY_CAP,
};
