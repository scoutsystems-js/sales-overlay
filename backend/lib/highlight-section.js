// Call Review Context (Part 1a) — section tagging + good/bad grouping for call
// highlights. `section` = which part of the call a highlight belongs to; the
// highlight extractor emits it and sanitizeHighlights validates against this enum.
// It is NULLABLE by design: highlights extracted before this change (and any
// analyses older than the 30-day backfill window) legitimately have no section —
// the review UI (Part 1b) falls back to the section notes prose for those.
//
// highlightGroup splits a section's highlights into the review UI's two buckets:
// "What worked" (good) vs "What to fix" (bad). Pure — Part 1b's UI reuses it.

var VALID_HIGHLIGHT_SECTIONS = ['intro', 'discovery', 'pitch', 'objection', 'close'];

// Validate a raw section value → a canonical section, or null. Anything not one of
// the five (old rows, missing, unrecognized, non-string) is legitimately null.
function sanitizeSectionValue(v) {
  if (typeof v !== 'string') return null;
  var s = v.toLowerCase().trim();
  return VALID_HIGHLIGHT_SECTIONS.indexOf(s) !== -1 ? s : null;
}

// Positive-moment types = things that worked. Objections are split by resolution
// (below) rather than being blanket-good or blanket-bad.
var GOOD_TYPES = ['strong_moment', 'rapport_moment', 'buying_signal'];

// Which review bucket a highlight falls into: 'good' (What worked) or 'bad'
// (What to fix). Objections: a HANDLED objection is a win; partial / unhandled /
// unknown resolution is a coaching gap. Closer-miss + disqualify are to-fix.
// Anything unrecognized falls to 'bad' so a moment is surfaced, never dropped.
function highlightGroup(h) {
  if (!h || typeof h !== 'object') return 'bad';
  var type = (typeof h.type === 'string') ? h.type.toLowerCase() : '';
  if (type === 'objection') {
    return (h.resolution === 'handled') ? 'good' : 'bad';
  }
  return (GOOD_TYPES.indexOf(type) !== -1) ? 'good' : 'bad';
}

module.exports = {
  VALID_HIGHLIGHT_SECTIONS: VALID_HIGHLIGHT_SECTIONS,
  sanitizeSectionValue: sanitizeSectionValue,
  highlightGroup: highlightGroup,
};
