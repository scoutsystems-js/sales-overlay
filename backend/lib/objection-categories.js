// ⚠⚠ THE ONE SOURCE OF TRUTH FOR OBJECTION CATEGORY NAMES (Justin's ruling 2026-08-26).
//
// Two schemes were live and disagreed about the same metric: the Objection
// Handling Focus page rendered model-INVENTED labels ("Needs More Time /
// Stalling", "Trust / Proof / Skepticism") while the drilldown rendered a
// hardcoded map (Fear / money, Partner / spouse, Uncategorised). A second copy
// is how they diverged, so there is now exactly one list and everything reads it.
//
// ⚠ THE CANONICAL SET IS FIVE. Price is NOT a category — Justin ruled it folds
// into fear or logistical by circumstance, which is what removes any need to
// re-classify or migrate: every stored value already maps onto one of these.
//
// ⚠⚠ "other" IS THE EXISTING NULL, NOT A NEW STORED VALUE. call_highlights has a
// CHECK constraint allowing only fear|logistical|timing|partner (or NULL), and
// NULL already means "not one of the four". Displaying NULL as "Other" is
// therefore a PURE RENAME — no migration, no re-grade, no data touched. Adding a
// fifth stored value would have meant both.

var OBJECTION_CATEGORIES = [
  { key: 'fear',       label: 'Fear' },
  { key: 'timing',     label: 'Timing' },
  { key: 'partner',    label: 'Spouse/Partner' },
  { key: 'logistical', label: 'Logistical' },
  { key: 'other',      label: 'Other' },
];

// The four the database actually stores. 'other' is absent BY DESIGN (see above).
var STORED_OBJECTION_CATEGORIES = ['fear', 'timing', 'partner', 'logistical'];

// Every spelling that has ever meant "we could not place this one".
var OTHER_ALIASES = ['other', 'uncategorized', 'uncategorised', '', 'null'];

// ⚠ TOTAL BY CONSTRUCTION — null, undefined, an unknown string and every legacy
// spelling all resolve to "Other" rather than rendering a raw key or a blank.
// A category that prints as empty reads as a broken row, not as an unclassified one.
function objectionLabel(key) {
  var k = (key == null) ? '' : String(key).trim().toLowerCase();
  for (var i = 0; i < OBJECTION_CATEGORIES.length; i++) {
    if (OBJECTION_CATEGORIES[i].key === k) return OBJECTION_CATEGORIES[i].label;
  }
  return 'Other';
}

// ⚠⚠ JUSTIN'S BOUNDARY, VERBATIM IN SUBSTANCE — SHARED PROMPT TEXT.
// This is CLASSIFICATION GUIDANCE, not a display table: it lives where the model
// DECIDES (the highlight extractor and the surface bucketer), not only where a
// page prints. Both import this string so the two decision points cannot drift.
//
// ⚠ THE DISCRIMINATOR IN ONE LINE: WILLING BUT UNABLE vs ABLE BUT HESITANT.
// "Unable" splits again by why — can't afford it is a DISQUALIFICATION, blocked
// by something external is LOGISTICAL. Only "able but hesitant" is coachable.
//
// ⚠ THE STATED EXCUSE IS NOT THE CLASSIFICATION. Justin: "prospects will never
// say 'I'm scared'. If they say anything at all it's 'I'm nervous'." So wanting
// proof, questioning legitimacy, needing to check with someone or wanting to
// think it over are all FEAR when the prospect can afford it and is hesitating.
var CLASSIFICATION_GUIDANCE = [
  'HOW TO TELL THESE APART — apply this test before anything else:',
  '  Ask: CAN the prospect buy right now if they decide to?',
  '    NO, they genuinely cannot afford it            -> a FINANCIAL DISQUALIFICATION, not an objection at all.',
  '    NO, something external blocks them             -> "logistical".',
  '    YES, they can, but they are hesitating         -> "fear", whatever excuse they wrap it in.',
  '    YES, but they must consult someone first       -> "partner".',
  '',
  '  A DISQUALIFICATION IS NOT A COACHING FAILURE — there was nothing the closer could have done.',
  '  A LOGISTICAL BARRIER IS NOT A COACHING FAILURE EITHER — the prospect wants to buy and physically cannot.',
  '  Only genuine hesitation is coachable.',
  '',
  '  ⚠ THE STATED EXCUSE IS NOT THE CLASSIFICATION. Prospects never say "I am scared" — at most "I am nervous",',
  '  and usually they say something that sounds practical instead. Wanting more proof, questioning whether it is',
  '  legitimate, needing to "run it by" someone, or wanting to "think about it" are FEAR when the prospect can',
  '  afford it and is simply hesitating. Classify the underlying driver, not the words they chose.',
].join('\n');

module.exports = {
  OBJECTION_CATEGORIES: OBJECTION_CATEGORIES,
  STORED_OBJECTION_CATEGORIES: STORED_OBJECTION_CATEGORIES,
  OTHER_ALIASES: OTHER_ALIASES,
  objectionLabel: objectionLabel,
  CLASSIFICATION_GUIDANCE: CLASSIFICATION_GUIDANCE,
};
